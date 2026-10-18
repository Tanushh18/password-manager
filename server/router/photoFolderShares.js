const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const User = require("../models/schema");
const Share = require("../models/photoFolderShare");
const authenticate = require("../middlewares/authenticate");
const { requireFeature } = require("../utils/features");
const { without } = require("../utils/projection");
const { clean, decode } = require("../utils/photoStore");
const { streamMedia } = require("../utils/photoStream");
const { serverError } = require("./helpers");

/*
 * Share a folder with another person by email. They get a read-only view of the folder and its sub-folders in their
 * own Stashr account. They never see Drive ids, accounts or tokens. Originals can be downloaded only if the owner allowed it.
 */
const photosAuth = [authenticate, requireFeature("photos")];
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const MAX_LISTED = 2000;

/** The folder and everything below it. */
function subtree(folders, rootId) {
    const ids = new Set([rootId]);
    for (let grew = true; grew;) { grew = false; for (const f of folders) if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) { ids.add(f.id); grew = true; } }
    return ids;
}

const mine = (req) => String(req.rootUser.email || "").toLowerCase();
const publicShare = (s) => ({ id: String(s._id), folderId: s.folderId, folderName: s.folderName, recipientEmail: s.recipientEmail, ownerName: s.ownerName, allowDownload: s.allowDownload, createdAt: s.createdAt });

router.post("/photo-cloud/folder-shares", ...photosAuth, async (req, res) => {
    const email = clean(req.body?.email, 254).toLowerCase();
    if (!EMAIL.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
    if (email === mine(req)) return res.status(400).json({ error: "That is your own address." });
    try {
        const key = await req.rootUser.getDataKey();
        const folder = decode(req.rootUser.photoFolders, key).find((f) => f.id === String(req.body?.folderId || ""));
        if (!folder) return res.status(404).json({ error: "Folder not found." });
        if (await Share.countDocuments({ ownerId: req.rootUser._id, revokedAt: null }) >= 100) return res.status(400).json({ error: "Share limit reached. Stop sharing something first." });
        const share = await Share.findOneAndUpdate(
            { ownerId: req.rootUser._id, folderId: folder.id, recipientEmail: email },
            { $set: { ownerName: clean(req.rootUser.name || req.rootUser.email, 80), folderName: folder.name, allowDownload: Boolean(req.body?.allowDownload), revokedAt: null } },
            { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
        );
        return res.status(201).json({ share: publicShare(share) });
    } catch (error) { return serverError(res, "photo-cloud/folder-shares/create", error); }
});

router.get("/photo-cloud/folder-shares", ...photosAuth, async (req, res) => {
    try { return res.json({ shares: (await Share.find({ ownerId: req.rootUser._id, revokedAt: null }).sort({ createdAt: -1 })).map(publicShare) }); }
    catch (error) { return serverError(res, "photo-cloud/folder-shares/list", error); }
});

router.delete("/photo-cloud/folder-shares/:id", ...photosAuth, async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Share not found." });
    try {
        const r = await Share.updateOne({ _id: req.params.id, ownerId: req.rootUser._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
        return r.matchedCount ? res.json({ message: "Sharing stopped." }) : res.status(404).json({ error: "Share not found." });
    } catch (error) { return serverError(res, "photo-cloud/folder-shares/revoke", error); }
});

router.get("/photo-cloud/shared-with-me", ...photosAuth, async (req, res) => {
    try { return res.json({ shares: (await Share.find({ recipientEmail: mine(req), revokedAt: null }).sort({ createdAt: -1 })).map(publicShare) }); }
    catch (error) { return serverError(res, "photo-cloud/shared-with-me", error); }
});

/** The share, if this signed-in person is its recipient and it has not been stopped. */
const shareFor = (req) => (mongoose.isValidObjectId(req.params.id) ? Share.findOne({ _id: req.params.id, recipientEmail: mine(req), revokedAt: null }) : null);
const loadOwner = async (share) => {
    const owner = await User.findById(share.ownerId, without("passwords", "projects", "renderMetricHistory", "renderIncidents", "renderAudit", "usageHistory"));
    return owner ? { owner, key: await owner.getDataKey() } : null;
};

router.get("/photo-cloud/shared/:id/media", ...photosAuth, async (req, res) => {
    try {
        const share = await shareFor(req);
        if (!share) return res.status(404).json({ error: "This share is no longer available." });
        const loaded = await loadOwner(share);
        if (!loaded) return res.status(404).json({ error: "This share is no longer available." });
        const folders = decode(loaded.owner.photoFolders, loaded.key);
        const root = folders.find((f) => f.id === share.folderId);
        if (!root) return res.status(404).json({ error: "The owner removed this folder." });
        const ids = subtree(folders, root.id);
        const all = decode(loaded.owner.photoMedia, loaded.key).filter((m) => ids.has(m.folderId) && m.availabilityState === "available" && !m.archived);
        const media = all.slice(0, MAX_LISTED).map((m) => ({ id: m.id, filename: m.filename, type: m.type, takenAt: m.takenAt, size: m.size, width: m.width, height: m.height, hasThumbnail: m.hasThumbnail, folderId: m.folderId }));
        res.set("Cache-Control", "no-store");
        return res.json({ share: publicShare(share), folders: folders.filter((f) => ids.has(f.id)).map((f) => ({ id: f.id, name: f.name, parentId: f.id === root.id ? null : f.parentId })), media, truncated: all.length > MAX_LISTED, total: all.length });
    } catch (error) { return serverError(res, "photo-cloud/shared/media", error); }
});

router.get("/photo-cloud/shared/:id/content", ...photosAuth, async (req, res) => {
    try {
        const share = await shareFor(req);
        if (!share) return res.status(404).json({ error: "This share is no longer available." });
        const wantsOriginal = req.query.size === "full" || req.query.download === "1";
        if (wantsOriginal && !share.allowDownload) return res.status(403).json({ error: "The owner shared this folder for viewing only." });
        const loaded = await loadOwner(share);
        if (!loaded) return res.status(404).json({ error: "This share is no longer available." });
        const ids = subtree(decode(loaded.owner.photoFolders, loaded.key), share.folderId);
        const item = decode(loaded.owner.photoMedia, loaded.key).find((m) => m.id === String(req.query.id || "") && ids.has(m.folderId));
        const connection = item && decode(loaded.owner.photoConnections, loaded.key).find((c) => c.id === item.sourceConnectionId && c.status === "connected");
        if (!item || !connection || item.availabilityState !== "available") return res.status(404).json({ error: "This item is not available." });
        return await streamMedia({ req, res, user: loaded.owner, key: loaded.key, connection, item, size: wantsOriginal ? "full" : req.query.size === "thumb" ? "thumb" : "large", download: req.query.download === "1" });
    } catch (error) { return serverError(res, "photo-cloud/shared/content", error); }
});

router.subtree = subtree;
module.exports = router;
