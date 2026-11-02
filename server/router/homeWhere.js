/*
 * Stashr Location: a tiny Android app for family phones that shares only the phone's location with this server.
 * The phone joins with ONE fixed code that the Smart home page shows (it can be replaced there), so nobody types the
 * Stashr password on it, and the phone never sees anything of the vault.
 *
 *   Signed-in user                                  Phone (token in "Authorization: Bearer sh_...")
 *   GET  /home/location-code   the code (also /home/hub-code for the tablet)              POST /home/agent/link       code + name in, token out
 *   POST /home/location-code/rotate  a new one       POST /home/agent/location   a fix in; where it is, the next check, notices out
 *   GET  /home/where           everyone's whereabouts POST /home/agent/unlink      the phone disconnects itself
 */
const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");
const HomeDevice = require("../models/homeDevice");
const HomeSettings = require("../models/homeSettings");
const home = require("../utils/home");
const automation = require("../utils/homeAutomation");
const { record } = require("../utils/homeEvents");
const homeRouter = require("./home");

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: "Too many changes. Slow down." });
const agentLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: "Too many requests." });
const linkLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: "Too many tries. Wait a few minutes." });
const fail = (res, error, fallback) => res.status(Number.isInteger(error.status) ? error.status : 500).json({ error: Number.isInteger(error.status) ? error.message : fallback });

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from(crypto.randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join("");
const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// Two fixed codes: one links family phones (Stashr Location), the other links the home tablet (Stashr Hub). A tablet
// can see the dashboard and the slideshow photos, so its code is never the one that is handed to the family.
async function codeOf(owner, field = "locationCode") {
    const s = await automation.settingsOf(owner);
    if (s[field]) return s[field];
    await HomeSettings.updateOne({ owner, $or: [{ [field]: "" }, { [field]: { $exists: false } }] }, { $set: { [field]: newCode() } });
    return (await automation.settingsOf(owner))[field];
}

router.get("/home/location-code", authenticate, async (req, res) => {
    try { res.set("Cache-Control", "no-store"); return res.json({ code: await codeOf(req.rootUser._id) }); }
    catch (e) { return fail(res, e, "Could not load the code."); }
});

router.post("/home/location-code/rotate", authenticate, writeLimiter, async (req, res) => {
    try {
        await codeOf(req.rootUser._id);
        const code = newCode();
        await HomeSettings.updateOne({ owner: req.rootUser._id }, { $set: { locationCode: code } });
        return res.json({ code });
    } catch (e) { return fail(res, e, "Could not make a new code."); }
});

router.get("/home/hub-code", authenticate, async (req, res) => {
    try { res.set("Cache-Control", "no-store"); return res.json({ code: await codeOf(req.rootUser._id, "hubCode") }); }
    catch (e) { return fail(res, e, "Could not load the code."); }
});

router.post("/home/hub-code/rotate", authenticate, writeLimiter, async (req, res) => {
    try {
        await codeOf(req.rootUser._id, "hubCode");
        const code = newCode();
        await HomeSettings.updateOne({ owner: req.rootUser._id }, { $set: { hubCode: code } });
        return res.json({ code });
    } catch (e) { return fail(res, e, "Could not make a new code."); }
});

// The phone types the fixed code and its owner's name: it gets its own token, which can only send its location.
router.post("/home/agent/link", linkLimiter, async (req, res) => {
    try {
        const b = req.body || {};
        const code = normCode(b.code);
        if (code.length !== 8) return res.status(400).json({ error: "Type the 8-letter code shown on the Stashr Smart home page." });
        const tablet = b.kind === "hub";
        const s = await HomeSettings.findOne(tablet ? { hubCode: code } : { locationCode: code }).lean();
        if (!s) return res.status(400).json({ error: "That code is not right. Check it on the Stashr Smart home page." });
        const name = String(b.name || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 60);
        if (name.length < 2) return res.status(400).json({ error: tablet ? "Give the tablet a name (at least 2 letters)." : "Type your name (at least 2 letters)." });
        const owner = s.owner;
        if (await HomeDevice.countDocuments({ owner, parent: { $exists: false } }) >= 20) return res.status(400).json({ error: "This Stashr home already has the most devices it can hold." });
        if (await HomeDevice.exists({ owner, kind: tablet ? "hub" : "phone", name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") })) return res.status(409).json({ error: tablet ? "A tablet with that name is already linked. Pick another name." : "Someone with that name is already linked. Add your surname or pick another name." });
        const token = home.newToken();
        const device = await HomeDevice.create(tablet
            ? { owner, name, kind: "hub", tokenHash: home.hashToken(token), tokenHint: token.slice(-4) }
            : { owner, name, kind: "phone", person: name, tokenHash: home.hashToken(token), tokenHint: token.slice(-4), status: { agent: "stashr-where" } });
        await record({ owner, device: device._id, deviceName: name, kind: "paired", text: tablet ? `${name} joined Stashr Home (tablet)` : `${name} linked their phone (Stashr Location)` });
        return res.status(201).json({ token, deviceId: String(device._id), name, device: { id: String(device._id), name, kind: tablet ? "hub" : "phone" } });
    } catch (e) { return fail(res, e, "Could not link."); }
});

const num = (v) => (v === undefined || v === null || v === "" ? NaN : Number(v));

router.post("/home/agent/location", agentLimiter, (req, res, next) => homeRouter.agentAuth(req, res, next), async (req, res) => {
    try {
        const d = req.device;
        if (d.kind !== "phone") return res.status(403).json({ error: "Only a family phone can share its location." });
        const b = req.body || {};
        const lat = num(b.lat), lon = num(b.lon);
        if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return res.status(400).json({ error: "The location is not valid." });
        const now = Date.now();
        let at = num(b.at);
        if (!Number.isFinite(at) || at > now + 60_000 || at < now - 24 * 3600_000) at = now;
        const loc = { lat, lon, acc: Math.min(Math.max(num(b.acc) || 0, 0), 100000), at };
        if (Number.isFinite(num(b.speed)) && num(b.speed) >= 0) loc.speed = Math.min(num(b.speed), 100);
        const status = { agent: "stashr-where", location: loc };
        if (b.battery && Number.isFinite(num(b.battery.pct))) status.battery = { pct: Math.min(Math.max(Math.round(num(b.battery.pct)), 0), 100), charging: b.battery.charging === true };
        status.wifi = Boolean(b.wifi && b.wifi.connected);
        status.ip = b.wifi && /^\d{1,3}(\.\d{1,3}){3}$/.test(String(b.wifi.ip || "")) ? String(b.wifi.ip) : "";
        const out = await homeRouter.ingest(d, { status });
        if (out.error) return res.status(400).json({ error: out.error });
        // Work out the trip now (the Wi-Fi sees this phone too) and answer with where it is and when to look again.
        const settings = await automation.settingsOf(d.owner);
        const all = await HomeDevice.find({ owner: d.owner }).lean();
        await automation.etaTick(d.owner, now, settings, all);
        const fresh = await automation.settingsOf(d.owner);
        const me = all.find((x) => String(x._id) === String(d._id)) || d;
        const where = automation.whereIs(fresh, { ...me, status: { ...(me.status || {}), location: loc } }, now);
        return res.json({
            ok: true, state: where.state, distanceKm: where.distanceKm ?? null, etaMinutes: where.state === "home" ? 0 : where.etaMinutes ?? null,
            nextCheckSec: automation.checkInterval(where), home: { set: where.state !== "unset" },
            notices: (out.commands || []).filter((c) => c.type === "notice").map((c) => ({ id: c.id, text: (c.args || {}).text || "" })).filter((n) => n.text)
        });
    } catch (e) { return fail(res, e, "Could not save the location."); }
});

router.post("/home/agent/unlink", agentLimiter, (req, res, next) => homeRouter.agentAuth(req, res, next), async (req, res) => {
    try {
        const d = req.device;
        await HomeDevice.deleteOne({ _id: d._id });
        await record({ owner: d.owner, kind: "unpaired", text: `${d.name} disconnected their phone (Stashr Location)` });
        return res.json({ ok: true });
    } catch (e) { return fail(res, e, "Could not disconnect."); }
});

// The page: who is where, how far from home, and how long they will take.
router.get("/home/where", authenticate, async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        const owner = req.rootUser._id, now = Date.now();
        const s = await automation.settingsOf(owner);
        const phones = (await HomeDevice.find({ owner, kind: "phone" }).lean()).filter((p) => (p.status || {}).location || (p.status || {}).agent === "stashr-where");
        return res.json({
            homeSet: Boolean(s.homeSpot && Number.isFinite(s.homeSpot.lat)),
            people: phones.map((p) => {
                const w = automation.whereIs(s, p, now), st = p.status || {};
                return { id: String(p._id), name: p.person || p.name, app: st.agent === "stashr-where" ? "Stashr Location" : "Stashr Hub", ...w,
                    battery: st.battery ? { pct: st.battery.pct ?? null, charging: Boolean(st.battery.charging) } : null, lastSeen: p.lastSeen || null,
                    wifi: Boolean(st.wifi), accuracyM: st.location ? Math.round(st.location.acc || 0) : null };
            }).sort((a, b) => ({ coming: 0, away: 1, home: 2, unknown: 3, unset: 4 }[a.state] - { coming: 0, away: 1, home: 2, unknown: 3, unset: 4 }[b.state]) || a.name.localeCompare(b.name))
        });
    } catch (e) { return fail(res, e, "Could not load where everyone is."); }
});

module.exports = router;
