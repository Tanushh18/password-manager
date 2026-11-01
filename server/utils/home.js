/**
 * Stashr Home: the rules behind the TV and the Wi-Fi hub. Kept free of Express so they can be tested alone.
 */
const crypto = require("crypto");

const ONLINE_MS = 150 * 1000;          // a device that has not reported for this long is offline
const LAN_GONE_MS = 5 * 60 * 1000;     // a Wi-Fi device not answering for this long has left
const LAN_FORGET_MS = 30 * 24 * 3600 * 1000;
const MAX_STATUS_BYTES = 150 * 1024;
const MAX_COMMANDS = 20;

const COMMANDS = {
    tv: {
        remove_movie: (a) => (okName(a.name) ? { name: a.name } : null),
        play_movie: (a) => (okName(a.name) ? { name: a.name } : null),
        launch_app: (a) => (/^[A-Za-z0-9_.]{3,200}$/.test(String(a.package || "")) ? { package: a.package } : null),
        volume: (a) => {
            if (["up", "down", "mute"].includes(a.action)) return { action: a.action };
            const level = Number(a.level);
            return Number.isInteger(level) && level >= 0 && level <= 100 ? { level } : null;
        },
        media: (a) => (["play_pause", "next", "previous"].includes(a.action) ? { action: a.action } : null),
        key: (a) => (["HOME", "BACK"].includes(a.key) ? { key: a.key } : null),
        // Opens a YouTube or YouTube Music link in the TV's own YouTube app, where your Premium account already works.
        open_url: (a) => (okYoutube(a.url) ? { url: a.url } : null),
        sync_now: () => ({})
    },
    hub: {
        scan_now: () => ({})
    }
};

function okYoutube(u) {
    try {
        const url = new URL(String(u || ""));
        return url.protocol === "https:" && String(u).length <= 300 && !url.username && !url.password
            && ["www.youtube.com", "youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(url.hostname);
    } catch (e) { return false; }
}

function okName(n) { return typeof n === "string" && n.length > 0 && n.length <= 300 && !/[\u0000-\u001f]/.test(n); }

const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");
const newToken = () => "sh_" + crypto.randomBytes(24).toString("hex");

/** Checks a command and returns it with only the arguments that command takes, or null. */
function cleanCommand(kind, type, args) {
    const rule = COMMANDS[kind] && COMMANDS[kind][type];
    if (!rule) return null;
    const clean = rule(args && typeof args === "object" ? args : {});
    return clean ? { type, args: clean } : null;
}

/** A report from a device: plain JSON, limited in size and depth, with no key a database could mistake for an operator. */
function scrub(value, depth = 0) {
    if (depth > 6) return null;
    if (Array.isArray(value)) return value.slice(0, 400).map((v) => scrub(v, depth + 1));
    if (value && typeof value === "object") {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (k.startsWith("$") || k.includes(".") || k.length > 60) continue;
            out[k] = scrub(v, depth + 1);
        }
        return out;
    }
    if (typeof value === "string") return value.slice(0, 500);
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    return typeof value === "boolean" || value === null ? value : null;
}

function cleanStatus(status) {
    if (!status || typeof status !== "object" || Array.isArray(status)) return null;
    const clean = scrub(status);
    return JSON.stringify(clean).length > MAX_STATUS_BYTES ? null : clean;
}

const isOnline = (device, now = Date.now()) => Boolean(device.lastSeen) && now - new Date(device.lastSeen).getTime() < ONLINE_MS;

/** A key that is safe as a database field name: the MAC if the tablet could read it, else the address. */
const lanKey = (d) => String((d.mac || d.ip || "")).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/**
 * Folds one scan of the Wi-Fi into the book of every device ever seen. A device that answered is "up" and gets a new
 * last-seen time; one that did not stays in the book as "down". Events are only made for a real arrival or departure,
 * not for a device that blinked.
 */
function mergeLan(book, scan, labels = {}, now = Date.now()) {
    const next = { ...book };
    const events = [];
    const seen = new Set();
    for (const d of Array.isArray(scan) ? scan.slice(0, 400) : []) {
        const key = lanKey(d);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const old = next[key];
        const wasUp = Boolean(old && old.up);
        const awayMs = old ? now - old.lastSeen : 0;
        next[key] = {
            ip: String(d.ip || "").slice(0, 45),
            mac: String(d.mac || "").slice(0, 20),
            name: String(d.name || (old && old.name) || "").slice(0, 80),
            vendor: String(d.vendor || (old && old.vendor) || "").slice(0, 60),
            up: d.up !== false,
            pingMs: Number.isFinite(Number(d.pingMs)) ? Math.max(0, Math.min(60000, Math.round(Number(d.pingMs)))) : ((old && old.pingMs) || 0),
            firstSeen: old ? old.firstSeen : now,
            lastSeen: d.up !== false ? now : (old ? old.lastSeen : now),
            ports: Array.isArray(d.ports) ? d.ports.slice(0, 10).map(Number).filter(Number.isInteger) : (old && old.ports) || []
        };
        const label = (labels[key] && labels[key].label) || next[key].name || next[key].ip;
        if (!old) events.push({ kind: "lan_new", text: `New device on the Wi-Fi: ${label} (${next[key].ip})` });
        else if (next[key].up && !wasUp && awayMs > LAN_GONE_MS) events.push({ kind: "lan_joined", text: `${label} joined the Wi-Fi` });
    }
    for (const [key, d] of Object.entries(next)) {
        if (seen.has(key)) continue;
        if (now - d.lastSeen > LAN_FORGET_MS) { delete next[key]; continue; }
        if (d.up && now - d.lastSeen > LAN_GONE_MS) {
            next[key] = { ...d, up: false };
            const label = (labels[key] && labels[key].label) || d.name || d.ip;
            events.push({ kind: "lan_left", text: `${label} left the Wi-Fi` });
        }
    }
    return { book: next, events };
}

/** Movies that appeared on or vanished from the TV's USB drive between two reports. */
function diffMovies(prev, next) {
    const before = new Set(((prev && prev.movies) || []).map((m) => m.name));
    const after = new Set(((next && next.movies) || []).map((m) => m.name));
    const events = [];
    for (const n of after) if (!before.has(n) && (prev && prev.movies)) events.push({ kind: "movie_added", text: `Movie on the USB drive: ${n}` });
    for (const n of before) if (!after.has(n) && (next && next.movies)) events.push({ kind: "movie_removed", text: `Movie removed from the USB drive: ${n}` });
    return events.slice(0, 20);
}

module.exports = {
    ONLINE_MS, MAX_COMMANDS, COMMANDS, hashToken, newToken, cleanCommand, cleanStatus, isOnline, lanKey, mergeLan, diffMovies
};
