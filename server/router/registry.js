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

// Who may edit the lists. Comma separated, overridable via REGISTRY_ADMINS.
const ADMINS = (process.env.REGISTRY_ADMINS || "tanushchawla16@gmail.com")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

// Used until an admin saves something. Mirrors what each app ships with.
const DEFAULTS = {
    stashr: [
        "https://password-manager-server-xxdr.onrender.com",
        "https://password-manager-server-8gvj.onrender.com"
    ],
    dealradar: ["https://dealradar.ggnhome.com"],
    wethree: [
        "https://tasks-g9h1.onrender.com/api",
        "https://we-three-api.onrender.com/api"
    ]
};
const APP_LABELS = { stashr: "Stashr", dealradar: "Deal Radar", wethree: "We Three" };
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
    return doc && doc.urls && doc.urls.length ? doc.urls : DEFAULTS[app];
};

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
                urls: doc && doc.urls && doc.urls.length ? doc.urls : DEFAULTS[app],
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

router.put("/registry/:app", authenticate, requireAdmin, async (req, res) =>
{
    const app = String(req.params.app || "").toLowerCase();
    if (!DEFAULTS[app]) return res.status(404).json({ error: "Unknown app." });

    const input = Array.isArray(req.body.urls) ? req.body.urls : [];
    const urls = [];
    for (const raw of input)
    {
        const url = cleanUrl(raw);
        if (!url) return res.status(400).json({ error: `"${String(raw).slice(0, 120)}" is not a valid https URL.` });
        if (!urls.includes(url)) urls.push(url);
    }
    if (urls.length === 0) return res.status(400).json({ error: "Keep at least one server URL." });
    if (urls.length > MAX_URLS) return res.status(400).json({ error: `At most ${MAX_URLS} URLs per app.` });

    try
    {
        const doc = await Registry.findOneAndUpdate(
            { app },
            { urls, updatedAt: new Date(), updatedBy: req.rootUser.email },
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
    if (!DEFAULTS[app]) return res.status(404).json({ error: "Unknown app." });

    try
    {
        const urls = await listFor(app);
        // Any website or app may read this list; it holds URLs only.
        if (!res.getHeader("Access-Control-Allow-Origin")) res.set("Access-Control-Allow-Origin", "*");
        res.set("Cache-Control", "public, max-age=30");
        return res.json({ app, urls });
    }
    catch (error)
    {
        return res.status(500).json({ error: "Could not load the server list." });
    }
});

router.isAdminUser = isAdminUser;
module.exports = router;
