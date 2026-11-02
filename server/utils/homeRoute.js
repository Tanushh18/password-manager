/*
 * Driving time and distance by road, for "Papa is 12 minutes away". Uses an OSRM server (OpenStreetMap routing):
 * the free public demo server by default, or your own through OSRM_URL. Only two coordinates are sent (the phone and
 * home), nothing else. The time is the usual driving time without live traffic. When the service does not answer in
 * time, callers fall back to the straight-line estimate. Switch it off per account (settings.eta.routing) or for the
 * whole server with HOME_ROUTING=off.
 */
const BASE = () => String(process.env.OSRM_URL || "https://router.project-osrm.org").replace(/\/+$/, "");
let override = null;                                  // tests
const use = (fn) => { override = fn; };

async function drivingRoute(from, to, { timeoutMs = 2500 } = {}) {
    if (process.env.HOME_ROUTING === "off" && !override) return null;
    const ok = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
    if (!ok(from) || !ok(to)) return null;
    try {
        if (override) return await override(from, to);
        const url = `${BASE()}/route/v1/driving/${from.lon.toFixed(5)},${from.lat.toFixed(5)};${to.lon.toFixed(5)},${to.lat.toFixed(5)}?overview=false&alternatives=false&steps=false`;
        const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Stashr-Home/1.0" }, signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) return null;
        const body = await res.json();
        const r = body && body.code === "Ok" && body.routes && body.routes[0];
        if (!r || !Number.isFinite(r.duration) || !Number.isFinite(r.distance)) return null;
        return { seconds: Math.round(r.duration), meters: Math.round(r.distance) };
    } catch (e) { return null; }
}

module.exports = { drivingRoute, use };
