const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const User = require("../models/schema");
const authenticate = require("../middlewares/authenticate");
const { serverError } = require("./helpers");
const { clean, decode, updateEntry, pushEntry, driveFetch, refreshGoogleToken } = require("../utils/photoStore");
const { pickDestination } = require("../utils/photoRouting");
const workers = require("../utils/photoWorkers");
const { requireFeature } = require("../utils/features");
const photosAuth = [authenticate, requireFeature("photos")];
const { ensureFolder } = require("../utils/photoFolders");
const { streamMedia } = require("../utils/photoStream");

/*
 * Photo uploads go straight from the phone to Google Drive. The server only routes the file to an account,
 * opens a Drive resumable-upload session (a one-use URL), then verifies what arrived. Photo bytes never pass
 * through this server.
 */
const MAX_BYTES = 5 * 1024 ** 3;
const FOLDER = "Stashr Photos";
const DRIVE = "https://www.googleapis.com";
const DEFAULT_SETTINGS = { safetyBufferGb: 2, defaultConnectionId: "" };
const QUOTA = /quota|storageQuotaExceeded|insufficient storage/i;
const safeJob = ({ _eid, sessionUri, excludeIds, ...job }) => job;

/** Opens a Drive resumable session on the best account; falls through to the next account when one is full. */
async function openSession(user, key, connections, job, settings, folder, allFolders) {
    const excluded = [...(job.excludeIds || [])];
    for (let attempt = 0; attempt < connections.length; attempt += 1) {
        const target = pickDestination(connections, job.size, { bufferGb: Number(settings.safetyBufferGb ?? 2), defaultId: settings.defaultConnectionId, excludeIds: excluded });
        if (!target) return { error: "no_destination", excluded };
        const parent = await ensureFolder(user, key, target, folder, allFolders);
        const response = await driveFetch(user, key, target, `${DRIVE}/upload/drive/v3/files?uploadType=resumable&fields=id`, {
            method: "POST",
            headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": job.mimeType, "X-Upload-Content-Length": String(job.size) },
            body: JSON.stringify({ name: job.filename, mimeType: job.mimeType, ...(parent ? { parents: [parent] } : {}), appProperties: { stashrLocalId: job.localId }, ...(job.takenAt ? { createdTime: job.takenAt } : {}) })
        });
        const sessionUri = response.headers.get("location");
        if (response.ok && sessionUri) return { target, sessionUri, excluded };
        const body = await response.text().catch(() => "");
        if (response.status === 401 || response.status === 403 && /insufficient|scope|permission/i.test(body)) {
            target.status = "reauthorize"; target.lastError = "Reconnect this account to allow uploads.";
            if (target._eid) await updateEntry(user, "photoConnections", target, key);
        }
        excluded.push(target.id); // quota, permission or provider error: try the next eligible account
    }
    return { error: "no_destination", excluded };
}

router.post("/photo-cloud/upload/start", photosAuth, async (req, res) => {
    const filename = clean(req.body.filename, 180);
    const mimeType = clean(req.body.mimeType, 100);
    const size = Number(req.body.size);
    const localId = clean(req.body.localId, 200);
    const md5 = clean(req.body.md5, 40).toLowerCase();
    if (!filename || !localId || !/^(image|video)\//.test(mimeType) || !Number.isFinite(size) || size <= 0 || size > MAX_BYTES) return res.status(400).json({ error: "A photo or video with a name, type and size is required." });
    const takenAt = req.body.takenAt && !Number.isNaN(Date.parse(req.body.takenAt)) ? new Date(req.body.takenAt).toISOString() : "";
    try {
        const key = await req.rootUser.getDataKey();
        const media = decode(req.rootUser.photoMedia, key);
        const same = media.find((item) => item.localId === localId || (md5 && item.checksum === md5 && item.availabilityState === "available"));
        if (same) return res.json({ duplicate: true, mediaId: same.id });

        const jobs = decode(req.rootUser.photoBackupJobs, key);
        const existing = jobs.find((job) => job.localId === localId);
        if (existing && existing.status === "completed") return res.json({ duplicate: true, mediaId: existing.mediaId || "" });
        if (existing && existing.status === "uploading" && existing.sessionUri && Date.now() - Date.parse(existing.updatedAt || existing.createdAt) < 5 * 86400000) {
            return res.json({ jobId: existing.id, sessionUri: existing.sessionUri, destination: existing.destinationLabel });
        }

        const connections = decode(req.rootUser.photoConnections, key);
        const allFolders = decode(req.rootUser.photoFolders, key);
        let folder = allFolders.find((f) => f.id === clean(req.body.folderId, 80)) || null;
        const folderName = clean(req.body.folderName, 80);
        if (!folder && folderName) { // a device folder name (Camera, Screenshots...) becomes a top-level Stashr folder
            folder = allFolders.find((f) => !f.parentId && f.name.toLowerCase() === folderName.toLowerCase());
            if (!folder) { folder = { id: crypto.randomUUID(), name: folderName, parentId: null, createdAt: new Date().toISOString(), driveIds: {} }; folder._eid = await pushEntry(req.rootUser, "photoFolders", folder, key); allFolders.push(folder); }
        }
        const settings = { ...DEFAULT_SETTINGS, ...(decode(req.rootUser.photoSettings, key)[0] || {}) };
        const now = new Date().toISOString();
        const job = { ...(existing || {}), id: existing?.id || crypto.randomUUID(), localId, filename, mimeType, size, md5, originalSize: Number(req.body.originalSize) > 0 ? Number(req.body.originalSize) : size, folderId: folder?.id || "", takenAt, attempts: (existing?.attempts || 0) + 1, createdAt: existing?.createdAt || now, updatedAt: now, verification: "pending", error: "" };
        const opened = await openSession(req.rootUser, key, connections, job, settings, folder, allFolders);
        job.excludeIds = opened.excluded;
        if (opened.error) {
            job.status = "blocked"; job.error = "No connected account can take this file right now."; job.sessionUri = "";
            if (existing) await updateEntry(req.rootUser, "photoBackupJobs", { ...job, _eid: existing._eid }, key); else await pushEntry(req.rootUser, "photoBackupJobs", job, key);
            return res.status(409).json({ error: job.error, code: "no_destination", jobId: job.id });
        }
        job.status = "uploading"; job.destinationConnectionId = opened.target.id; job.destinationLabel = opened.target.label || opened.target.email; job.sessionUri = opened.sessionUri;
        if (existing) await updateEntry(req.rootUser, "photoBackupJobs", { ...job, _eid: existing._eid }, key); else await pushEntry(req.rootUser, "photoBackupJobs", job, key);
        return res.status(201).json({ jobId: job.id, sessionUri: job.sessionUri, destination: job.destinationLabel });
    } catch (error) { return serverError(res, "photo-cloud/upload/start", error); }
});

const loadJob = async (req) => {
    const key = await req.rootUser.getDataKey();
    const job = decode(req.rootUser.photoBackupJobs, key).find((item) => item.id === req.params.jobId);
    return { key, job };
};

router.post("/photo-cloud/upload/:jobId/complete", photosAuth, async (req, res) => {
    const fileId = clean(req.body.fileId, 200);
    if (!fileId) return res.status(400).json({ error: "The Drive file id is required." });
    try {
        const { key, job } = await loadJob(req);
        if (!job) return res.status(404).json({ error: "Upload job not found." });
        if (job.status === "completed") return res.json({ job: safeJob(job), mediaId: job.mediaId });
        const connection = decode(req.rootUser.photoConnections, key).find((item) => item.id === job.destinationConnectionId);
        if (!connection) return res.status(409).json({ error: "The destination account is no longer connected." });
        job.status = "verifying"; job.updatedAt = new Date().toISOString();
        await updateEntry(req.rootUser, "photoBackupJobs", job, key);
        const response = await driveFetch(req.rootUser, key, connection, `${DRIVE}/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,md5Checksum,createdTime,modifiedTime,thumbnailLink,webViewLink,imageMediaMetadata(width,height)`);
        const file = response.ok ? await response.json() : null;
        let problem = "";
        if (!file) problem = "Google Drive could not confirm the file.";
        else if (Number(file.size) !== job.size) problem = "The uploaded size does not match the original.";
        else if (job.md5 && file.md5Checksum && file.md5Checksum.toLowerCase() !== job.md5) problem = "The uploaded checksum does not match the original.";
        if (problem) {
            job.status = "failed"; job.error = problem; job.verification = "failed"; job.sessionUri = ""; job.updatedAt = new Date().toISOString();
            await updateEntry(req.rootUser, "photoBackupJobs", job, key);
            return res.status(422).json({ error: problem, job: safeJob(job) });
        }
        const id = `${connection.id}:${file.id}`;
        const item = { id, filename: file.name, type: job.mimeType.startsWith("video/") ? "video" : /screenshot/i.test(file.name) ? "screenshot" : "photo", mimeType: file.mimeType, size: Number(file.size) / (1024 ** 3), takenAt: job.takenAt || file.createdTime, modifiedAt: file.modifiedTime, width: file.imageMediaMetadata?.width || null, height: file.imageMediaMetadata?.height || null, sourceConnectionId: connection.id, providerFileId: file.id, hasThumbnail: Boolean(file.thumbnailLink), thumbnailUrl: file.thumbnailLink || null, webViewUrl: file.webViewLink || null, checksum: file.md5Checksum || null, availabilityState: "available", account: connection.email, tag: "Backed up", favorite: false, archived: false, localId: job.localId, folderId: job.folderId || null, originalSizeGb: job.originalSize ? job.originalSize / (1024 ** 3) : null };
        const known = decode(req.rootUser.photoMedia, key).find((m) => m.id === id);
        if (known) await updateEntry(req.rootUser, "photoMedia", { ...item, _eid: known._eid }, key); else await pushEntry(req.rootUser, "photoMedia", item, key);
        connection.usedGb = Number(connection.usedGb || 0) + item.size;
        await updateEntry(req.rootUser, "photoConnections", connection, key);
        job.status = "completed"; job.verification = job.md5 && file.md5Checksum ? "checksum" : "size"; job.mediaId = id; job.sessionUri = ""; job.error = ""; job.completedAt = new Date().toISOString(); job.updatedAt = job.completedAt;
        await updateEntry(req.rootUser, "photoBackupJobs", job, key);
        return res.json({ job: safeJob(job), mediaId: id });
    } catch (error) { return serverError(res, "photo-cloud/upload/complete", error); }
});

router.post("/photo-cloud/upload/:jobId/fail", photosAuth, async (req, res) => {
    try {
        const { key, job } = await loadJob(req);
        if (!job) return res.status(404).json({ error: "Upload job not found." });
        if (job.status === "completed") return res.json({ job: safeJob(job) });
        const message = clean(req.body.error, 200) || "The upload did not finish.";
        job.status = "failed"; job.error = message; job.updatedAt = new Date().toISOString(); job.sessionUri = "";
        if ((req.body.quota === true || QUOTA.test(message)) && job.destinationConnectionId) job.excludeIds = [...new Set([...(job.excludeIds || []), job.destinationConnectionId])];
        await updateEntry(req.rootUser, "photoBackupJobs", job, key);
        return res.json({ job: safeJob(job) });
    } catch (error) { return serverError(res, "photo-cloud/upload/fail", error); }
});

router.post("/photo-cloud/upload/:jobId/cancel", photosAuth, async (req, res) => {
    try {
        const { key, job } = await loadJob(req);
        if (!job) return res.status(404).json({ error: "Upload job not found." });
        if (job.status === "completed") return res.status(409).json({ error: "This upload already finished." });
        job.status = "cancelled"; job.sessionUri = ""; job.updatedAt = new Date().toISOString();
        await updateEntry(req.rootUser, "photoBackupJobs", job, key);
        return res.json({ job: safeJob(job) });
    } catch (error) { return serverError(res, "photo-cloud/upload/cancel", error); }
});

/* Thumbnails and originals for the signed-in owner only, streamed from Drive. */
router.get("/photo-cloud/media/content", photosAuth, async (req, res) => {
    try {
        const key = await req.rootUser.getDataKey();
        const item = decode(req.rootUser.photoMedia, key).find((m) => m.id === String(req.query.id || ""));
        const connection = item && decode(req.rootUser.photoConnections, key).find((c) => c.id === item.sourceConnectionId && c.status === "connected");
        if (!item || !connection || item.availabilityState !== "available") return res.status(404).json({ error: "This item is not available from its storage account." });
        return await streamMedia({ req, res, user: req.rootUser, key, connection, item, size: req.query.size, download: req.query.download === "1" });
    } catch (error) { return serverError(res, "photo-cloud/media/content", error); }
});

router.put("/photo-cloud/media/item", photosAuth, async (req, res) => {
    try {
        const key = await req.rootUser.getDataKey();
        const item = decode(req.rootUser.photoMedia, key).find((m) => m.id === String(req.body.id || ""));
        if (!item) return res.status(404).json({ error: "Item not found." });
        if (typeof req.body.favorite === "boolean") item.favorite = req.body.favorite;
        if (typeof req.body.archived === "boolean") item.archived = req.body.archived;
        let moved = null;
        if (req.body.folderId !== undefined) {
            const folders = decode(req.rootUser.photoFolders, key);
            const target = req.body.folderId ? folders.find((f) => f.id === req.body.folderId) : null;
            if (req.body.folderId && !target) return res.status(404).json({ error: "Folder not found." });
            item.folderId = target ? target.id : null;
            // Best effort: also move the file in Drive. Only files Stashr uploaded can be moved with the narrow permission.
            const connection = decode(req.rootUser.photoConnections, key).find((c) => c.id === item.sourceConnectionId && c.status === "connected");
            if (connection) {
                try {
                    const destination = await ensureFolder(req.rootUser, key, connection, target, folders);
                    const meta = await driveFetch(req.rootUser, key, connection, `${DRIVE}/drive/v3/files/${encodeURIComponent(item.providerFileId)}?fields=parents`);
                    const parents = meta.ok ? ((await meta.json()).parents || []).join(",") : "";
                    const response = destination && parents ? await driveFetch(req.rootUser, key, connection, `${DRIVE}/drive/v3/files/${encodeURIComponent(item.providerFileId)}?` + new URLSearchParams({ addParents: destination, removeParents: parents, fields: "id" }), { method: "PATCH" }) : null;
                    moved = Boolean(response && response.ok);
                } catch { moved = false; }
            }
        }
        await updateEntry(req.rootUser, "photoMedia", item, key);
        return res.json({ id: item.id, favorite: Boolean(item.favorite), archived: Boolean(item.archived), folderId: item.folderId || null, driveMoved: moved });
    } catch (error) { return serverError(res, "photo-cloud/media/update", error); }
});

/* scope=index removes only Stashr's record. scope=cloud moves the original to the Drive trash (recoverable there). */
router.delete("/photo-cloud/media/item", photosAuth, async (req, res) => {
    const scope = req.query.scope === "cloud" ? "cloud" : "index";
    try {
        const key = await req.rootUser.getDataKey();
        const id = String(req.query.id || "");
        const item = decode(req.rootUser.photoMedia, key).find((m) => m.id === id);
        if (!item) return res.status(404).json({ error: "Item not found." });
        if (scope === "cloud") {
            const connection = decode(req.rootUser.photoConnections, key).find((c) => c.id === item.sourceConnectionId && c.status === "connected");
            if (!connection) return res.status(409).json({ error: "The storage account is not connected." });
            const response = await driveFetch(req.rootUser, key, connection, `${DRIVE}/drive/v3/files/${encodeURIComponent(item.providerFileId)}?fields=id`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) });
            if (!response.ok && response.status !== 404) return res.status(403).json({ error: "Google did not allow moving this file to the trash. Only files uploaded by Stashr can be trashed from here." });
        }
        await User.updateOne({ _id: req.rootUser._id }, { $pull: { photoMedia: { _id: item._eid } } });
        for (const album of decode(req.rootUser.photoAlbums, key).filter((a) => (a.mediaIds || []).includes(id))) await updateEntry(req.rootUser, "photoAlbums", { ...album, mediaIds: album.mediaIds.filter((m) => m !== id) }, key);
        return res.json({ removed: id, scope });
    } catch (error) { return serverError(res, "photo-cloud/media/delete", error); }
});

/* Folders: a tree of names kept by Stashr. Each one maps to a real Drive folder inside "Stashr Photos" in every account that uses it. */
const publicFolder = ({ _eid, driveIds, ...folder }) => folder;
router.post("/photo-cloud/folders", photosAuth, async (req, res) => {
    const name = clean(req.body.name, 80).replace(/[\\/]/g, "-");
    if (!name) return res.status(400).json({ error: "Give the folder a name." });
    try {
        const key = await req.rootUser.getDataKey();
        const all = decode(req.rootUser.photoFolders, key);
        if (all.length >= 300) return res.status(400).json({ error: "Folder limit reached." });
        const parentId = clean(req.body.parentId, 80) || null;
        if (parentId && !all.some((f) => f.id === parentId)) return res.status(404).json({ error: "Parent folder not found." });
        if (all.some((f) => (f.parentId || null) === parentId && f.name.toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: "A folder with that name already exists here." });
        const folder = { id: crypto.randomUUID(), name, parentId, createdAt: new Date().toISOString(), driveIds: {} };
        await pushEntry(req.rootUser, "photoFolders", folder, key);
        return res.status(201).json({ folder: publicFolder(folder) });
    } catch (error) { return serverError(res, "photo-cloud/folders/create", error); }
});
router.put("/photo-cloud/folders/:id", photosAuth, async (req, res) => {
    try {
        const key = await req.rootUser.getDataKey();
        const folder = decode(req.rootUser.photoFolders, key).find((f) => f.id === req.params.id);
        if (!folder) return res.status(404).json({ error: "Folder not found." });
        const name = clean(req.body.name, 80).replace(/[\\/]/g, "-");
        if (name) { folder.name = name; folder.driveIds = {}; } // the Drive folder is looked up again under the new name
        await updateEntry(req.rootUser, "photoFolders", folder, key);
        return res.json({ folder: publicFolder(folder) });
    } catch (error) { return serverError(res, "photo-cloud/folders/rename", error); }
});
router.delete("/photo-cloud/folders/:id", photosAuth, async (req, res) => {
    try {
        const key = await req.rootUser.getDataKey();
        const all = decode(req.rootUser.photoFolders, key);
        const folder = all.find((f) => f.id === req.params.id);
        if (!folder) return res.status(404).json({ error: "Folder not found." });
        const gone = new Set([folder.id]);
        for (let grew = true; grew;) { grew = false; for (const f of all) if (f.parentId && gone.has(f.parentId) && !gone.has(f.id)) { gone.add(f.id); grew = true; } }
        await User.updateOne({ _id: req.rootUser._id }, { $pull: { photoFolders: { _id: { $in: all.filter((f) => gone.has(f.id)).map((f) => f._eid) } } } });
        for (const item of decode(req.rootUser.photoMedia, key).filter((m) => gone.has(m.folderId))) await updateEntry(req.rootUser, "photoMedia", { ...item, folderId: null }, key);
        return res.json({ message: "Folder removed from Stashr. Files and Drive folders were not deleted." });
    } catch (error) { return serverError(res, "photo-cloud/folders/delete", error); }
});

/* Albums are lists of media ids in Stashr's own records; adding a photo never copies or moves the original. */
const loadAlbum = async (req) => {
    const key = await req.rootUser.getDataKey();
    return { key, album: decode(req.rootUser.photoAlbums, key).find((a) => a.id === req.params.id) };
};
router.post("/photo-cloud/albums", photosAuth, async (req, res) => {
    const name = clean(req.body.name, 80);
    if (!name) return res.status(400).json({ error: "Give the album a name." });
    try {
        const key = await req.rootUser.getDataKey();
        if ((req.rootUser.photoAlbums || []).length >= 200) return res.status(400).json({ error: "Album limit reached." });
        const album = { id: crypto.randomUUID(), name, mediaIds: [], createdAt: new Date().toISOString() };
        await pushEntry(req.rootUser, "photoAlbums", album, key);
        return res.status(201).json({ album });
    } catch (error) { return serverError(res, "photo-cloud/albums/create", error); }
});
router.put("/photo-cloud/albums/:id", photosAuth, async (req, res) => {
    try {
        const { key, album } = await loadAlbum(req);
        if (!album) return res.status(404).json({ error: "Album not found." });
        const name = clean(req.body.name, 80);
        if (name) album.name = name;
        await updateEntry(req.rootUser, "photoAlbums", album, key);
        return res.json({ album: { id: album.id, name: album.name, mediaIds: album.mediaIds } });
    } catch (error) { return serverError(res, "photo-cloud/albums/rename", error); }
});
router.delete("/photo-cloud/albums/:id", photosAuth, async (req, res) => {
    try {
        const { album } = await loadAlbum(req);
        if (!album) return res.status(404).json({ error: "Album not found." });
        await User.updateOne({ _id: req.rootUser._id }, { $pull: { photoAlbums: { _id: album._eid } } });
        return res.json({ message: "Album deleted. The photos themselves were not touched." });
    } catch (error) { return serverError(res, "photo-cloud/albums/delete", error); }
});
router.post("/photo-cloud/albums/:id/items", photosAuth, async (req, res) => {
    try {
        const { key, album } = await loadAlbum(req);
        if (!album) return res.status(404).json({ error: "Album not found." });
        const known = new Set(decode(req.rootUser.photoMedia, key).map((m) => m.id));
        const add = (Array.isArray(req.body.mediaIds) ? req.body.mediaIds : []).filter((id) => typeof id === "string" && known.has(id));
        album.mediaIds = [...new Set([...(album.mediaIds || []), ...add])];
        await updateEntry(req.rootUser, "photoAlbums", album, key);
        return res.json({ album: { id: album.id, name: album.name, mediaIds: album.mediaIds } });
    } catch (error) { return serverError(res, "photo-cloud/albums/add", error); }
});
router.delete("/photo-cloud/albums/:id/items", photosAuth, async (req, res) => {
    try {
        const { key, album } = await loadAlbum(req);
        if (!album) return res.status(404).json({ error: "Album not found." });
        const remove = new Set(Array.isArray(req.body.mediaIds) ? req.body.mediaIds : []);
        album.mediaIds = (album.mediaIds || []).filter((id) => !remove.has(id));
        await updateEntry(req.rootUser, "photoAlbums", album, key);
        return res.json({ album: { id: album.id, name: album.name, mediaIds: album.mediaIds } });
    } catch (error) { return serverError(res, "photo-cloud/albums/remove", error); }
});

module.exports = router;
