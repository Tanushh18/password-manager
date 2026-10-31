/**
 * ShineOne Estate website photos, per sector / area - the same data the Tasks app manages.
 *
 *   GET  /shine/projects        admin   - every sector with its photos and videos
 *   POST /shine/projects        admin   - add a new sector / area
 *   POST /shine/sign            admin   - signed upload parameters (files go straight to Cloudinary)
 *   POST /shine/uploaded        admin   - refresh the list after uploading
 *   POST /shine/delete          admin   - remove one file
 *   GET  /public/shine/media    public  - { folders: { "<key>": [url, ...] } } for the website
 */
const express = require("express");
const cors = require("cors");
const router = express.Router();
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");
const ShineSector = require("../models/shineSector");
const media = require("../utils/shineMedia");
const registry = require("./registry");

const requireAdmin = (req, res, next) => registry.isAdminUser(req.rootUser) ? next() : res.status(403).json({ error: "Not allowed." });
const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, message: "Too many changes. Slow down." });

const allSectors = async () =>
{
    const extra = await ShineSector.find({}).sort({ createdAt: 1 }).lean();
    const seen = new Set(media.BUILT_IN.map((s) => s.key));
    return [...media.BUILT_IN, ...extra.filter((s) => !seen.has(s.key)).map(({ key, label, tag }) => ({ key, label, tag }))];
};

router.get("/shine/projects", authenticate, requireAdmin, async (req, res) =>
{
    try
    {
        const sectors = await allSectors();
        if (!media.isConfigured()) return res.json({ configured: false, projects: sectors.map((s) => ({ key: s.key, label: s.label, items: [] })) });
        const all = await media.listAll(sectors);
        res.set("Cache-Control", "no-store");
        return res.json({ configured: true, projects: sectors.map((s) => ({ key: s.key, label: s.label, items: all[s.key] || [] })) });
    }
    catch (error) { return res.status(502).json({ error: "Could not load the photos: " + error.message }); }
});

router.post("/shine/projects", authenticate, requireAdmin, writeLimiter, async (req, res) =>
{
    const sector = media.sectorFromLabel(req.body && req.body.label);
    if (!sector) return res.status(400).json({ error: "Give the sector or area a name." });
    if ((await allSectors()).some((s) => s.key === sector.key)) return res.status(409).json({ error: "That sector already exists." });
    await ShineSector.create({ ...sector, createdBy: req.rootUser.email });
    media.clearCache();
    return res.status(201).json({ key: sector.key, label: sector.label, items: [] });
});

router.post("/shine/sign", authenticate, requireAdmin, writeLimiter, async (req, res) =>
{
    if (!media.isConfigured()) return res.status(503).json({ error: "Website media is not set up on the server." });
    const sector = (await allSectors()).find((s) => s.key === String((req.body && req.body.project) || ""));
    if (!sector) return res.status(400).json({ error: "Unknown sector." });
    const kind = req.body.kind;
    if (kind !== "image" && kind !== "video") return res.status(400).json({ error: "kind must be image or video." });
    return res.json(media.signUpload(sector, kind));
});

router.post("/shine/uploaded", authenticate, requireAdmin, (req, res) => { media.clearCache(); res.json({ ok: true }); });

router.post("/shine/delete", authenticate, requireAdmin, writeLimiter, async (req, res) =>
{
    const publicId = String((req.body && req.body.publicId) || "");
    const kind = req.body && req.body.kind;
    if (!publicId.startsWith("ShineOne/") || (kind !== "image" && kind !== "video")) return res.status(400).json({ error: "That file can't be removed here." });
    try { await media.deleteMedia(publicId, kind); return res.json({ ok: true }); }
    catch (error) { return res.status(502).json({ error: "Could not remove it: " + error.message }); }
});

router.get("/public/shine/media", cors({ origin: true, methods: ["GET"] }), async (req, res) =>
{
    if (!media.isConfigured()) return res.status(503).json({ error: "Website media is not set up." });
    try
    {
        const sectors = await allSectors();
        const all = await media.listAll(sectors);
        const folders = {};
        for (const s of sectors) folders[s.key] = (all[s.key] || []).map((i) => i.url);
        res.set("Cache-Control", "public, max-age=60");
        return res.json({ folders });
    }
    catch (error) { return res.status(502).json({ error: "Could not load the photos." }); }
});

module.exports = router;
