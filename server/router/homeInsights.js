/*
 * Family insights: places, trips, the usual commute and a driving report, worked out from the location history that the
 * owner can switch on. Shown ONLY on the Stashr website and on the home tablet's screen, never on a phone or the TV.
 *
 *   GET    /home/insights      the numbers          PUT /home/history   { enabled, speedKmh }
 *   PUT    /home/spots         name places          DELETE /home/history   erase every stored fix
 */
const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");
const HomeDevice = require("../models/homeDevice");
const HomeSettings = require("../models/homeSettings");
const HomeTrack = require("../models/homeTrack");
const automation = require("../utils/homeAutomation");
const ins = require("../utils/homeInsights");
const trail = require("../utils/homeTrail");
const route = require("../utils/homeRoute");

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: "Too many changes. Slow down." });
const fail = (res, error, fallback) => res.status(Number.isInteger(error.status) ? error.status : 500).json({ error: Number.isInteger(error.status) ? error.message : fallback });
const DAYS = 14;

/** Called for every fix of a phone running Stashr Location: keeps it when the history is on (at most one per ~100 s). */
const lastKept = new Map();    // phone id -> { at (ms), lat, lon }: no database read for the usual "nothing new" case
async function keepFix(owner, phone, person, loc, settings) {
    if (!settings.history || !settings.history.enabled) return;
    const key = String(phone._id);
    let last = lastKept.get(key);
    if (!last) { const row = await HomeTrack.findOne({ owner, phone: phone._id }).sort({ at: -1 }).select("at lat lon").lean(); last = row ? { at: row.at.getTime(), lat: row.lat, lon: row.lon } : null; }
    if (last && Number(loc.at) - last.at < 100000 && ins.dist(last, loc) < 150) { lastKept.set(key, last); return; }
    lastKept.set(key, { at: Number(loc.at), lat: loc.lat, lon: loc.lon });
    if (lastKept.size > 500) lastKept.delete(lastKept.keys().next().value);
    await HomeTrack.create({ owner, phone: phone._id, person, at: new Date(Number(loc.at)), lat: loc.lat, lon: loc.lon, acc: loc.acc || 0, ...(Number.isFinite(loc.speed) ? { speed: loc.speed } : {}) });
}

const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;

function nameFor(point, spots, homeSpot) {
    if (homeSpot && Number.isFinite(homeSpot.lat) && ins.dist(point, homeSpot) <= (homeSpot.radius || 200) + 100) return "Home";
    const s = (spots || []).find((x) => ins.dist(point, x) <= (x.radius || 150) + 100);
    return s ? s.name : null;
}

/** Everything for one person from their fixes. */
function analyse(fixes, settings, now) {
    const tz = settings.timezone || "Asia/Kolkata";
    const st = ins.stops(fixes), tr = ins.trips(fixes, st);
    const named = tr.map((t) => ({ ...t, fromName: nameFor({ lat: t.fromLat, lon: t.fromLon }, settings.spots, settings.homeSpot), toName: nameFor({ lat: t.toLat, lon: t.toLon }, settings.spots, settings.homeSpot) }));
    const local = (ms) => { const p = new Date(ms).toLocaleString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" }).split(", "); return p; };
    const wd = (ms) => new Date(new Date(ms).toLocaleString("en-US", { timeZone: tz })).getDay();
    const mins = (ms) => { const d = new Date(new Date(ms).toLocaleString("en-US", { timeZone: tz })); return d.getHours() * 60 + d.getMinutes(); };
    // The way home from a named place (not Home): when they usually leave, and how long it takes.
    const home = {};
    for (const t of named) {
        if (t.toName !== "Home" || !t.fromName || t.fromName === "Home") continue;
        const h = home[t.fromName] || (home[t.fromName] = { leave: [], byDay: {}, minutes: [], days: {} });
        const m = mins(t.from), d = wd(t.from);
        h.leave.push(m); (h.byDay[d] = h.byDay[d] || []).push(m); h.minutes.push(t.minutes);
        const key = new Date(t.from).toLocaleDateString("en-CA", { timeZone: tz }); h.days[key] = t.minutes;
    }
    const commute = Object.entries(home).filter(([, h]) => h.leave.length >= 3).map(([place, h]) => ({
        place, trips: h.leave.length, usualMinutes: Math.round(ins.median(h.minutes)), usualLeave: hhmm(ins.median(h.leave)),
        byDay: Object.fromEntries(Object.entries(h.byDay).filter(([, a]) => a.length >= 2).map(([d, a]) => [d, hhmm(ins.median(a))])),
        series: Object.entries(h.days).sort().slice(-14).map(([date, minutes]) => ({ date, minutes }))
    }));
    const week = named.filter((t) => now - t.to < 7 * 24 * 3600 * 1000);
    const limit = (settings.history && settings.history.speedKmh) || 80;
    return {
        trips: named.slice(-30).reverse(), commute,
        driving: { trips: week.length, km: Math.round(week.reduce((a, t) => a + t.km, 0) * 10) / 10, maxKmh: week.reduce((a, t) => Math.max(a, t.maxKmh), 0), over: week.filter((t) => t.maxKmh > limit).length, limit,
            note: "Speeds are the highest seen in a location fix (one every 1 to 30 minutes), so real peaks can be higher. Hard braking cannot be measured." },
        stops: st
    };
}

async function loadFixes(owner, phone, now) {
    const rows = await HomeTrack.find({ owner, phone: phone._id, at: { $gte: new Date(now - DAYS * 24 * 3600 * 1000) } }).sort({ at: 1 }).limit(8000).lean();
    return rows.map((r) => ({ at: r.at.getTime(), lat: r.lat, lon: r.lon, speed: r.speed }));
}

router.get("/home/insights", authenticate, async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        const owner = req.rootUser._id, now = Date.now();
        const s = await automation.settingsOf(owner);
        const phones = await HomeDevice.find({ owner, kind: "phone" }).lean();
        const people = [], allStops = [];
        for (const p of phones) {
            const fixes = await loadFixes(owner, p, now);
            if (!fixes.length) continue;
            const a = analyse(fixes, s, now);
            allStops.push(...a.stops);
            people.push({ id: String(p._id), name: p.person || p.name, fixes: fixes.length, since: fixes[0].at, trips: a.trips, commute: a.commute, driving: a.driving });
        }
        const known = (c) => nameFor(c, s.spots, s.homeSpot);
        return res.json({
            enabled: Boolean(s.history && s.history.enabled), speedKmh: (s.history && s.history.speedKmh) || 80, homeSet: Boolean(s.homeSpot && Number.isFinite(s.homeSpot.lat)),
            spots: s.spots || [], people,
            candidates: ins.candidates(allStops, s.timezone || "Asia/Kolkata").filter((c) => !known(c)).map((c, i) => ({ ...c, id: `c${i}` }))
        });
    } catch (e) { return fail(res, e, "Could not load the insights."); }
});

// Every phone's last 24 hours in detail: the day as stays and trips, and every stored point (time, coordinates, accuracy).
router.get("/home/trail", authenticate, async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        const owner = req.rootUser._id, now = Date.now();
        const s = await automation.settingsOf(owner);
        const phones = (await HomeDevice.find({ owner, kind: "phone" }).lean()).filter((p) => (p.status || {}).agent === "stashr-where");
        return res.json({ hours: 24, homeSet: Boolean(s.homeSpot && Number.isFinite(s.homeSpot.lat)), people: await trail.dayTrail(owner, s, phones, now), at: now });
    } catch (e) { return fail(res, e, "Could not load the last 24 hours."); }
});

router.put("/home/history", authenticate, writeLimiter, async (req, res) => {
    try {
        const b = req.body || {}, owner = req.rootUser._id;
        const cur = (await automation.settingsOf(owner)).history || {};
        const speed = b.speedKmh !== undefined ? Number(b.speedKmh) : (cur.speedKmh || 80);
        if (!Number.isInteger(speed) || speed < 30 || speed > 200) return res.status(400).json({ error: "The speed limit is 30 to 200 km/h." });
        await HomeSettings.updateOne({ owner }, { $set: { history: { enabled: typeof b.enabled === "boolean" ? b.enabled : cur.enabled === true, speedKmh: speed } } });
        return res.json({ ok: true });
    } catch (e) { return fail(res, e, "Could not save."); }
});

router.delete("/home/history", authenticate, writeLimiter, async (req, res) => {
    try { const r = await HomeTrack.deleteMany({ owner: req.rootUser._id }); return res.json({ deleted: r.deletedCount || 0 }); }
    catch (e) { return fail(res, e, "Could not delete."); }
});

router.put("/home/spots", authenticate, writeLimiter, async (req, res) => {
    try {
        const list = Array.isArray(req.body && req.body.spots) ? req.body.spots : null;
        if (!list || list.length > 12) return res.status(400).json({ error: "Up to 12 named places." });
        const clean = [];
        for (const x of list) {
            const lat = Number(x && x.lat), lon = Number(x && x.lon), radius = Math.round(Number(x && x.radius) || 150);
            const name = String((x && x.name) || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 30);
            if (!name || name.toLowerCase() === "home" || !(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) || !(radius >= 50 && radius <= 1000)) return res.status(400).json({ error: "Each place needs a name (not “Home”), a location and a radius of 50 to 1000 m." });
            clean.push({ id: /^[a-f0-9]{12}$/.test(x.id || "") ? x.id : crypto.randomBytes(6).toString("hex"), name, lat, lon, radius });
        }
        await HomeSettings.updateOne({ owner: req.rootUser._id }, { $set: { spots: clean } });
        return res.json({ spots: clean });
    } catch (e) { return fail(res, e, "Could not save the places."); }
});

/* ───────── for the tablet: "leave now" nudges and today's trips ───────── */

const cache = new Map();   // owner -> { at, value }
async function tabletLines(owner, settings, now = Date.now()) {
    if (!settings.history || !settings.history.enabled) return { nudges: [], trips: [] };
    const hit = cache.get(String(owner));
    if (hit && now - hit.at < 5 * 60 * 1000) return hit.value;
    const tz = settings.timezone || "Asia/Kolkata";
    const nudges = [], tripsToday = [];
    const phones = await HomeDevice.find({ owner, kind: "phone" }).lean();
    const today = new Date(now).toLocaleDateString("en-CA", { timeZone: tz });
    const nowMin = (() => { const d = new Date(new Date(now).toLocaleString("en-US", { timeZone: tz })); return d.getHours() * 60 + d.getMinutes(); })();
    const dow = new Date(new Date(now).toLocaleString("en-US", { timeZone: tz })).getDay();
    for (const p of phones) {
        const fixes = await loadFixes(owner, p, now);
        if (fixes.length < 6) continue;
        const person = p.person || p.name, a = analyse(fixes, settings, now);
        for (const t of a.trips) if (new Date(t.to).toLocaleDateString("en-CA", { timeZone: tz }) === today) tripsToday.push(`${person}: ${t.fromName || "—"} → ${t.toName || "—"}, ${t.minutes} min, ${t.km} km`);
        const loc = p.status && p.status.location;
        if (!loc || now - Number(loc.at) > 45 * 60 * 1000 || !settings.homeSpot) continue;
        const here = nameFor({ lat: loc.lat, lon: loc.lon }, settings.spots, settings.homeSpot);
        const c = a.commute.find((x) => x.place === here);
        if (!c) continue;
        const usual = c.byDay[dow] || c.usualLeave;
        const [h, m] = usual.split(":").map(Number), leave = h * 60 + m;
        if (nowMin < leave - 30 || nowMin > leave + 45) continue;
        const r = await route.drivingRoute({ lat: loc.lat, lon: loc.lon }, { lat: settings.homeSpot.lat, lon: settings.homeSpot.lon });
        if (!r) continue;
        const eta = Math.round(r.seconds / 60);
        if (r.traffic && eta >= c.usualMinutes * 1.25 + 5) nudges.push(`${person}: traffic zyada hai (${eta} min, aam taur par ${c.usualMinutes}). Abhi niklo`);
        else if (nowMin >= leave - 5) nudges.push(`${person}: nikalne ka aam time ${usual}. Raasta ${r.traffic ? "abhi" : ""} ${eta} min ka hai`.replace("  ", " "));
    }
    const value = { nudges: nudges.slice(0, 4), trips: tripsToday.slice(0, 6) };
    cache.set(String(owner), { at: now, value });
    return value;
}

router.keepFix = keepFix;
router.tabletLines = tabletLines;
router._analyse = analyse;
module.exports = router;
