/**
 * Coordinates -> a readable address ("Sector 21, Gurugram"), for the 24 hour trail. Uses the OpenStreetMap Nominatim service, which is
 * free for light use on two conditions this file keeps: at most one request a second, and the same place is never asked twice (answers are
 * remembered; coordinates are rounded to about 11 m for that). Set GEOCODER_URL to use another Nominatim-compatible server.
 * Never throws: when nothing is found the answer is null and the page shows the coordinates.
 */
const BASE = () => String(process.env.GEOCODER_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
const SPACING_MS = 1100;
const CACHE_MAX = 3000, CACHE_MS = 30 * 24 * 3600 * 1000;

const cache = new Map();            // "28.6139,77.2090" -> { at, value }
let chain = Promise.resolve();      // requests go out one after another
let lastAt = 0;
let fetchImpl = (...a) => fetch(...a);
let nowImpl = () => Date.now();
let waitImpl = (ms) => new Promise((r) => setTimeout(r, ms));

const keyOf = (lat, lon) => `${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`;

/** A short address from Nominatim's parts: road, area, city (what a person says), not the whole postal line. */
function shorten(j) {
    const a = (j && j.address) || {};
    const road = a.road || a.pedestrian || a.footway || a.path || a.neighbourhood || "";
    const area = a.suburb || a.neighbourhood || a.quarter || a.village || a.hamlet || "";
    const city = a.city || a.town || a.city_district || a.county || a.state_district || "";
    const parts = [a.house_number && road ? `${a.house_number} ${road}` : road, area !== road ? area : "", city].filter(Boolean);
    const seen = new Set(), out = parts.filter((p) => (seen.has(p) ? false : seen.add(p)));
    if (out.length) return out.join(", ").slice(0, 140);
    return j && j.display_name ? String(j.display_name).split(",").slice(0, 3).join(",").trim().slice(0, 140) : "";
}

async function ask(lat, lon) {
    const wait = lastAt + SPACING_MS - nowImpl();
    if (wait > 0) await waitImpl(wait);
    lastAt = nowImpl();
    try {
        const res = await fetchImpl(`${BASE()}/reverse?format=jsonv2&addressdetails=1&zoom=18&accept-language=en&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`, {
            headers: { "User-Agent": "StashrHome/1.0 (personal family locator)", Accept: "application/json" },
            signal: AbortSignal.timeout(6000)
        });
        if (!res.ok) return null;
        const j = await res.json();
        return j && !j.error ? { address: shorten(j), full: String(j.display_name || "").slice(0, 240) } : null;
    } catch (e) { return null; }
}

/** -> { address, full } or null. Looks in the memory first; otherwise asks (one at a time, a second apart). */
function reverse(lat, lon) {
    lat = Number(lat); lon = Number(lon);
    if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return Promise.resolve(null);
    const key = keyOf(lat, lon), hit = cache.get(key);
    if (hit && nowImpl() - hit.at < CACHE_MS) return Promise.resolve(hit.value);
    const job = chain.then(async () => {
        const again = cache.get(key);                           // an earlier job in the line may have fetched it
        if (again && nowImpl() - again.at < CACHE_MS) return again.value;
        const value = await ask(lat, lon);
        if (value) { cache.set(key, { at: nowImpl(), value }); if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value); }
        return value;
    });
    chain = job.catch(() => {});
    return job;
}

/** Test hook. */
function _reset({ fetch: f, now, wait } = {}) { cache.clear(); chain = Promise.resolve(); lastAt = 0; fetchImpl = f || ((...a) => fetch(...a)); nowImpl = now || (() => Date.now()); waitImpl = wait || ((ms) => new Promise((r) => setTimeout(r, ms))); }

module.exports = { reverse, shorten, keyOf, _reset };
