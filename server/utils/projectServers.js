const User = require("../models/schema");
const { DEFAULTS, OFFABLE, SLUG, isAdminEmail } = require("./registryDefaults");
const { linkedServices } = require("./projectMerge");
const { domainsForServices } = require("./renderDomains");

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

/**
 * Servers this project runs on Render: its linked services that are not static sites (those are clients, not servers).
 * A service's verified custom domains (`domains`: serviceId -> names) come first, then its onrender.com address.
 */
function discoverServers(fields, services, domains = new Map()) {
    const byId = new Map((services || []).map((s) => [String(s.id), s]));
    const out = [];
    const seen = new Set();
    for (const link of linkedServices([fields])) {
        const live = byId.get(String(link.serviceId));
        const type = live ? String(live.type || "") : "";
        if (type === "static_site") continue;
        const url = (live && live.url) || link.url;
        const suspended = live ? live.suspended === true : Boolean(link.suspended);
        const name = link.name || (live && live.name) || "";
        for (const domain of (domains.get(String(link.serviceId)) || [])) {
            const d = "https://" + domain;
            if (!seen.has(d)) { seen.add(d); out.push({ origin: d, name, suspended, domain: true }); }
        }
        const o = origin(url);
        if (!o || !/^https:/.test(o) || seen.has(o)) continue;
        seen.add(o);
        out.push({ origin: o, name, suspended });
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
    // A per-project list may be published empty (everything switched off); the built-in apps always keep a server.
    if ((urls.length === 0 && DEFAULTS[name] && !OFFABLE.has(name)) || (!DEFAULTS[name] && !SLUG.test(name))) return false;
    try {
        const Registry = require("../models/registry");
        const doc = await Registry.findOne({ app: name }).lean();
        const admin = isAdminEmail(user && user.email);
        if (DEFAULTS[name] && !admin) return false;
        if (doc && doc.owner && String(doc.owner) !== String(user._id) && !admin) return false;
        const set = { urls, updatedAt: new Date(), updatedBy: user.email || "project-sync" };
        if (OFFABLE.has(name)) set.off = urls.length === 0;
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

/** The project as it is in the database right now (the copy a background pass holds may be seconds old). */
async function latestEntry(user, entry) {
    const doc = await User.findOne({ _id: user._id }, { projects: { $elemMatch: { _id: entry._id } } }).lean();
    return doc && Array.isArray(doc.projects) && doc.projects[0] ? doc.projects[0] : null;
}

/** Writes the project only if nobody changed it since `entry` was read. Returns false when it lost that race. */
async function saveFields(user, dataKey, entry, fields) {
    const next = { ...fields };
    STRIP.forEach((k) => delete next[k]);
    const sealed = User.sealEntry(dataKey, next);
    const result = await User.updateOne(
        { _id: user._id, projects: { $elemMatch: { _id: entry._id, updatedAt: entry.updatedAt } } },
        { $set: { "projects.$.enc": "udk", "projects.$.data": sealed, "projects.$.updatedAt": new Date() } }
    );
    return result.modifiedCount === 1;
}

/**
 * Brings one project's Server URLs in step with its Render servers and publishes them. Does nothing for a project that
 * has no registryApp (not published). `registryApp` here overrides the saved one (used when publishing is switched on).
 */
async function syncProjectServers(user, dataKey, staleEntry, services, { registryApp, accounts } = {}) {
    // Always work from the newest copy: a person may have saved a change while a background pass was running, and
    // writing back an older copy would undo it (and publish the older list).
    for (let attempt = 0; attempt < 3; attempt++) {
        const entry = await latestEntry(user, staleEntry);
        if (!entry) return { changed: false, published: false };
        const fields = User.publicEntry(entry, dataKey);
        if (fields.broken || fields.enc === "e2e") return { changed: false, published: false };
        const app = registryApp || fields.registryApp;
        if (!app) return { changed: false, published: false };
        const linked = new Set(linkedServices([fields]).map((l) => String(l.serviceId)));
        const domains = accounts ? await domainsForServices((services || []).filter((x) => linked.has(String(x.id))), accounts) : new Map();
        const found = discoverServers(fields, services, domains);
        const merged = mergeServerUrls(fields.serverUrls, found, fields.serverUrlsIgnored);
        const appChanged = app !== fields.registryApp;
        if ((merged.changed || appChanged) && !(await saveFields(user, dataKey, entry, { ...fields, serverUrls: merged.rows, registryApp: app }))) continue; // changed meanwhile: read again
        const published = (merged.rows.length || !DEFAULTS[app] || OFFABLE.has(app)) ? await publishToRegistry(app, merged.rows, user) : false;
        return { changed: merged.changed || appChanged, published, serverUrls: merged.rows, registryApp: app };
    }
    return { changed: false, published: false };
}

module.exports = { slugify, discoverServers, mergeServerUrls, publishToRegistry, pickSlug, syncProjectServers };
