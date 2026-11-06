/*
 * Keeps and reads the 24 hour position trail used by the Places card (models/homePlaceFix.js). Best effort: a failure here never delays or
 * breaks the phone's own report.
 */
const HomePlaceFix = require("../models/homePlaceFix");

const DAY_MS = 24 * 3600 * 1000;
const lastKept = new Map();                      // phone id -> { at, lat, lon } of the point stored last, to avoid storing the same spot over and over

/**
 * Stores one point. Real fixes are kept unless the phone has not moved (under 10 m) and the last point is under 3 minutes old;
 * "still here" check-ins (same = true) at most every 5 minutes.
 */
async function keep(owner, phone, fix, { same = false, now = Date.now() } = {}) {
    if (!fix || !Number.isFinite(Number(fix.lat)) || !Number.isFinite(Number(fix.lon))) return false;
    const key = String(phone), prev = lastKept.get(key);
    if (prev) {
        const age = now - prev.at;
        if (same && age < 5 * 60000) return false;
        if (!same && age < 3 * 60000 && Math.abs(prev.lat - fix.lat) < 0.0001 && Math.abs(prev.lon - fix.lon) < 0.0001) return false;
    }
    lastKept.set(key, { at: now, lat: Number(fix.lat), lon: Number(fix.lon) });
    if (lastKept.size > 500) lastKept.delete(lastKept.keys().next().value);
    await HomePlaceFix.create({ owner, phone, at: new Date(Number(fix.at) || now), lat: Number(fix.lat), lon: Number(fix.lon), acc: Math.max(0, Number(fix.acc) || 0), same });
    return true;
}

/** The points of one phone from the last 24 hours, oldest first. */
async function last24h(owner, phone, now = Date.now()) {
    const rows = await HomePlaceFix.find({ owner, phone, at: { $gte: new Date(now - DAY_MS) } }).sort({ at: 1 }).limit(2000).lean();
    return rows.map((r) => ({ at: new Date(r.at).getTime(), lat: r.lat, lon: r.lon, acc: r.acc, same: r.same }));
}

module.exports = { keep, last24h };
