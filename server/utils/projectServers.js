const User = require("../models/schema");
const { DEFAULTS, SLUG, isAdminEmail } = require("./registryDefaults");
const { linkedServices } = require("./projectMerge");

/*
 * A project's own list of backend URLs (project.serverUrls) and the public registry list it feeds.
 *   - rows are { url, enabled, auto }: `auto` rows follow the project's Render servers, the others are the user's own
 *   - a server the user removed by hand is remembered in project.serverUrlsIgnored and never added back
 *   - the public list at /registry/<project.registryApp> carries only the switched-on URLs
 */
const origin = (value) => { try { return new URL(String(value || "")).origin.toLowerCase(); } catch (e) { return ""; } };
const trimUrl = (value) => String(value || "").trim().replace(/\/+$/, "");
const STRIP = ["_id", "createdAt", "updatedAt", "broken"];

/** "My Shop API" -> "my-shop-api". Falls back to "project" when nothing usable is left. */
function slugify(name) {
    const base = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 38).replace(/-+$/g, "");
    const slug = base.length >= 3 ? base : base ? base + "-app" : "project";
    return SLUG.test(slug) ? slug : "project";
}

/** Servers this project runs on Render: its linked services that are not static sites (those are clients, not servers). */
function discoverServers(fields, services) {
    const byId = new Map((services || []).map((s) => [String(s.id), s]));
    const out = [];
    const seen = new Set();
    for (const link of linkedServices([fields])) {
        const live = byId.get(String(link.serviceId));
        const type = live ? String(live.type || "") : "";
        if (type === "static_site") continue;
        const url = (live && live.url) || link.url;
        const o = origin(url);
        if (!o || !/^https:/.test(o) || seen.has(o)) continue;
        seen.add(o);
        out.push({ origin: o, name: link.name || (live && live.name) || "", suspended: live ? live.suspended === true : Boolean(link.suspended) });
    }
    return out;
}

/** Adds servers that appeared, drops auto rows whose server is gone, leaves every row the user made alone. */
function mergeServerUrls(rows, found, ignored) {
    const current = Array.isArray(rows) ? rows : [];
    const skip = new Set((ignored || []).map((u) => origin(u) || String(u).toLowerCase()));
    const foundOrigins = new Set(found.map((f) => f.origin));
    const next = current.filter((r) => !(r.auto && !foundOrigins.has(origin(r.url)))).map((r) => ({ ...r }));
    const paths = new Set(next.filter((r) => origin(r.url)).map((r) => new URL(r.url).pathname.replace(/\/+$/, "")));
    const suffix = paths.size === 1 ? [...paths][0] : "";
    const have = new Set(next.map((r) => origin(r.url)));
    for (const f of found) {
        if (have.has(f.origin) || skip.has(f.origin)) continue;
        next.push({ url: f.origin + suffix, enabled: !f.suspended, auto: true });
        have.add(f.origin);
    }
    return { rows: next, changed: JSON.stringify(next) !== JSON.stringify(current) };
}

/** Publishes the switched-on URLs to /registry/<slug>. Returns false (never throws) when it is not allowed or fails. */
async function publishToRegistry(app, rows, user) {
    const name = String(app || "").toLowerCase();
    const urls = (rows || []).filter((r) => r.enabled !== false).map((r) => trimUrl(r.url)).filter(Boolean);
    if (urls.length === 0 || (!DEFAULTS[name] && !SLUG.test(name))) return false;
    try {
        const Registry = require("../models/registry");
        const doc = await Registry.findOne({ app: name }).lean();
        const admin = isAdminEmail(user && user.email);
        if (DEFAULTS[name] && !admin) return false;
        if (doc && doc.owner && String(doc.owner) !== String(user._id) && !admin) return false;
        const set = { urls, updatedAt: new Date(), updatedBy: user.email || "project-sync" };
        if (!DEFAULTS[name] && !(doc && doc.owner)) set.owner = user._id;
        await Registry.findOneAndUpdate({ app: name }, { $set: set }, { upsert: true, setDefaultsOnInsert: true });
        return true;
    } catch (e) { return false; }
}

/** A free slug for this project: its own name, or name-2, name-3 ... when another account already uses it. */
async function pickSlug(user, name) {
    const Registry = require("../models/registry");
    const base = slugify(name);
    for (let n = 1; n < 50; n++) {
        const slug = n === 1 ? base : (base.slice(0, 35) + "-" + n);
        if (DEFAULTS[slug] && !isAdminEmail(user.email)) continue;
        const doc = await Registry.findOne({ app: slug }).lean();
        if (!doc || !doc.owner || String(doc.owner) === String(user._id)) return slug;
    }
    return base + "-" + Date.now().toString(36).slice(-4);
}

async function saveFields(user, dataKey, entry, fields) {
    const next = { ...fields };
    STRIP.forEach((k) => delete next[k]);
    const sealed = User.sealEntry(dataKey, next);
    await User.updateOne({ _id: user._id, "projects._id": entry._id }, { $set: { "projects.$.enc": "udk", "projects.$.data": sealed, "projects.$.updatedAt": new Date() } });
    entry.enc = "udk";
    entry.data = sealed;
}

/**
 * Brings one project's Server URLs in step with its Render servers and publishes them. Does nothing for a project that
 * has no registryApp (not published). `registryApp` here overrides the saved one (used when publishing is switched on).
 */
async function syncProjectServers(user, dataKey, entry, services, { registryApp } = {}) {
    const fields = User.publicEntry(entry, dataKey);
    if (fields.broken || fields.enc === "e2e") return { changed: false, published: false };
    const app = registryApp || fields.registryApp;
    if (!app) return { changed: false, published: false };
    const found = discoverServers(fields, services);
    const merged = mergeServerUrls(fields.serverUrls, found, fields.serverUrlsIgnored);
    const appChanged = app !== fields.registryApp;
    if (merged.changed || appChanged) await saveFields(user, dataKey, entry, { ...fields, serverUrls: merged.rows, registryApp: app });
    const published = merged.rows.length ? await publishToRegistry(app, merged.rows, user) : false;
    return { changed: merged.changed || appChanged, published, serverUrls: merged.rows, registryApp: app };
}

module.exports = { slugify, discoverServers, mergeServerUrls, publishToRegistry, pickSlug, syncProjectServers };
