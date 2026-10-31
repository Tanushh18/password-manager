// Photos and videos for the ShineOne Estate website, kept per sector / area. Same layout as the Tasks app:
// Cloudinary folder ShineOne/<key>/, in a separate Cloudinary account (the *_shine variables).
const crypto = require("node:crypto");

const BUILT_IN = [
    { key: "sec 4", label: "Sector 4", tag: "sec4" },
    { key: "sec 9", label: "Sector 9", tag: "sec9" },
    { key: "sec 42", label: "Sector 42", tag: "sec42" },
    { key: "sec 46", label: "Sector 46", tag: "sec46" },
    { key: "reliance met city", label: "Reliance Met City", tag: "reliancemetcity" }
];

const creds = () => ({
    cloud: process.env.CLOUDINARY_CLOUD_NAME_shine || "",
    key: process.env.CLOUDINARY_API_KEY_shine || "",
    secret: process.env.CLOUDINARY_API_SECRET_shine || ""
});
const isConfigured = () => { const c = creds(); return Boolean(c.cloud && c.key && c.secret); };

/** "Sector 12" / "Green Valley!" -> { key: "sector 12", label, tag }. Null when nothing usable is left. */
const sectorFromLabel = (input) =>
{
    const label = String(input || "").replace(/\s+/g, " ").trim().slice(0, 40);
    const key = label.toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/\s+/g, " ").trim();
    if (key.length < 2) return null;
    return { key, label, tag: key.replace(/[^a-z0-9]/g, "") };
};

const sign = (params, secret) =>
{
    const text = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
    return crypto.createHash("sha1").update(text + secret).digest("hex");
};

const toItem = (c, r, kind) =>
{
    const base = `https://res.cloudinary.com/${c.cloud}/${kind}/upload`;
    const path = r.public_id.split("/").map(encodeURIComponent).join("/");
    const ext = kind === "video" ? "mp4" : (r.format || "jpg");
    const thumb = kind === "video" ? `${base}/so_0,w_400,h_300,c_fill/v${r.version}/${path}.jpg` : `${base}/w_400,h_300,c_fill,q_auto/v${r.version}/${path}.${ext}`;
    return { publicId: r.public_id, kind, url: `${base}/v${r.version}/${path}.${ext}`, thumb, bytes: r.bytes || 0, createdAt: r.created_at || "" };
};

const admin = async (c, method, path, params) =>
{
    const url = new URL(`https://api.cloudinary.com/v1_1/${c.cloud}${path}`);
    for (const [k, v] of Object.entries(params || {})) if (v !== undefined) url.searchParams.append(k, v);
    const res = await fetch(url, { method, headers: { Authorization: "Basic " + Buffer.from(`${c.key}:${c.secret}`).toString("base64") } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body.error && body.error.message) || `Cloudinary answered ${res.status}`);
    return body;
};

const listKind = async (c, sector, kind) =>
{
    const out = [];
    let cursor;
    do
    {
        const page = await admin(c, "GET", `/resources/${kind}/upload`, { prefix: `ShineOne/${sector.key}/`, max_results: 500, next_cursor: cursor });
        for (const r of page.resources || []) out.push(toItem(c, r, kind));
        cursor = page.next_cursor;
    } while (cursor);
    return out;
};

const CACHE_MS = 60 * 1000;
let cache = null;
const clearCache = () => { cache = null; };

/** { key -> items[] } for the given sectors, newest first. Cached for a minute. */
const listAll = async (sectors) =>
{
    const sig = sectors.map((s) => s.key).join("|");
    if (cache && cache.sig === sig && Date.now() - cache.at < CACHE_MS) return cache.data;
    const c = creds();
    const data = {};
    await Promise.all(sectors.map(async (s) =>
    {
        const [images, videos] = await Promise.all([listKind(c, s, "image"), listKind(c, s, "video")]);
        data[s.key] = [...images, ...videos].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || a.publicId.localeCompare(b.publicId));
    }));
    cache = { at: Date.now(), sig, data };
    return data;
};

/** What the phone / browser posts to Cloudinary to upload straight there. */
const signUpload = (sector, kind) =>
{
    const c = creds();
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = `ShineOne/${sector.key}`;
    return {
        uploadUrl: `https://api.cloudinary.com/v1_1/${c.cloud}/${kind}/upload`,
        apiKey: c.key, timestamp, folder, tags: sector.tag,
        signature: sign({ folder, tags: sector.tag, timestamp }, c.secret)
    };
};

const deleteMedia = async (publicId, kind) =>
{
    const c = creds();
    const res = await admin(c, "DELETE", `/resources/${kind}/upload`, { "public_ids[]": publicId, invalidate: "true" });
    clearCache();
    return res;
};

module.exports = { BUILT_IN, isConfigured, sectorFromLabel, sign, listAll, signUpload, deleteMedia, clearCache };
