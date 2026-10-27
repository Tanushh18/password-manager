const { DEFAULTS } = require("./registryDefaults");

/*
 * When a Render server moves to another account its address changes. This keeps the project's own Server URLs
 * (project.serverUrls) and, through them, the public registry the apps read in step with the new address.
 */
const origin = (value) => { try { return new URL(String(value || "")).origin.toLowerCase(); } catch (e) { return ""; } };
const trimUrl = (value) => String(value || "").trim().replace(/\/+$/, "");

/** Replaces every URL on the old host with the new host, keeping its path (e.g. /api) and its on/off switch. */
function swapServerUrl(serverUrls, oldUrl, newUrl) {
    const from = origin(oldUrl);
    const to = origin(newUrl);
    if (!from || !to || from === to || !Array.isArray(serverUrls)) return { list: serverUrls, changed: false };
    let changed = false;
    const seen = new Set();
    const list = [];
    for (const row of serverUrls)
    {
        let url = trimUrl(row && row.url);
        if (origin(url) === from) { url = to + new URL(url).pathname.replace(/\/+$/, ""); changed = true; }
        if (seen.has(url)) continue;
        seen.add(url);
        list.push({ url, enabled: !row || row.enabled !== false });
    }
    return { list, changed };
}

/** Publishes the switched-on URLs for the app the project feeds. Never throws: the move must not fail over this. */
async function publishToRegistry(app, serverUrls, by) {
    const name = String(app || "").toLowerCase();
    const urls = (serverUrls || []).filter((r) => r.enabled !== false).map((r) => r.url);
    if (!DEFAULTS[name] || urls.length === 0) return false;
    try
    {
        const Registry = require("../models/registry");
        await Registry.findOneAndUpdate({ app: name }, { urls, updatedAt: new Date(), updatedBy: by || "move-server" }, { upsert: true, setDefaultsOnInsert: true });
        return true;
    }
    catch (e) { return false; }
}

module.exports = { swapServerUrl, publishToRegistry };
