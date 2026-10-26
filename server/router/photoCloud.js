const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const router = express.Router();
const User = require("../models/schema");
const authenticate = require("../middlewares/authenticate");
const { serverError } = require("./helpers");

const { clean, decode, encoded, publicConnection, updateEntry, pushEntry, driveFetch, refreshGoogleToken } = require("../utils/photoStore");
const { listDriveMedia, listDriveFolders } = require("../utils/driveIndex");
const { storageTotals, suggestAccount } = require("../utils/photoRouting");
const { normEmail, pickPrimary, mergeAccounts, linkCounts } = require("../utils/photoAccounts");
const { PhotoImportBatch } = require("../models/photoImport");
const workers = require("../utils/photoWorkers");
const { requireFeature } = require("../utils/features");
const photosAuth = [authenticate, requireFeature("photos")];
const tokenHash = (token) => crypto.createHash("sha256").update(token).digest("hex");
const clientUrl = () => (process.env.PHOTO_CLOUD_CLIENT_URL || process.env.CLIENT_ORIGINS || "http://localhost:3000").split(",")[0].replace(/\/$/, "");
const DEFAULT_SETTINGS = { wifiOnly: true, chargingOnly: false, safetyBufferGb: 2, defaultConnectionId: "" };
const photoSettings = (user, key) => ({ ...DEFAULT_SETTINGS, ...(decode(user.photoSettings, key)[0] || {}) });

router.get("/photo-cloud/google/start", photosAuth, async (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_PHOTO_REDIRECT_URI || `${process.env.SELF_URL || "http://localhost:8000"}/photo-cloud/google/callback`;
    if (!clientId || !process.env.SECRET_KEY) return res.status(503).json({ error: "Google OAuth is not configured on this server yet." });
    const requestedReturn = String(req.query.returnTo || "");
    const returnTo = requestedReturn.startsWith("/") && !requestedReturn.startsWith("//") && !requestedReturn.includes("\\") ? requestedReturn.slice(0, 200) : "/photos";
    const state = jwt.sign({ uid: String(req.rootUser._id), mobile: req.query.client === "mobile", label: clean(req.query.label || req.body?.label || "Google account", 80), returnTo }, process.env.SECRET_KEY, { expiresIn: "10m" });
    const requiredScopes = ["openid", "email", "https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/photospicker.mediaitems.readonly"];
    const configuredScopes = String(process.env.GOOGLE_PHOTO_SCOPES || "https://www.googleapis.com/auth/drive.readonly").split(/\s+/).filter(Boolean);
    const scope = [...new Set([...configuredScopes, ...requiredScopes])].join(" ");
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", access_type: "offline", prompt: "consent", scope, state });
    return res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
});

router.get("/photo-cloud/google/callback", async (req, res) => {
    let back = (result, returnTo = "/photos") => { const safePath = typeof returnTo === "string" && returnTo.startsWith("/") && !returnTo.startsWith("//") && !returnTo.includes("\\") ? returnTo.slice(0, 200) : "/photos"; return res.redirect(`${clientUrl()}${safePath}${safePath.includes("?") ? "&" : "?"}google=${result}`); };
    try {
        const claims = jwt.verify(String(req.query.state || ""), process.env.SECRET_KEY);
        if (claims.mobile) back = (result) => res.redirect(`stashr://photos?google=${result}`);
        if (!req.query.code) return back("cancelled", claims.returnTo);
        const redirectUri = process.env.GOOGLE_PHOTO_REDIRECT_URI || `${process.env.SELF_URL || "http://localhost:8000"}/photo-cloud/google/callback`;
        const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: String(req.query.code), client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET || "", redirect_uri: redirectUri, grant_type: "authorization_code" }) });
        const tokens = await tokenResponse.json();
        if (!tokenResponse.ok || !tokens.access_token) throw new Error("Google token exchange failed");
        const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
        const profile = await profileResponse.json();
        if (!profileResponse.ok || !profile.email) throw new Error("Google account details could not be verified");
        const grantedScopes = String(tokens.scope || "").split(/\s+/).filter(Boolean);
        const requiredScopes = ["https://www.googleapis.com/auth/photospicker.mediaitems.readonly", "https://www.googleapis.com/auth/drive.file"];
        if (grantedScopes.length && requiredScopes.some((scope) => !grantedScopes.includes(scope))) return back("missing_scope", claims.returnTo);
        const user = await User.findById(claims.uid);
        if (!user) throw new Error("Account not found");
        const key = await user.getDataKey();
        const sameAccount = decode(user.photoConnections, key).filter((item) => normEmail(item.email) === normEmail(profile.email));
        const batches = await PhotoImportBatch.find({ userId: user._id }, "sourceConnectionId destinationIds").lean();
        const existing = pickPrimary(sameAccount, linkCounts(decode(user.photoMedia, key), batches));
        const connection = { ...(existing || {}), id: existing?.id || crypto.randomUUID(), label: clean(claims.label || existing?.label || profile.name || "Google account", 80), email: clean(profile.email, 160), provider: "Google Drive", status: "connected", eligible: existing?.eligible !== false, priority: existing?.priority || (user.photoConnections || []).length + 1, lastScan: existing?.lastScan || null, oauthMode: "connected", accessToken: tokens.access_token, refreshToken: tokens.refresh_token || existing?.refreshToken || "", tokenType: tokens.token_type, expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000, scopes: grantedScopes };
        if (existing?._eid) await updateEntry(user, "photoConnections", connection, key);
        else await pushEntry(user, "photoConnections", connection, key);
        return back("connected", claims.returnTo);
    } catch (error) { return back("error", "/photos"); }
});

/* Entries for the same Google account are folded into one (files and imports move to the kept entry). */
async function accountPlan(user, key) {
    const connections = decode(user.photoConnections, key);
    const media = decode(user.photoMedia, key);
    const batches = await PhotoImportBatch.find({ userId: user._id }, "sourceConnectionId destinationIds").lean();
    // Only rewrite the stored lists when every saved record could be read; otherwise an unreadable one would be dropped.
    const complete = connections.length === (user.photoConnections || []).length && media.length === (user.photoMedia || []).length;
    return { ...mergeAccounts(connections, media, batches), batches, complete };
}

async function applyAccountMerge(user, key, plan) {
    if (!plan.complete || !plan.into.size) return false;
    const removeIds = plan.removable.map((c) => new mongoose.Types.ObjectId(c._eid));
    await User.updateOne({ _id: user._id }, { $set: { photoMedia: plan.media.map((item) => encoded(key, item)) }, $pull: { photoConnections: { _id: { $in: removeIds } } } });
    for (const batch of plan.batches) {
        const sourceConnectionId = plan.target(batch.sourceConnectionId);
        const destinationIds = [...new Set((batch.destinationIds || []).map(plan.target))];
        if (sourceConnectionId !== batch.sourceConnectionId || destinationIds.join() !== (batch.destinationIds || []).join()) await PhotoImportBatch.updateOne({ _id: batch._id }, { $set: { sourceConnectionId, destinationIds } });
    }
    return true;
}

router.get("/photo-cloud/connections/duplicates", photosAuth, async (req, res) => {
    try {
        const key = await req.rootUser.getDataKey();
        const plan = await accountPlan(req.rootUser, key);
        return res.json({ removable: plan.removable.map((c) => ({ id: c.id, label: c.label, email: c.email, status: c.status })), files: plan.media.length - (req.rootUser.photoMedia || []).length });
    } catch (error) { return serverError(res, "photo-cloud/connections/duplicates", error); }
});

/* Removes the listed duplicates only when the body says confirm: true. Without it, this only reports what would go. */
router.post("/photo-cloud/connections/duplicates/cleanup", photosAuth, async (req, res) => {
    try {
        const key = await req.rootUser.getDataKey();
        const plan = await accountPlan(req.rootUser, key);
        const list = plan.removable.map((c) => ({ id: c.id, label: c.label, email: c.email, status: c.status }));
        if (req.body?.confirm !== true) return res.json({ dryRun: true, removable: list, message: "Nothing changed. Send confirm: true to fold these entries." });
        const applied = await applyAccountMerge(req.rootUser, key, plan);
        return res.json({ dryRun: false, applied, removed: applied ? plan.removable.length : 0, removable: list, message: "Duplicate account entries folded into their kept entry. Files in Drive were not touched." });
    } catch (error) { return serverError(res, "photo-cloud/connections/duplicates/cleanup", error); }
});

router.get("/photo-cloud/dashboard", photosAuth, async (req, res) => {
    try {
        const key = await req.rootUser.getDataKey();
        const plan = await accountPlan(req.rootUser, key);
        await applyAccountMerge(req.rootUser, key, plan);
        const connections = plan.connections;
        const media = plan.media.map(({ _eid, ...item }) => item);
        const jobs = decode(req.rootUser.photoBackupJobs, key).map(({ _eid, sessionUri, ...job }) => job).slice(-200).reverse();
        const driveFolders = connections.flatMap((connection) => (connection.driveFolders || []).map((folder) => ({ ...folder, connectionId: connection.id, account: connection.email || connection.label })));
        const byChecksum = new Map();
        for (const item of media) if (item.checksum) byChecksum.set(item.checksum, [...(byChecksum.get(item.checksum) || []), item.id]);
        const duplicateGroups = [...byChecksum.values()].filter((ids) => ids.length > 1);
        const settings = photoSettings(req.rootUser, key);
        const folders = decode(req.rootUser.photoFolders, key).map(({ _eid, driveIds, ...folder }) => ({ ...folder, count: media.filter((m) => m.folderId === folder.id).length }));
        const suggestion = suggestAccount(connections, { bufferGb: Number(settings.safetyBufferGb ?? 2), defaultId: settings.defaultConnectionId });
        return res.json({ connections: connections.map(publicConnection), driveFolders, totals: storageTotals(connections), suggestion, folders, workers: { enabled: workers.enabled(), count: workers.urls().length }, media, jobs, duplicateGroups, albums: decode(req.rootUser.photoAlbums, key).map(({ _eid, ...album }) => album), settings: { ...settings, defaultConnectionId: settings.defaultConnectionId || connections[0]?.id || "" }, providerNotice: "Google Drive is the initial supported provider. Originals stay in the connected account; this app stores the index and organization metadata." });
    } catch (error) { return serverError(res, "photo-cloud/dashboard", error); }
});

router.post("/photo-cloud/connections", photosAuth, async (req, res) => {
    const email = clean(req.body.email, 160).toLowerCase();
    const label = clean(req.body.label || email.split("@")[0], 80);
    if (!email.includes("@")) return res.status(400).json({ error: "Enter a valid Google account email." });
    try {
        const key = await req.rootUser.getDataKey();
        const connection = { id: crypto.randomUUID(), label, email, provider: "Google Drive", status: "connected", usedGb: 0, limitGb: 15, eligible: true, priority: (req.rootUser.photoConnections || []).length + 1, lastScan: null, oauthMode: "pending-provider-consent" };
        await pushEntry(req.rootUser, "photoConnections", connection, key);
        return res.status(201).json({ connection });
    } catch (error) { return serverError(res, "photo-cloud/connections", error); }
});

const findConnection = async (req) => {
    const key = await req.rootUser.getDataKey();
    return { key, current: decode(req.rootUser.photoConnections, key).find((item) => item.id === req.params.id) };
};

/** Refreshes one account's index. The Drive scan runs on a worker server when one is available. */
async function syncConnection(user, key, current) {
    if (!current.accessToken) { current.lastScan = new Date().toISOString(); await updateEntry(user, "photoConnections", current, key); return { found: 0, added: 0 }; }
    if (current.expiresAt && current.expiresAt - Date.now() < 120000) { await refreshGoogleToken(current); }
    let result = await workers.run("index", { accessToken: current.accessToken, maxPages: 10 }, { timeoutMs: 90000 });
    if (result && result.status === 401) result = null;
    if (!result) {
        result = await listDriveMedia(current.accessToken, { maxPages: 10 });
        if (!result.ok && result.status === 401 && await refreshGoogleToken(current)) result = await listDriveMedia(current.accessToken, { maxPages: 10 });
    }
    let found = 0, added = 0;
    if (!result.ok) { current.status = result.status === 401 ? "reauthorize" : "provider_error"; current.lastError = "Google Drive did not allow the index scan."; }
    else {
        if (result.quota) { current.usedGb = result.quota.usedGb; current.limitGb = result.quota.limitGb; }
        const folderResult = await listDriveFolders(current.accessToken, { maxPages: 10 }).catch(() => ({ ok: false, folders: [] }));
        current.driveFolders = folderResult.ok ? folderResult.folders.map((folder) => ({ id: folder.id, name: folder.name, webViewUrl: folder.webViewLink || "", parents: folder.parents || [], modifiedAt: folder.modifiedTime || null })) : (current.driveFolders || []);
        const fresh = await User.findById(user._id, "photoMedia"); // re-read: an earlier account's scan may have just changed it
        const all = decode(fresh?.photoMedia, key);
        const previous = new Map(all.filter((item) => item.sourceConnectionId === current.id).map((item) => [item.id, item]));
        const others = all.filter((item) => item.sourceConnectionId !== current.id);
        const list = result.files.map((file) => {
            const id = `${current.id}:${file.id}`;
            const old = previous.get(id) || {};
            return { id, filename: file.name, type: file.mimeType?.startsWith("video/") ? "video" : /screenshot/i.test(file.name) ? "screenshot" : "photo", mimeType: file.mimeType, size: Number(file.size || 0) / (1024 * 1024 * 1024), takenAt: file.imageMediaMetadata?.time ? file.imageMediaMetadata.time.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3") : file.createdTime, modifiedAt: file.modifiedTime, width: file.imageMediaMetadata?.width || null, height: file.imageMediaMetadata?.height || null, sourceConnectionId: current.id, providerFileId: file.id, hasThumbnail: Boolean(file.thumbnailLink), thumbnailUrl: file.thumbnailLink || null, webViewUrl: file.webViewLink || null, checksum: file.md5Checksum || null, availabilityState: "available", account: current.email, tag: old.tag || "Drive", favorite: Boolean(old.favorite), archived: Boolean(old.archived), localId: old.localId || null, folderId: old.folderId || null, imported: old.imported ?? !old.localId };
        });
        found = list.length; added = list.filter((m) => !previous.has(m.id)).length;
        await User.updateOne({ _id: user._id }, { $set: { photoMedia: [...others, ...list].map((item) => encoded(key, item)) } });
        current.indexedCount = found; current.status = "connected"; current.lastError = null;
    }
    current.lastScan = new Date().toISOString();
    await updateEntry(user, "photoConnections", current, key);
    return { found, added };
}

router.post("/photo-cloud/connections/:id/sync", photosAuth, async (req, res) => {
    try {
        const { key, current } = await findConnection(req);
        if (!current) return res.status(404).json({ error: "Account not found." });
        const result = await syncConnection(req.rootUser, key, current);
        return res.json({ connection: publicConnection(current), ...result, message: current.status === "connected" ? "Google Drive index refreshed." : "The account needs attention before it can be indexed." });
    } catch (error) { return serverError(res, "photo-cloud/connections/sync", error); }
});

/* "Bring old photos": scan every connected account's Drive for photos and videos that are already there. */
router.post("/photo-cloud/import-existing", photosAuth, async (req, res) => {
    try {
        const key = await req.rootUser.getDataKey();
        const accounts = decode(req.rootUser.photoConnections, key).filter((c) => c.status === "connected" && c.accessToken);
        if (!accounts.length) return res.status(400).json({ error: "Connect a Google account first." });
        const results = [];
        for (const account of accounts) { // one at a time: each scan rewrites the shared media list
            const r = await syncConnection(req.rootUser, key, account);
            results.push({ id: account.id, label: account.label, found: r.found, added: r.added, status: account.status });
        }
        return res.json({ results, found: results.reduce((n, r) => n + r.found, 0), added: results.reduce((n, r) => n + r.added, 0) });
    } catch (error) { return serverError(res, "photo-cloud/import-existing", error); }
});

router.get("/photo-cloud/workers", photosAuth, async (req, res) => {
    try { return res.json({ enabled: workers.enabled(), workers: await workers.status() }); }
    catch (error) { return serverError(res, "photo-cloud/workers", error); }
});

router.put("/photo-cloud/connections/:id", photosAuth, async (req, res) => {
    try {
        const { key, current } = await findConnection(req);
        if (!current) return res.status(404).json({ error: "Account not found." });
        if (typeof req.body.eligible === "boolean") current.eligible = req.body.eligible;
        if (req.body.priority !== undefined) current.priority = Math.max(1, Math.min(99, Number(req.body.priority) || current.priority || 1));
        await updateEntry(req.rootUser, "photoConnections", current, key);
        return res.json({ connection: publicConnection(current) });
    } catch (error) { return serverError(res, "photo-cloud/connections/update", error); }
});

router.delete("/photo-cloud/connections/:id", photosAuth, async (req, res) => {
    try {
        const { key, current } = await findConnection(req);
        if (!current) return res.status(404).json({ error: "Account not found." });
        current.status = "disconnected";
        current.eligible = false;
        current.accessToken = "";
        current.refreshToken = "";
        const media = decode(req.rootUser.photoMedia, key).map((item) => item.sourceConnectionId === current.id ? { ...item, availabilityState: "source_unavailable" } : item);
        await updateEntry(req.rootUser, "photoConnections", current, key);
        await User.updateOne({ _id: req.rootUser._id }, { $set: { photoMedia: media.map((item) => encoded(key, item)) } });
        return res.json({ connection: publicConnection(current), message: "Account disconnected. Cloud files were not deleted." });
    } catch (error) { return serverError(res, "photo-cloud/connections/disconnect", error); }
});

router.put("/photo-cloud/routing-policy", photosAuth, async (req, res) => {
    try {
        const key = await req.rootUser.getDataKey();
        const settings = { wifiOnly: Boolean(req.body.wifiOnly), chargingOnly: Boolean(req.body.chargingOnly), safetyBufferGb: Math.max(0, Math.min(20, Number(req.body.safetyBufferGb) || 2)), defaultConnectionId: clean(req.body.defaultConnectionId, 100), updatedAt: new Date().toISOString() };
        await User.updateOne({ _id: req.rootUser._id }, { $set: { photoSettings: [encoded(key, settings)] } });
        return res.json({ settings });
    } catch (error) { return serverError(res, "photo-cloud/routing-policy", error); }
});

router.get("/photo-cloud/export", photosAuth, async (req, res) => {
    try {
        const key = await req.rootUser.getDataKey();
        const connections = decode(req.rootUser.photoConnections, key).map((connection) => ({ id: connection.id, label: connection.label, email: connection.email, provider: connection.provider, status: connection.status, lastScan: connection.lastScan }));
        const media = decode(req.rootUser.photoMedia, key).map((item) => ({ id: item.id, filename: item.filename, type: item.type, mimeType: item.mimeType, size: item.size, takenAt: item.takenAt, modifiedAt: item.modifiedAt, sourceConnectionId: item.sourceConnectionId, providerFileId: item.providerFileId, checksum: item.checksum, availabilityState: item.availabilityState }));
        const jobs = decode(req.rootUser.photoBackupJobs, key).map(({ _eid, sessionUri, ...job }) => job);
        return res.json({ format: "stashr-photo-cloud-manifest", version: 1, exportedAt: new Date().toISOString(), providerNotice: "This manifest contains app metadata and provider mappings; it does not contain provider passwords or OAuth tokens.", connections, media, backupJobs: jobs });
    } catch (error) { return serverError(res, "photo-cloud/export", error); }
});

router.delete("/photo-cloud/media/:id", photosAuth, async (req, res) => {
    try {
        const key = await req.rootUser.getDataKey();
        const media = decode(req.rootUser.photoMedia, key);
        const target = media.find((item) => item.id === req.params.id);
        if (!target) return res.status(404).json({ error: "Media item not found." });
        const remaining = media.filter((item) => item.id !== target.id);
        await User.updateOne({ _id: req.rootUser._id }, { $set: { photoMedia: remaining.map((item) => encoded(key, item)) } });
        return res.json({ removed: true, message: "Removed from Photo Cloud index. The original file was not deleted." });
    } catch (error) { return serverError(res, "photo-cloud/media/remove", error); }
});

router.patch("/photo-cloud/media/:id", photosAuth, async (req, res) => {
    try {
        if (typeof req.body.favorite !== "boolean") return res.status(400).json({ error: "favorite must be true or false." });
        const key = await req.rootUser.getDataKey();
        const media = decode(req.rootUser.photoMedia, key);
        const target = media.find((item) => item.id === req.params.id);
        if (!target) return res.status(404).json({ error: "Media item not found." });
        target.favorite = req.body.favorite;
        await User.updateOne({ _id: req.rootUser._id }, { $set: { photoMedia: media.map((item) => encoded(key, item)) } });
        return res.json({ id: target.id, favorite: target.favorite });
    } catch (error) { return serverError(res, "photo-cloud/media/favorite", error); }
});

router.post("/photo-cloud/backup/jobs", photosAuth, async (req, res) => {
    const filename = clean(req.body.filename, 180);
    if (!filename) return res.status(400).json({ error: "A filename is required." });
    try {
        const key = await req.rootUser.getDataKey();
        const job = { id: crypto.randomUUID(), filename, size: Number(req.body.size) || 0, status: "queued", destinationConnectionId: clean(req.body.destinationConnectionId, 100), verification: "pending", createdAt: new Date().toISOString() };
        await pushEntry(req.rootUser, "photoBackupJobs", job, key);
        return res.status(202).json({ job });
    } catch (error) { return serverError(res, "photo-cloud/backup/jobs", error); }
});

router.post("/photo-cloud/shares", photosAuth, async (req, res) => {
    const days = Math.max(1, Math.min(30, Number(req.body.expiresInDays) || 7));
    try {
        const key = await req.rootUser.getDataKey();
        const media = decode(req.rootUser.photoMedia, key);
        const requested = Array.isArray(req.body.mediaIds) && req.body.mediaIds.length ? req.body.mediaIds : media.map((item) => item.id);
        const items = media.filter((item) => requested.includes(item.id)).map((item) => ({ id: item.id, filename: item.filename, type: item.type, size: item.size, tag: item.tag, favorite: item.favorite, takenAt: item.takenAt }));
        if (!items.length) return res.status(400).json({ error: "Select at least one item to share." });
        const token = crypto.randomBytes(32).toString("base64url");
        const expiresAt = new Date(Date.now() + days * 86400000);
        const share = { tokenHash: tokenHash(token), ...shareEncoded(key, { title: clean(req.body.title || "Shared from Photo Cloud", 120), items, allowDownload: Boolean(req.body.allowDownload), ownerLabel: clean(req.rootUser.name || "A Stashr user", 80) }), createdAt: new Date(), expiresAt };
        await User.updateOne({ _id: req.rootUser._id }, { $push: { photoShares: share } });
        return res.status(201).json({ token, expiresAt, shareId: String(share._id) });
    } catch (error) { return serverError(res, "photo-cloud/shares", error); }
});

router.get("/photo-cloud/shares", photosAuth, async (req, res) => {
    try {
        const key = await req.rootUser.getDataKey();
        return res.json({ shares: (req.rootUser.photoShares || []).filter((share) => !share.revokedAt).map((share) => ({ id: String(share._id), createdAt: share.createdAt, expiresAt: share.expiresAt, revokedAt: share.revokedAt })) });
    } catch (error) { return serverError(res, "photo-cloud/shares/list", error); }
});

router.delete("/photo-cloud/shares/:id", photosAuth, async (req, res) => {
    try {
        const result = await User.updateOne({ _id: req.rootUser._id, "photoShares._id": req.params.id }, { $set: { "photoShares.$.revokedAt": new Date() } });
        if (!result.matchedCount) return res.status(404).json({ error: "Share link not found." });
        return res.json({ message: "Share link revoked." });
    } catch (error) { return serverError(res, "photo-cloud/shares/revoke", error); }
});

// Public by design: the token is the only credential. It never returns provider IDs or tokens.
router.get("/public/photo-cloud/shares/:token", async (req, res) => {
    const hash = tokenHash(req.params.token);
    try {
        const user = await User.findOne({ "photoShares.tokenHash": hash });
        const share = user?.photoShares?.find((item) => item.tokenHash === hash);
        if (!user || !share || share.revokedAt || (share.expiresAt && new Date(share.expiresAt) < new Date())) return res.status(404).json({ error: "This share link is unavailable or expired." });
        const key = await user.getDataKey();
        const payload = User.publicEntry(share, key);
        return res.json({ ...payload, shareId: String(share._id), expiresAt: share.expiresAt });
    } catch (error) { return res.status(500).json({ error: "This share link could not be opened." }); }
});

module.exports = router;
