/*
 * Driving time and distance by road, for "Papa is 12 minutes away".
 *  1. With MAPBOX_TOKEN set (a public token, pk.…, that may use the Directions API) the time is Mapbox's
 *     "driving-traffic" time for right now: it includes live traffic.
 *  2. Otherwise, or when Mapbox does not answer, an OSRM server (OpenStreetMap routing): the free public demo
 *     server by default, or your own through OSRM_URL. No traffic. Only two coordinates are sent (the phone and
 * home), nothing else. The time is the usual driving time without live traffic. When the service does not answer in
 * time, callers fall back to the straight-line estimate. Switch it off per account (settings.eta.routing) or for the
 * whole server with HOME_ROUTING=off.
 */
const BASE = () => String(process.env.OSRM_URL || "https://router.project-osrm.org").replace(/\/+$/, "");
let override = null;                                  // tests
const use = (fn) => { override = fn; };

/** GeoJSON LineString -> [[lat, lon], ...] with at most 60 points. */
function line(r) {
    const c = r && r.geometry && Array.isArray(r.geometry.coordinates) ? r.geometry.coordinates : [];
    const step = Math.max(1, Math.ceil(c.length / 60));
    const out = c.filter((_, i) => i % step === 0 || i === c.length - 1).map((p) => [Math.round(p[1] * 1e5) / 1e5, Math.round(p[0] * 1e5) / 1e5]);
    return out.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

async function mapbox(from, to, timeoutMs, geometry) {
    const token = String(process.env.MAPBOX_TOKEN || "").trim();
    if (!/^pk\.[A-Za-z0-9._-]{20,}$/.test(token)) return null;
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${from.lon.toFixed(5)},${from.lat.toFixed(5)};${to.lon.toFixed(5)},${to.lat.toFixed(5)}?overview=${geometry ? "simplified&geometries=geojson" : "false"}&alternatives=false&steps=false&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Stashr-Home/1.0" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const body = await res.json();
    const r = body && body.code === "Ok" && body.routes && body.routes[0];
    if (!r || !Number.isFinite(r.duration) || !Number.isFinite(r.distance)) return null;
    return { seconds: Math.round(r.duration), meters: Math.round(r.distance), traffic: true, ...(geometry ? { line: line(r) } : {}) };
}

async function drivingRoute(from, to, { timeoutMs = 2500, geometry = false } = {}) {
    if (process.env.HOME_ROUTING === "off" && !override) return null;
    const ok = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
    if (!ok(from) || !ok(to)) return null;
    try {
        if (override) return await override(from, to, { geometry });
        try { const m = await mapbox(from, to, timeoutMs, geometry); if (m) return m; } catch (e) { /* fall back to OSRM */ }
        const url = `${BASE()}/route/v1/driving/${from.lon.toFixed(5)},${from.lat.toFixed(5)};${to.lon.toFixed(5)},${to.lat.toFixed(5)}?overview=${geometry ? "simplified&geometries=geojson" : "false"}&alternatives=false&steps=false`;
        const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Stashr-Home/1.0" }, signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) return null;
        const body = await res.json();
        const r = body && body.code === "Ok" && body.routes && body.routes[0];
        if (!r || !Number.isFinite(r.duration) || !Number.isFinite(r.distance)) return null;
        return { seconds: Math.round(r.duration), meters: Math.round(r.distance), ...(geometry ? { line: line(r) } : {}) };
    } catch (e) { return null; }
}

module.exports = { drivingRoute, use, hasTraffic: () => /^pk\./.test(String(process.env.MAPBOX_TOKEN || "").trim()) };
