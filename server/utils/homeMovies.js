/**
 * Movies from a Google Drive folder to the TV's USB drive, through a Google account connected from Smart home
 * (the one Photo Cloud uses). The TV asks for the list and the files; once a movie is fully on the USB drive, with the
 * same name and size, Stashr can remove it from Drive so Drive does not fill up.
 *
 * Listing and downloading work with the read-only Drive access Photo Cloud has. Removing needs full Drive access, so
 * "delete after sync" only works once that Google connection was made with it (a connection that cannot delete says so).
 */
const User = require("../models/schema");
const Settings = require("../models/homeMovieSettings");
const store = require("./photoStore");
const { wantedVideo } = require("./homeVideo");

const FULL_DRIVE = "https://www.googleapis.com/auth/drive";
const api = () => String(process.env.GOOGLE_API_URL || "https://www.googleapis.com").replace(/\/$/, "");

/** A folder link or a bare id -> the folder id, or null. */
function folderIdFrom(input) {
    const s = String(input || "").trim();
    const m = /\/folders\/([\w-]+)/.exec(s) || /[?&]id=([\w-]+)/.exec(s);
    const id = m ? m[1] : s;
    return /^[\w-]{10,}$/.test(id) ? id : null;
}

const skip = () => Object.fromEntries([...User.HISTORY_FIELDS, "passwords"].map((f) => [f, 0]));

/** The Google connections you may pick from, without their tokens. */
async function connectionsOf(ownerId) {
    const user = await User.findById(ownerId, skip());
    if (!user) return [];
    const key = await user.getDataKey();
    return store.decode(user.photoConnections, key)
        .filter((c) => c.accessToken || c.refreshToken)
        .map((c) => ({ id: c.id, label: c.label || c.email || "Google account", email: c.email || "", canDelete: (c.scopes || []).includes(FULL_DRIVE) }));
}

/** Everything needed to talk to Drive for this account, or null when no folder is chosen yet. */
async function context(ownerId) {
    const settings = await Settings.findOne({ owner: ownerId });
    if (!settings || !settings.connectionId || !settings.folderId) return null;
    const user = await User.findById(ownerId, skip());
    if (!user) return null;
    const key = await user.getDataKey();
    const connection = store.decode(user.photoConnections, key).find((c) => c.id === settings.connectionId);
    if (!connection) return { settings, missing: true };
    return { user, key, connection, settings, canDelete: (connection.scopes || []).includes(FULL_DRIVE) };
}

const cache = new Map(); // owner -> { at, files }

async function list(ctx, { fresh = false } = {}) {
    const id = String(ctx.settings.owner);
    const hit = cache.get(id);
    if (!fresh && hit && Date.now() - hit.at < 30000) return hit.files;
    const out = [];
    let pageToken = "";
    do {
        const params = new URLSearchParams({
            q: `'${ctx.settings.folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
            fields: "nextPageToken,files(id,name,size,modifiedTime)", pageSize: "1000", orderBy: "modifiedTime desc", supportsAllDrives: "true", includeItemsFromAllDrives: "true"
        });
        if (pageToken) params.set("pageToken", pageToken);
        const r = await store.driveFetch(ctx.user, ctx.key, ctx.connection, `${api()}/drive/v3/files?${params}`);
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw Object.assign(new Error(`Google Drive answered HTTP ${r.status}${j.error && j.error.message ? ": " + j.error.message : ""}`), { status: 502 });
        for (const f of j.files || []) if (f.size && wantedVideo(f.name)) out.push({ id: f.id, name: f.name, size: Number(f.size), path: f.id });
        pageToken = j.nextPageToken || "";
    } while (pageToken);
    cache.set(id, { at: Date.now(), files: out });
    return out;
}

/**
 * A short-lived Drive access token for the TV, so it can download the movie straight from Google instead of through
 * this server (the server's bandwidth is what is metered). Refreshed when close to expiry; saved like driveFetch does.
 */
async function grant(ctx) {
    const soon = !ctx.connection.expiresAt || ctx.connection.expiresAt - Date.now() < 5 * 60 * 1000;
    if (soon) {
        if (!(await store.refreshGoogleToken(ctx.connection))) throw Object.assign(new Error("Could not refresh the Google connection."), { status: 502 });
        if (ctx.connection._eid) await store.updateEntry(ctx.user, "photoConnections", ctx.connection, ctx.key);
    }
    return { accessToken: ctx.connection.accessToken, expiresAt: ctx.connection.expiresAt, api: api() };
}

/** A download from Drive, whole or a byte range. Returns the fetch Response (not ok responses are returned too). */
function open(ctx, file, range) {
    return store.driveFetch(ctx.user, ctx.key, ctx.connection, `${api()}/drive/v3/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`, { headers: range ? { Range: range } : {} });
}

// One clean-up at a time per account, so two reports cannot delete the same file twice.
const chains = new Map();

/**
 * The TV says which movies are on its USB drive. Any that are in the Drive folder with the same name AND size are
 * complete copies, and are removed from Drive. Nothing is removed on a guess, or when it is switched off.
 */
function settle(ownerId, usbMovies) {
    const id = String(ownerId);
    const prior = chains.get(id) || Promise.resolve();
    const next = prior.then(async () => {
        const ctx = await context(ownerId);
        if (!ctx || ctx.missing || !ctx.settings.deleteAfterSync || !ctx.canDelete) return;
        const have = (Array.isArray(usbMovies) ? usbMovies : []).filter((m) => m && m.where === "Synced" && m.size > 0);
        if (!have.length) return;
        const files = await list(ctx, { fresh: true });
        for (const m of have) {
            const hit = files.find((f) => f.name === m.name && f.size === Number(m.size));
            if (!hit) continue;
            try {
                const r = await store.driveFetch(ctx.user, ctx.key, ctx.connection, `${api()}/drive/v3/files/${encodeURIComponent(hit.id)}?supportsAllDrives=true`, { method: "DELETE" });
                if (!r.ok && r.status !== 404) throw new Error(`Google Drive answered HTTP ${r.status}`);
                cache.delete(id);
                await Settings.updateOne({ owner: ownerId }, { $set: { lastDelete: { at: new Date(), name: m.name, error: "" } } });
            } catch (e) {
                await Settings.updateOne({ owner: ownerId }, { $set: { lastDelete: { at: new Date(), name: m.name, error: String(e.message).slice(0, 200) } } });
            }
        }
    }).catch(() => {});
    chains.set(id, next);
    return next;
}

/**
 * Photos for the tablet's slideshow, from another Drive folder, through the same Google account the movies use (or
 * the only connected one). Returns { ctx, files: [{ id, name }] }; ctx is null when no Google account is connected.
 */
const imageCache = new Map();
async function listImages(ownerId, folderId) {
    const settings = await Settings.findOne({ owner: ownerId }).lean();
    const user = await User.findById(ownerId, skip());
    if (!user || !folderId) return { ctx: null, files: [] };
    const key = await user.getDataKey();
    const all = store.decode(user.photoConnections, key).filter((c) => c.accessToken || c.refreshToken);
    const connection = all.find((c) => settings && c.id === settings.connectionId) || all[0];
    if (!connection) return { ctx: null, files: [] };
    const ctx = { user, key, connection };
    const hit = imageCache.get(String(ownerId) + folderId);
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return { ctx, files: hit.files };
    const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`,
        fields: "files(id,name,mimeType,thumbnailLink)", pageSize: "500", orderBy: "modifiedTime desc", supportsAllDrives: "true", includeItemsFromAllDrives: "true"
    });
    const r = await store.driveFetch(user, key, connection, `${api()}/drive/v3/files?${params}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(`Google Drive answered HTTP ${r.status}${j.error && j.error.message ? ": " + j.error.message : ""}`), { status: 502 });
    const files = (j.files || []).filter((f) => /^image\/(jpeg|png|webp|heic|heif)$/.test(f.mimeType || "")).map((f) => ({ id: f.id, name: f.name, thumb: f.thumbnailLink || "" }));
    imageCache.set(String(ownerId) + folderId, { at: Date.now(), files });
    return { ctx, files };
}

/**
 * One photo for the slideshow: Drive's resized thumbnail (about the tablet's screen size, a fraction of the original's
 * bytes) when there is one, else the file itself.
 */
async function openImage(ctx, file) {
    if (file.thumb) {
        const sized = file.thumb.replace(/=s\d+(-[a-z]+)?$/, "") + "=s1600";
        const r = await store.driveFetch(ctx.user, ctx.key, ctx.connection, sized);
        if (r.ok && r.body) return r;
    }
    return store.driveFetch(ctx.user, ctx.key, ctx.connection, `${api()}/drive/v3/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`);
}

module.exports = { folderIdFrom, connectionsOf, context, list, open, grant, settle, listImages, openImage, FULL_DRIVE };
