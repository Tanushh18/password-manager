/**
 * Server registry: the one place that lists every backend URL for every app.
 *
 *   GET  /registry/:app        public  - the app's URL list (apps read this on start)
 *   GET  /registry             admin   - every app's list, for the admin page
 *   PUT  /registry/:app        admin   - replace an app's URL list
 *   POST /registry/check       admin   - ping a URL's /health from the server
 *
 * Only URLs are stored here - never secrets - so the public read is safe.
 */
const express = require("express");
const router = express.Router();
const Registry = require("../models/registry");
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");

const { ADMINS, DEFAULTS, OFFABLE, APP_LABELS, SLUG, urlsFor } = require("../utils/registryDefaults");
const MAX_URLS = 10;

const isAdminUser = (user) => Boolean(user && user.email && ADMINS.includes(String(user.email).toLowerCase()));

const requireAdmin = (req, res, next) =>
{
    if (!isAdminUser(req.rootUser)) return res.status(403).json({ error: "Not allowed." });
    next();
};

/** Returns a clean https/http URL without a trailing slash, or null. */
const cleanUrl = (value) =>
{
    try
    {
        const url = new URL(String(value || "").trim());
        const local = ["localhost", "127.0.0.1"].includes(url.hostname);
        if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
        if (url.username || url.password || url.search || url.hash) return null;
        return (url.origin + url.pathname).replace(/\/+$/, "");
    }
    catch (e) { return null; }
};

const listFor = async (app) =>
{
    const doc = await Registry.findOne({ app }).lean();
    if (doc && doc.urls && doc.urls.length) return doc.urls;
    if (doc && doc.off && OFFABLE.has(app)) return [];
    // A per-project list switched off completely stays an (empty) list instead of falling back to a default or a 404.
    if (doc && doc.owner && !DEFAULTS[app]) return [];
    return DEFAULTS[app] || null;
};

/** Built-in apps are for administrators; any other slug is a per-project list owned by the account that made it. */
const mayWrite = (user, app, doc) =>
{
    if (isAdminUser(user)) return true;
    if (DEFAULTS[app]) return false;
    return !doc || !doc.owner || String(doc.owner) === String(user._id);
};
const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: "Too many changes. Slow down." });

const checkLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: "Too many checks. Slow down." });

router.get("/registry", authenticate, requireAdmin, async (req, res) =>
{
    try
    {
        const docs = await Registry.find({}).lean();
        const byApp = new Map(docs.map((d) => [d.app, d]));
        const apps = Object.keys(DEFAULTS).map((app) =>
        {
            const doc = byApp.get(app);
            return {
                app,
                label: APP_LABELS[app],
                urls: urlsFor(doc, app),
                saved: Boolean(doc && doc.urls && doc.urls.length),
                updatedAt: doc ? doc.updatedAt : null
            };
        });
        res.set("Cache-Control", "no-store");
        return res.json({ apps });
    }
    catch (error)
    {
        return res.status(500).json({ error: "Could not load the server list." });
    }
});

router.put("/registry/:app", authenticate, writeLimiter, async (req, res) =>
{
    const app = String(req.params.app || "").toLowerCase();
    if (!DEFAULTS[app] && !SLUG.test(app)) return res.status(400).json({ error: "Use 3-40 letters, numbers or dashes." });
    const existing = await Registry.findOne({ app }).lean();
    if (!mayWrite(req.rootUser, app, existing)) return res.status(403).json({ error: "Not allowed." });

    const input = Array.isArray(req.body.urls) ? req.body.urls : [];
    const urls = [];
    for (const raw of input)
    {
        const url = cleanUrl(raw);
        if (!url) return res.status(400).json({ error: `"${String(raw).slice(0, 120)}" is not a valid https URL.` });
        if (!urls.includes(url)) urls.push(url);
    }
    // Most built-in apps always keep a server; a per-project list (or an OFFABLE app) may be switched off entirely (to test that the apps stop using it).
    if (urls.length === 0 && DEFAULTS[app] && !OFFABLE.has(app)) return res.status(400).json({ error: "Keep at least one server URL." });
    if (urls.length > MAX_URLS) return res.status(400).json({ error: `At most ${MAX_URLS} URLs per app.` });

    try
    {
        const doc = await Registry.findOneAndUpdate(
            { app },
            { urls, updatedAt: new Date(), updatedBy: req.rootUser.email, ...(OFFABLE.has(app) ? { off: urls.length === 0 } : {}), ...(!DEFAULTS[app] && !(existing && existing.owner) ? { owner: req.rootUser._id } : {}) },
            { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
        ).lean();
        return res.json({ app, urls: doc.urls, updatedAt: doc.updatedAt });
    }
    catch (error)
    {
        return res.status(500).json({ error: "Could not save the server list." });
    }
});

router.post("/registry/check", authenticate, requireAdmin, checkLimiter, async (req, res) =>
{
    const url = cleanUrl(req.body.url);
    if (!url) return res.status(400).json({ error: "Not a valid URL." });

    // Apps keep their API under a path (".../api"); /health lives at the host root.
    const target = new URL(url).origin + "/health";
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try
    {
        const response = await fetch(target, { signal: controller.signal, redirect: "manual" });
        return res.json({ ok: response.ok, status: response.status, ms: Date.now() - started });
    }
    catch (error)
    {
        return res.json({ ok: false, status: 0, ms: Date.now() - started });
    }
    finally { clearTimeout(timer); }
});

// Public read. Registered last so it never shadows the fixed paths above.
router.get("/registry/:app", async (req, res) =>
{
    const app = String(req.params.app || "").toLowerCase();
    try
    {
        const urls = await listFor(app);
        if (!urls) return res.status(404).json({ error: "Unknown app." });
        // Any website or app may read this list; it holds URLs only.
        if (!res.getHeader("Access-Control-Allow-Origin")) res.set("Access-Control-Allow-Origin", "*");
        res.set("Cache-Control", "public, max-age=30");
        return res.json({ app, urls, ...(urls.length === 0 ? { off: true } : {}) });
    }
    catch (error)
    {
        return res.status(500).json({ error: "Could not load the server list." });
    }
});

router.isAdminUser = isAdminUser;
module.exports = router;
