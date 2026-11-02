/**
 * Stashr Home: the rules behind the TV and the Wi-Fi hub. Kept free of Express so they can be tested alone.
 */
const crypto = require("crypto");

const ONLINE_MS = 150 * 1000;          // a device that has not reported for this long is offline
// A Wi-Fi device not answering for this long has left. Phones doze and skip pings for several minutes when the screen
// is off, so a short window filled the timeline with "left" / "joined" for a phone that never moved.
const LAN_GONE_MS = 15 * 60 * 1000;
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
        sync_now: () => ({}),
        // Opens the live map of the family members who are out.
        live_location: () => ({}),
        // A short message on the TV screen (needs a TV app that understands it).
        notify: (a) => (okText(a.text, 200) ? { text: a.text.trim() } : null)
    },
    hub: {
        scan_now: () => ({}),
        speed_test: () => ({}),
        check_update: () => ({}),
        // Wake-on-LAN: the tablet sends the magic packet on the home Wi-Fi.
        wake: (a) => (okMac(a.mac) ? { mac: normMac(a.mac) } : null),
        // Plays songs on the tablet through YouTube Music (where the Premium account is signed in).
        play_music: (a) => (okText(a.query, 120) ? { query: a.query.trim() } : null),
        camera: (a) => (["arm", "disarm", "snapshot", "clip", "live"].includes(a.action) ? { action: a.action } : null),
        slideshow: (a) => (["start", "stop"].includes(a.action) ? { action: a.action } : null),
        show_today: () => ({}),
        announce: (a) => (okText(a.text, 200) ? { text: a.text.trim(), speak: a.speak !== false, urgent: a.urgent === true } : null),
        send_whatsapp: (a) => (okText(a.group, 80) && okText(a.text, 500) ? { group: a.group.trim(), text: a.text.trim() } : null)
    },
    phone: {
        report_now: () => ({}),
        notice: (a) => (okText(a.text, 200) ? { text: a.text.trim() } : null)
    }
};

/** A command that goes to the tablet, the TV or a family phone; used by the page, the assistant and schedules. */
const KINDS = Object.keys(COMMANDS);

// Ports that should not be open on a home device without you knowing: each is a common way in.
const RISKY_PORTS = {
    21: "FTP (files without encryption)", 23: "Telnet (remote login without encryption)", 445: "Windows file sharing",
    3389: "Remote Desktop", 5555: "Android debugging (ADB) open to the network", 5900: "VNC screen sharing",
    554: "Camera video stream (RTSP)", 1883: "MQTT without a password", 8291: "Router admin (Winbox)", 2323: "Telnet (alternate port)"
};
const risksOf = (ports) => (Array.isArray(ports) ? ports : []).filter((p) => RISKY_PORTS[p]).map((p) => ({ port: p, why: RISKY_PORTS[p] }));

function okMac(m) { return /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(String(m || "").trim()); }
function normMac(m) { return String(m).trim().toLowerCase().replace(/-/g, ":"); }
function okText(t, max) { return typeof t === "string" && t.trim().length > 0 && t.length <= max && !/[\u0000-\u001f]/.test(t); }

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

const slug = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
/** Names that many devices share, so they cannot tell one device from another. */
const GENERIC_NAMES = new Set(["android", "iphone", "ipad", "localhost", "unknown", "espressif", "esp", "router", "gateway", "device", "host"]);
const usefulName = (n) => { const s = slug(n); return s.length >= 3 && !GENERIC_NAMES.has(s) && !/^\d+(-\d+){3}$/.test(s); };

/**
 * A key that is safe as a database field name and follows the device, not its address: the MAC if the tablet could
 * read it, else the device's own name (phones get a new IP when they reconnect, but keep their name), else the IP.
 */
const lanKey = (d) => {
    const mac = slug(d.mac);
    if (mac && mac !== "02-00-00-00-00-00") return mac;
    if (d.name && usefulName(d.name)) return "n-" + slug(d.name).slice(0, 58);
    return slug(d.ip);
};

/**
 * Folds one scan of the Wi-Fi into the book of every device ever seen. A device that answered is "up" and gets a new
 * last-seen time; one that did not stays in the book as "down". Events are only made for a real arrival or departure,
 * not for a device that blinked.
 */
function mergeLan(book, scan, labels = {}, now = Date.now()) {
    const next = { ...book };
    const events = [];
    const seen = new Set();
    const moves = [];
    const list = Array.isArray(scan) ? scan.slice(0, 400).filter((d) => d && typeof d === "object") : [];
    // Two devices reporting the same name in one scan: the name tells them apart from nobody, so both keep their IP key.
    const nameCount = {};
    for (const d of list) { const k = lanKey(d); if (k.startsWith("n-")) nameCount[k] = (nameCount[k] || 0) + 1; }
    for (const d of list) {
        let key = lanKey(d);
        if (nameCount[key] > 1) key = slug(d.ip);
        // No name this time (the lookup can fail), but a device that had one answered at this address last: same device.
        if (key === slug(d.ip) && !next[key]) {
            const prior = Object.entries(next).filter(([k, v]) => k !== key && !seen.has(k) && v.ip === d.ip && (k.startsWith("n-") || !/^\d/.test(k))).sort((x, y) => y[1].lastSeen - x[1].lastSeen)[0];
            if (prior) key = prior[0];
        }
        if (!key || seen.has(key)) continue;
        seen.add(key);
        // The device was in the book under its IP before it had a name: carry its history and your label over.
        const ipKey = slug(d.ip);
        if (key !== ipKey && !next[key] && next[ipKey] && !seen.has(ipKey)) {
            next[key] = { ...next[ipKey] };
            delete next[ipKey];
            moves.push({ from: ipKey, to: key });
        }
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
        const lbl = labels[key] || {};
        const label = lbl.label || next[key].name || next[key].ip;
        if (!old) events.push({ kind: "lan_new", key, known: false, text: `New device on the Wi-Fi: ${label} (${next[key].ip})` });
        else if (next[key].up && !wasUp && awayMs > LAN_GONE_MS) events.push({ kind: "lan_joined", key, known: Boolean(lbl.tag && lbl.tag !== "unknown"), text: `${label} joined the Wi-Fi` });
    }
    for (const [key, d] of Object.entries(next)) {
        if (seen.has(key)) continue;
        if (now - d.lastSeen > LAN_FORGET_MS) { delete next[key]; continue; }
        if (d.up && now - d.lastSeen > LAN_GONE_MS) {
            next[key] = { ...d, up: false };
            const label = (labels[key] && labels[key].label) || d.name || d.ip;
            events.push({ kind: "lan_left", key, text: `${label} left the Wi-Fi` });
        }
    }
    return { book: next, events, moves };
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

const TAGS = ["mine", "family", "guest", "unknown"];

/**
 * Who is at home. A person is home when one of their devices answers on the Wi-Fi: a Wi-Fi row you gave that person,
 * or their family phone (paired with Stashr) whose own address is answering on a tablet's scan.
 */
function presence(hubs, phones, now = Date.now()) {
    const people = new Map();
    const touch = (name) => { const k = name.trim(); if (!people.has(k)) people.set(k, { person: k, home: false, lastSeen: 0, devices: [] }); return people.get(k); };
    const upIps = new Set();
    for (const h of hubs || []) {
        const labels = h.lanLabels || {};
        for (const [key, d] of Object.entries(h.lanBook || {})) {
            const up = Boolean(d.up) && now - d.lastSeen < LAN_GONE_MS;
            if (up) upIps.add(d.ip);
            const who = labels[key] && labels[key].person;
            if (!who) continue;
            const p = touch(who);
            p.devices.push((labels[key] && labels[key].label) || d.name || d.ip);
            if (up) p.home = true;
            p.lastSeen = Math.max(p.lastSeen, d.lastSeen || 0);
        }
    }
    for (const ph of phones || []) {
        const s = ph.status || {};
        const p = touch(ph.person || ph.name);
        p.devices.push(ph.name);
        const recent = ph.lastSeen && now - new Date(ph.lastSeen).getTime() < 30 * 60 * 1000;
        if (recent && s.wifi && s.ip && upIps.has(s.ip)) p.home = true;
        if (recent && s.wifi && s.ip && upIps.has(s.ip)) p.lastSeen = Math.max(p.lastSeen, new Date(ph.lastSeen).getTime());
    }
    return [...people.values()].sort((a, b) => (b.home - a.home) || a.person.localeCompare(b.person));
}

/** True when the time (minutes after midnight) is inside a window that may wrap past midnight (e.g. 23:00–05:00). */
function inWindow(minutes, from, to) {
    if (from === to) return false;
    return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

module.exports = {
    ONLINE_MS, LAN_GONE_MS, MAX_COMMANDS, COMMANDS, KINDS, TAGS, RISKY_PORTS, hashToken, newToken, cleanCommand, cleanStatus,
    isOnline, lanKey, mergeLan, diffMovies, risksOf, presence, inWindow, okMac, normMac, slug
};
