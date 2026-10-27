const { renderRequest } = require("./renderOps");
const { fetchAllPages } = require("./renderPaging");
const { mapWithConcurrency } = require("./renderGuards");

/*
 * Custom domains of Render services (api.example.com in front of name.onrender.com). Render lists them on their own
 * endpoint, so the service's own URL never shows them. Only verified, non-redirect domains are returned. Read-only.
 */
const TTL_MS = 10 * 60 * 1000;
const FAIL_TTL_MS = 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map(); // serviceId -> { at, ttl, names }

/** Verified, non-redirect domain names from a Render custom-domains listing. Pure. */
function verifiedDomains(items) {
    return (items || [])
        .map((item) => (item && item.customDomain) || item)
        .filter((d) => d && typeof d.name === "string" && String(d.verificationStatus || "").toLowerCase() === "verified" && !d.redirectForName)
        .map((d) => d.name.toLowerCase())
        .filter((name, i, all) => /^[a-z0-9.-]+$/.test(name) && all.indexOf(name) === i);
}

async function customDomains(apiKey, serviceId, { force = false, get = renderRequest } = {}) {
    const hit = cache.get(serviceId);
    if (hit && !force && Date.now() - hit.at < hit.ttl) return hit.names;
    let names = [];
    let ttl = TTL_MS;
    try {
        const listing = await fetchAllPages((path) => get(apiKey, path), "/v1/services/" + encodeURIComponent(serviceId) + "/custom-domains", { limit: 100, maxPages: 3 });
        names = verifiedDomains(listing.items);
    } catch (e) { ttl = FAIL_TTL_MS; }
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(serviceId, { at: Date.now(), ttl, names });
    return names;
}

/** serviceId -> [domain names] for the given Render services (those that can have domains). `accounts` is the Map from loadRenderServices. */
async function domainsForServices(services, accounts, opts = {}) {
    const out = new Map();
    const wanted = (services || []).filter((s) => s && s.id && ["web_service", "static_site"].includes(String(s.type || "")) && accounts && accounts.get(String(s.accountId)));
    await mapWithConcurrency(wanted, 4, async (s) => {
        const names = await customDomains(accounts.get(String(s.accountId)).apiKey, String(s.id), opts);
        if (names.length) out.set(String(s.id), names);
        return null;
    });
    return out;
}

module.exports = { verifiedDomains, customDomains, domainsForServices };
