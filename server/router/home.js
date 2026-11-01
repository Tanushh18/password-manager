/**
 * Stashr Home: the TV and the always-on tablet report here, and you see and control them from the Stashr web page.
 *
 *   Signed-in user                                   Device (token in "Authorization: Bearer sh_...")
 *   GET    /home/devices                             POST /home/agent/report   status in, commands out
 *   POST   /home/devices            add a device
 *   DELETE /home/devices/:id
 *   POST   /home/devices/:id/token  new token
 *   POST   /home/devices/:id/commands
 *   PUT    /home/devices/:id/lan/:key   name / room of a Wi-Fi device
 *   GET    /home/events
 *
 * A device token can only call /home/agent/report. It cannot read the vault or anything else.
 */
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");
const HomeDevice = require("../models/homeDevice");
const HomeEvent = require("../models/homeEvent");
const home = require("../utils/home");
const assistant = require("../utils/homeAssistant");
const { record } = require("../utils/homeEvents");

const MAX_DEVICES = 10;
const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: "Too many changes. Slow down." });
const agentLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, message: "Too many reports." });

const fail = (res, error, fallback) => res.status(Number.isInteger(error.status) ? error.status : 500).json({ error: Number.isInteger(error.status) ? error.message : fallback });
const validId = (id) => mongoose.isValidObjectId(id);

/** What the web page and the app are allowed to see about a device. Never the token hash. */
function publicDevice(d, now = Date.now()) {
    const out = {
        id: String(d._id), name: d.name, kind: d.kind, tokenHint: d.tokenHint || "", viaHub: Boolean(d.parent),
        online: Boolean(d.online) && home.isOnline(d, now), lastSeen: d.lastSeen || null, onlineSince: d.onlineSince || null,
        status: d.status || {},
        commands: (d.commands || []).slice(-10).reverse().map((c) => ({ id: c.id, type: c.type, args: c.args, status: c.status, result: c.result, createdAt: c.createdAt }))
    };
    if (d.kind === "hub") {
        const labels = d.lanLabels || {};
        out.lan = Object.entries(d.lanBook || {}).map(([key, v]) => ({
            key, ...v, label: (labels[key] && labels[key].label) || "", room: (labels[key] && labels[key].room) || ""
        })).sort((a, b) => (b.up - a.up) || (b.lastSeen - a.lastSeen));
    }
    return out;
}

/* ───────── you ───────── */

router.get("/home/devices", authenticate, async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        const list = await HomeDevice.find({ owner: req.rootUser._id }).sort({ createdAt: 1 }).lean();
        return res.json({ devices: list.map((d) => publicDevice(d)) });
    } catch (e) { return fail(res, e, "Could not load your devices."); }
});

router.post("/home/devices", authenticate, writeLimiter, async (req, res) => {
    try {
        const name = String((req.body && req.body.name) || "").trim().slice(0, 60);
        const kind = String((req.body && req.body.kind) || "");
        if (!name) return res.status(400).json({ error: "Give the device a name." });
        if (!["tv", "hub"].includes(kind)) return res.status(400).json({ error: "Device kind must be tv or hub." });
        if (await HomeDevice.countDocuments({ owner: req.rootUser._id, parent: { $exists: false } }) >= MAX_DEVICES) return res.status(400).json({ error: `You can add up to ${MAX_DEVICES} devices.` });
        const token = home.newToken();
        // The tablet app signs in and registers itself. Signing in again on the same tablet (same name) takes over
        // its place with a fresh token, instead of adding a second tablet.
        if (kind === "hub" && req.body.reuse === true) {
            const again = await HomeDevice.findOneAndUpdate({ owner: req.rootUser._id, kind: "hub", name, parent: { $exists: false } }, { $set: { tokenHash: home.hashToken(token), tokenHint: token.slice(-4) } }, { returnDocument: "after" });
            if (again) return res.status(200).json({ device: publicDevice(again), token });
        }
        const device = await HomeDevice.create({ owner: req.rootUser._id, name, kind, tokenHash: home.hashToken(token), tokenHint: token.slice(-4) });
        return res.status(201).json({ device: publicDevice(device), token });
    } catch (e) { return fail(res, e, "Could not add the device."); }
});

router.post("/home/devices/:id/token", authenticate, writeLimiter, async (req, res) => {
    try {
        if (!validId(req.params.id)) return res.status(404).json({ error: "Device not found." });
        const token = home.newToken();
        const r = await HomeDevice.updateOne({ _id: req.params.id, owner: req.rootUser._id, parent: { $exists: false } }, { $set: { tokenHash: home.hashToken(token), tokenHint: token.slice(-4) } });
        if (!r.matchedCount) return res.status(404).json({ error: "Device not found." });
        return res.json({ token });
    } catch (e) { return fail(res, e, "Could not make a new token."); }
});

router.put("/home/devices/:id", authenticate, writeLimiter, async (req, res) => {
    try {
        const name = String((req.body && req.body.name) || "").trim().slice(0, 60);
        if (!validId(req.params.id) || !name) return res.status(400).json({ error: "Give the device a name." });
        const r = await HomeDevice.updateOne({ _id: req.params.id, owner: req.rootUser._id }, { $set: { name } });
        if (!r.matchedCount) return res.status(404).json({ error: "Device not found." });
        return res.json({ ok: true });
    } catch (e) { return fail(res, e, "Could not rename it."); }
});

router.delete("/home/devices/:id", authenticate, writeLimiter, async (req, res) => {
    try {
        if (!validId(req.params.id)) return res.status(404).json({ error: "Device not found." });
        const r = await HomeDevice.deleteOne({ _id: req.params.id, owner: req.rootUser._id });
        if (!r.deletedCount) return res.status(404).json({ error: "Device not found." });
        await HomeDevice.deleteMany({ owner: req.rootUser._id, parent: req.params.id });
        await HomeEvent.deleteMany({ owner: req.rootUser._id, device: req.params.id });
        return res.json({ ok: true });
    } catch (e) { return fail(res, e, "Could not remove the device."); }
});

router.post("/home/devices/:id/commands", authenticate, writeLimiter, async (req, res) => {
    try {
        if (!validId(req.params.id)) return res.status(404).json({ error: "Device not found." });
        const device = await HomeDevice.findOne({ _id: req.params.id, owner: req.rootUser._id }).lean();
        if (!device) return res.status(404).json({ error: "Device not found." });
        const command = home.cleanCommand(device.kind, String((req.body && req.body.type) || ""), req.body && req.body.args);
        if (!command) return res.status(400).json({ error: "That command is not allowed for this device." });
        const waiting = (device.commands || []).filter((c) => c.status === "pending" || c.status === "sent").length;
        if (waiting >= home.MAX_COMMANDS) return res.status(429).json({ error: "Too many commands are waiting. Wait for the device to catch up." });
        const entry = { id: new mongoose.Types.ObjectId().toString(), ...command, status: "pending", result: "", createdAt: new Date() };
        await HomeDevice.updateOne({ _id: device._id }, { $push: { commands: { $each: [entry], $slice: -50 } } });
        await record({ owner: req.rootUser._id, device: device._id, deviceName: device.name, kind: "command", text: `Sent to ${device.name}: ${command.type}${command.args.name ? " " + command.args.name : ""}` });
        return res.status(202).json({ id: entry.id });
    } catch (e) { return fail(res, e, "Could not send the command."); }
});

router.put("/home/devices/:id/lan/:key", authenticate, writeLimiter, async (req, res) => {
    try {
        if (!validId(req.params.id) || !/^[a-z0-9-]{1,60}$/.test(req.params.key)) return res.status(404).json({ error: "Device not found." });
        const label = String((req.body && req.body.label) || "").trim().slice(0, 60);
        const room = String((req.body && req.body.room) || "").trim().slice(0, 60);
        const r = await HomeDevice.updateOne({ _id: req.params.id, owner: req.rootUser._id, kind: "hub" }, { $set: { ["lanLabels." + req.params.key]: { label, room } } });
        if (!r.matchedCount) return res.status(404).json({ error: "Device not found." });
        return res.json({ ok: true });
    } catch (e) { return fail(res, e, "Could not save."); }
});

router.get("/home/events", authenticate, async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
        const events = await HomeEvent.find({ owner: req.rootUser._id }).sort({ at: -1 }).limit(limit).lean();
        return res.json({ events: events.map((e) => ({ id: String(e._id), device: e.deviceName, kind: e.kind, text: e.text, at: e.at })) });
    } catch (e) { return fail(res, e, "Could not load events."); }
});

/** "volume up", "open netflix", "status": one sentence in, the command out to the right device. */
router.post("/home/assistant", authenticate, writeLimiter, async (req, res) => {
    try {
        const sentence = String((req.body && req.body.text) || "").slice(0, 200);
        const owned = await HomeDevice.find({ owner: req.rootUser._id }).lean();
        const devices = owned.map((d) => publicDevice(d));
        const out = assistant.parse(sentence, devices);
        if (out.status) return res.json({ reply: assistant.statusLine(devices), sent: [] });
        const sent = [];
        for (const c of out.commands || []) {
            const target = owned.find((d) => d.kind === c.kind);
            const command = target && home.cleanCommand(c.kind, c.type, c.args);
            if (!command) continue;
            const waiting = (target.commands || []).filter((x) => x.status === "pending" || x.status === "sent").length;
            if (waiting >= home.MAX_COMMANDS) return res.status(429).json({ error: "Too many commands are waiting. Wait for the device to catch up." });
            const entry = { id: new mongoose.Types.ObjectId().toString(), ...command, status: "pending", result: "", createdAt: new Date() };
            await HomeDevice.updateOne({ _id: target._id }, { $push: { commands: { $each: [entry], $slice: -50 } } });
            sent.push({ device: target.name, id: entry.id, type: command.type });
        }
        return res.json({ reply: out.reply, sent });
    } catch (e) { return fail(res, e, "Could not do that."); }
});

/* ───────── a device ───────── */

const agentAuth = async (req, res, next) => {
    const m = /^Bearer (sh_[a-f0-9]{48})$/.exec(req.headers.authorization || "");
    if (!m) return res.status(401).json({ error: "Bad device token." });
    const device = await HomeDevice.findOne({ tokenHash: home.hashToken(m[1]) });
    if (!device) return res.status(401).json({ error: "Bad device token." });
    req.device = device;
    next();
};

/**
 * One report from a device, whether it came itself or through the tablet. Stores the status, notes what changed
 * (on, standby, a movie added, a device joined the Wi-Fi), settles the results of earlier commands and hands out new
 * ones. `seenAt` is when the device really spoke, which for a TV behind the tablet is a moment ago.
 * Returns { error } or { commands }.
 */
async function ingest(d, body, seenAt = new Date()) {
    const now = seenAt, prev = d.status || {};
    const wasOnline = Boolean(d.online) && home.isOnline(d, now.getTime());
    const base = { owner: d.owner, device: d._id, deviceName: d.name };

    // The device is switching itself off (TV standby): show it as off at once instead of after a timeout.
    if (body.leaving === true) {
        await HomeDevice.updateOne({ _id: d._id }, { $set: { online: false, "status.screen": "off" } });
        if (wasOnline) await record({ ...base, kind: "offline", text: `${d.name} switched off`, notify: d.kind === "tv" });
        return { commands: [] };
    }

    const status = home.cleanStatus(body.status);
    if (!status) return { error: "Status is missing or too big." };

    const set = { lastSeen: now, online: true };
    if (!wasOnline) set.onlineSince = now;
    const events = [];

    if (d.kind === "hub") {
        const merged = home.mergeLan(d.lanBook || {}, status.lan, d.lanLabels || {}, now.getTime());
        set.lanBook = merged.book;
        events.push(...merged.events);
        status.lanCount = Object.values(merged.book).filter((x) => x.up).length;
        delete status.lan;
    } else {
        events.push(...home.diffMovies(prev, status));
        const up = status.upload || {};
        if (up.lastAt && up.lastName && up.lastAt !== (prev.upload && prev.upload.lastAt)) events.push({ kind: "upload", text: `Uploaded to the USB drive: ${up.lastName}` });
    }
    set.status = status;
    await HomeDevice.updateOne({ _id: d._id }, { $set: set });

    // Online / on / standby: what you asked to be told about the TV.
    if (d.kind === "tv") {
        const screenOn = status.screen !== "off", wasScreenOn = prev.screen !== "off";
        if (!wasOnline) events.push({ kind: "online", text: screenOn ? `${d.name} is on` : `${d.name} is connected (standby)`, notify: screenOn });
        else if (screenOn && !wasScreenOn) events.push({ kind: "online", text: `${d.name} turned on`, notify: true });
        else if (!screenOn && wasScreenOn) events.push({ kind: "standby", text: `${d.name} went to standby`, notify: true });
    } else if (!wasOnline) {
        events.push({ kind: "online", text: `${d.name} is back online`, notify: false });
    }
    for (const e of events.slice(0, 30)) await record({ ...base, ...e });

    // Results of earlier commands.
    for (const a of (Array.isArray(body.acks) ? body.acks.slice(0, 20) : [])) {
        if (!a || typeof a.id !== "string") continue;
        await HomeDevice.updateOne({ _id: d._id }, {
            $set: { "commands.$[c].status": a.ok ? "done" : "failed", "commands.$[c].result": String(a.message || "").slice(0, 200), "commands.$[c].doneAt": new Date() }
        }, { arrayFilters: [{ "c.id": a.id, "c.status": { $in: ["pending", "sent"] } }] });
    }

    // New commands go out once: pending becomes sent.
    const fresh = await HomeDevice.findById(d._id).select("commands").lean();
    const out = (fresh.commands || []).filter((c) => c.status === "pending").map((c) => ({ id: c.id, type: c.type, args: c.args }));
    if (out.length) await HomeDevice.updateOne({ _id: d._id }, { $set: { "commands.$[c].status": "sent" } }, { arrayFilters: [{ "c.status": "pending" }] });
    return { commands: out };
}

const MAX_CHILDREN = 3;

/** The TV that reports through the tablet becomes a device of its own the first time it is seen. */
async function childOf(hub, key, name) {
    if (!/^[a-z0-9]{1,20}$/.test(key)) return null;
    let child = await HomeDevice.findOne({ owner: hub.owner, parent: hub._id, childKey: key });
    if (child) return child;
    if (await HomeDevice.countDocuments({ parent: hub._id }) >= MAX_CHILDREN) return null;
    return HomeDevice.create({ owner: hub.owner, parent: hub._id, childKey: key, kind: "tv", name: String(name || "TV").trim().slice(0, 60) || "TV" });
}

router.post("/home/agent/report", agentLimiter, agentAuth, async (req, res) => {
    try {
        const d = req.device, body = req.body || {};
        const own = await ingest(d, body);
        if (own.error) return res.status(400).json({ error: own.error });

        // The tablet carries the TV's reports: each is stored as a device of its own, and the TV's commands come back here.
        const childCommands = {};
        if (d.kind === "hub" && Array.isArray(body.children)) {
            for (const c of body.children.slice(0, MAX_CHILDREN)) {
                if (!c || typeof c !== "object") continue;
                const key = String(c.key || ""), status = c.status && typeof c.status === "object" ? c.status : null;
                const child = await childOf(d, key, c.name || (status && status.deviceName));
                if (!child) continue;
                const ago = Math.min(Math.max(Number(c.seenAgoMs) || 0, 0), 10 * 60 * 1000);
                const r = await ingest(child, { status, leaving: c.leaving === true, acks: c.acks }, new Date(Date.now() - ago));
                childCommands[key] = r.commands || [];
            }
        }
        return res.json({ ok: true, commands: own.commands, childCommands, serverTime: new Date().toISOString() });
    } catch (e) { return fail(res, e, "Could not save the report."); }
});

module.exports = router;
