// Visitor tracker for the Stashr registry: counts distinct visitors (users/devices) per app or website from
// GET /registry/:app. Only the registry URL is tracked - nothing else in Stashr is touched.
const crypto = require("node:crypto");

const SALT = process.env.REGISTRY_VISIT_SALT || process.env.JWT_SECRET || "stashr-registry-visits";
const DAY_MS = 24 * 60 * 60 * 1000;

const dayKey = (date = new Date()) => date.toISOString().slice(0, 10);

/** Salted hash of the caller's address and device, so visitors can be counted without storing either. */
const visitorId = (req) =>
{
    const ip = String((req.headers && req.headers["x-forwarded-for"]) || req.ip || "").split(",")[0].trim();
    const agent = String((req.headers && req.headers["user-agent"]) || "");
    return crypto.createHash("sha256").update(`${SALT}|${ip}|${agent}`).digest("hex").slice(0, 32);
};

/** Fire-and-forget: a tracking problem must never break the registry read. */
const recordVisit = (Visit, app, req) =>
{
    try
    {
        const now = new Date();
        Promise.resolve(Visit.updateOne(
            { app, day: dayKey(now), visitor: visitorId(req) },
            { $inc: { hits: 1 }, $set: { lastAt: now }, $setOnInsert: { firstAt: now } },
            { upsert: true }
        )).catch(() => {});
    }
    catch (e) { /* ignore */ }
};

/** Per-app totals: visitors today / last 7 days / last 30 days / all kept history, plus hits and last seen. */
const summarize = (rows, now = new Date()) =>
{
    const today = dayKey(now);
    const since = (days) => dayKey(new Date(now.getTime() - (days - 1) * DAY_MS));
    const d7 = since(7), d30 = since(30);
    const byApp = {};
    for (const row of rows)
    {
        const a = byApp[row.app] || (byApp[row.app] = { all: new Set(), t: new Set(), w: new Set(), m: new Set(), hits: 0, lastSeen: null });
        a.all.add(row.visitor);
        if (row.day === today) a.t.add(row.visitor);
        if (row.day >= d7) a.w.add(row.visitor);
        if (row.day >= d30) a.m.add(row.visitor);
        a.hits += row.hits || 0;
        if (row.lastAt && (!a.lastSeen || new Date(row.lastAt) > new Date(a.lastSeen))) a.lastSeen = new Date(row.lastAt).toISOString();
    }
    const out = {};
    for (const [app, a] of Object.entries(byApp))
        out[app] = { today: a.t.size, last7: a.w.size, last30: a.m.size, total: a.all.size, hits: a.hits, lastSeen: a.lastSeen };
    return out;
};

module.exports = { dayKey, visitorId, recordVisit, summarize };
