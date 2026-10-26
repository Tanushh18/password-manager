/**
 * Tiny in-memory rate limiter (per IP) so login / register can't be
 * brute forced. Good enough for a single instance; no extra dependency.
 */
const hitStore = require("../utils/hitStore");

/*
 * `persistent: "name"` keeps the counters in MongoDB (shared across restarts and instances) instead of this process.
 * Use it for sign-in style routes; busy API routes stay in memory to avoid a database write per request.
 */
const rateLimit = ({ windowMs = 15 * 60 * 1000, max = 20, message = "Too many requests.", skipSuccessful = false, persistent = "" } = {}) =>
{
    const hits = new Map();

    const sweep = setInterval(() =>
    {
        const now = Date.now();
        hits.forEach((entry, key) =>
        {
            if (entry.reset <= now) hits.delete(key);
        });
    }, windowMs);
    if (typeof sweep.unref === "function") sweep.unref();

    // RATE_LIMIT_MAX lets tests and self-hosters raise the ceiling.
    const limit = Number(process.env.RATE_LIMIT_MAX) || max;

    if (persistent)
    {
        return async (req, res, next) =>
        {
            const ip = req.ip || (req.connection && req.connection.remoteAddress) || "unknown";
            const key = `rl:${persistent}:${ip}`;
            const { count, resetAt } = await hitStore.hit(key, windowMs);
            if (count > limit)
            {
                res.set("Retry-After", String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))));
                return res.status(429).json({ error: message });
            }
            if (skipSuccessful) res.on("finish", () => { if (res.statusCode < 400) void hitStore.unhit(key); });
            return next();
        };
    }

    return (req, res, next) =>
    {
        const key = req.ip || (req.connection && req.connection.remoteAddress) || "unknown";
        const now = Date.now();
        let entry = hits.get(key);

        if (!entry || entry.reset <= now)
        {
            entry = { count: 0, reset: now + windowMs };
            hits.set(key, entry);
        }

        entry.count += 1;

        if (entry.count > limit)
        {
            res.set("Retry-After", String(Math.ceil((entry.reset - now) / 1000)));
            return res.status(429).json({ error: message });
        }

        // Only failures count against the limit: a signed-in user behind a shared IP must never be locked out.
        if (skipSuccessful)
        {
            res.on("finish", () =>
            {
                if (res.statusCode < 400 && entry.count > 0) entry.count -= 1;
            });
        }

        next();
    };
};

module.exports = rateLimit;
