/*
 * Who gets a new app version, controlled from the website (Settings → App updates, /app-updates). Administrators only.
 *
 *   GET /api/app-rollout            each app: its newest release, the rule for it, and the devices that could get it
 *   PUT /api/app-rollout/:app       { mode: "all" | "selected" | "hold", devices: [ids], defaultMode: "all" | "hold" }
 *
 * The rule belongs to ONE release (its version code). A newer release has no rule yet and follows defaultMode: "all" (as before) or
 * "hold" (nobody is offered it until you choose). Only apps that send their device token with the update check can be picked
 * one by one (Location, Hub, TV); the main Stashr app can only be all or hold. See utils/rollout.js.
 */
const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");
const { isAdminEmail } = require("../utils/features");
const HomeDevice = require("../models/homeDevice");
const AppRollout = require("../models/appRollout");
const rollout = require("../utils/rollout");

const adminOnly = (req, res, next) => (isAdminEmail(req.rootUser && req.rootUser.email) ? next() : res.status(403).json({ error: "Not allowed." }));
const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: "Too many changes. Slow down." });

const APPS = {
    android: { label: "Stashr (main app)", selectable: false },
    where: { label: "Stashr Location", selectable: true, pick: (d) => d.kind === "phone" && (d.status || {}).agent === "stashr-where" },
    hub: { label: "Stashr Hub (tablet)", selectable: true, pick: (d) => d.kind === "hub" },
    tv: { label: "Stashr TV", selectable: true, pick: (d) => d.kind === "tv" && !d.parent }
};

const latestOf = async (key) => {
    const updates = require("./mobileUpdates");
    const r = key === "android" ? await updates._latest.main() : await updates._latest.side(key);
    return { version: r.version, versionCode: r.versionCode, publishedAt: r.publishedAt || null, releaseNotes: r.releaseNotes || "" };
};

// The first version of each app that sends its device token with the update check. An older one is anonymous: it cannot be picked.
const IDENTITY_FROM = { where: "1.7.0", hub: "1.9.2", tv: "1.3.1" };
const semverGte = (v, min) => { const a = String(v || "").split(".").map(Number), b = min.split(".").map(Number); if (a.length !== 3 || a.some(Number.isNaN)) return null; for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]; return true; };

/** What version a device says it runs: Location reports it in its health, Hub and TV at the top of their status. */
const installedOf = (d) => {
    const s = d.status || {}, h = s.health || {};
    return { code: Number(s.versionCode || h.versionCode) || 0, version: String(s.version || h.appVersion || "") };
};

router.get("/", authenticate, adminOnly, async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        const owner = req.rootUser._id;
        const all = await HomeDevice.find({ owner }).lean();
        const apps = [];
        for (const [key, def] of Object.entries(APPS)) {
            let latest = null, error = "";
            try { latest = await latestOf(key); } catch (e) { error = "No release found yet."; }
            const row = await AppRollout.findOne({ app: key }).lean();
            const policy = { defaultMode: (row && row.defaultMode) || rollout.DEFAULT_MODE[key] || "all", rules: (row && row.rules) || {} };
            const explicit = latest ? policy.rules[String(latest.versionCode)] : null;
            const rule = explicit || { mode: policy.defaultMode, devices: [] };
            const devices = def.selectable ? all.filter(def.pick).map((d) => {
                const inst = installedOf(d);
                return { id: String(d._id), name: d.name, person: d.person || "", online: Boolean(d.lastSeen) && Date.now() - new Date(d.lastSeen).getTime() < 30 * 60 * 1000, lastSeen: d.lastSeen || null, installedVersion: inst.version, installedCode: inst.code,
                    upToDate: latest ? inst.code >= latest.versionCode : null, canIdentify: semverGte(inst.version, IDENTITY_FROM[key]), offered: latest ? rollout.allows(policy, latest.versionCode, String(d._id)) : null, identified: Boolean(d.tokenHash) };
            }) : [];
            apps.push({ key, label: def.label, selectable: def.selectable, identityFrom: IDENTITY_FROM[key] || "", latest, error, defaultMode: policy.defaultMode, rule: { mode: rule.mode, devices: rule.devices || [], explicit: Boolean(explicit) }, devices });
        }
        return res.json({ apps });
    } catch (e) { return res.status(500).json({ error: "Could not load the app updates." }); }
});

router.put("/:app", authenticate, adminOnly, writeLimiter, async (req, res) => {
    try {
        const key = req.params.app, def = APPS[key], b = req.body || {};
        if (!def) return res.status(404).json({ error: "Unknown app." });
        const owner = req.rootUser._id;
        const set = { updatedAt: new Date() };
        if (b.defaultMode !== undefined) {
            if (!["all", "hold"].includes(b.defaultMode)) return res.status(400).json({ error: "The default is “all” or “hold”." });
            set.defaultMode = b.defaultMode;
        }
        if (b.mode !== undefined) {
            if (!["all", "selected", "hold"].includes(b.mode)) return res.status(400).json({ error: "Choose all, selected or hold." });
            if (b.mode === "selected" && !def.selectable) return res.status(400).json({ error: "The main app cannot be sent to chosen devices; choose everyone or hold." });
            let latest;
            try { latest = await latestOf(key); } catch (e) { return res.status(404).json({ error: "There is no release of this app yet." }); }
            const mine = new Set((await HomeDevice.find({ owner }).select("_id").lean()).map((d) => String(d._id)));
            const devices = [...new Set((Array.isArray(b.devices) ? b.devices : []).map(String).filter((id) => mine.has(id)))];
            if (b.mode === "selected" && !devices.length) return res.status(400).json({ error: "Tick at least one device, or choose hold." });
            set[`rules.${latest.versionCode}`] = { mode: b.mode, devices: b.mode === "selected" ? devices : [], at: new Date() };
        }
        await AppRollout.updateOne({ app: key }, { $set: set, $setOnInsert: { app: key } }, { upsert: true });
        rollout.forget(key);
        return res.json({ ok: true });
    } catch (e) { return res.status(500).json({ error: "Could not save." }); }
});

module.exports = router;
