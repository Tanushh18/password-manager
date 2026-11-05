/**
 * The last 24 hours of every family phone, in detail: every stored point (time, latitude, longitude, accuracy) and a readable day
 * made from them: where the person stayed (5 minutes or more), how long, and the way between. Built from the 24 hour trail that
 * `placeFixes` keeps for every phone running Stashr Location; the database deletes each point 24 hours after it was stored.
 * Shown only on the Stashr website and in the owner's own Telegram chat.
 */
const ins = require("./homeInsights");
const placeFixes = require("./placeFixes");

const STAY_RADIUS = 120, STAY_MIN_MS = 5 * 60 * 1000, STILL_HERE_MS = 25 * 60 * 1000;

/** "Home", a named spot, or one of the places (Office…) when the point is inside it; otherwise null. */
function placeName(point, settings = {}) {
    const hs = settings.homeSpot;
    if (hs && Number.isFinite(hs.lat) && ins.dist(point, hs) <= (hs.radius || 200) + 100) return "Home";
    for (const s of settings.spots || []) if (Number.isFinite(s.lat) && ins.dist(point, s) <= (s.radius || 150) + 100) return s.name;
    for (const p of settings.places || []) if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && ins.dist(point, p) <= (p.radius || 150) + 100) return p.name;
    return null;
}

/** Stays: the phone kept within STAY_RADIUS for STAY_MIN_MS or more. -> [{ from, to, lat, lon, n }] */
function stays(points) {
    const out = [];
    let i = 0;
    while (i < points.length) {
        let j = i, cx = points[i].lat, cy = points[i].lon, n = 1;
        while (j + 1 < points.length && ins.dist({ lat: cx, lon: cy }, points[j + 1]) <= STAY_RADIUS) { j++; n++; cx += (points[j].lat - cx) / n; cy += (points[j].lon - cy) / n; }
        if (points[j].at - points[i].at >= STAY_MIN_MS) out.push({ from: points[i].at, to: points[j].at, lat: cx, lon: cy, n });
        i = j + 1;
    }
    return out;
}

/** Distance covered, ignoring jumps smaller than 50 m (a phone standing still wobbles). */
function kmOf(points) {
    let m = 0;
    for (let q = 1; q < points.length; q++) { const d = ins.dist(points[q - 1], points[q]); if (d >= 50) m += d; }
    return Math.round(m / 100) / 10;
}

/** points (oldest first) -> readable day: [{ type: "stay", from, to, minutes, lat, lon, name, here }, { type: "move", from, to, minutes, km }] */
function timeline(points, settings, now = Date.now()) {
    const st = stays(points);
    const out = [];
    for (let k = 0; k < st.length; k++) {
        const s = st[k];
        out.push({ type: "stay", from: s.from, to: s.to, minutes: Math.round((s.to - s.from) / 60000), lat: Math.round(s.lat * 1e5) / 1e5, lon: Math.round(s.lon * 1e5) / 1e5, name: placeName(s, settings), here: k === st.length - 1 && now - s.to <= STILL_HERE_MS && points.length > 0 && now - points[points.length - 1].at <= STILL_HERE_MS });
        const next = st[k + 1];
        if (next) {
            const between = points.filter((p) => p.at >= s.to && p.at <= next.from);
            const km = kmOf([{ at: s.to, lat: s.lat, lon: s.lon }, ...between, { at: next.from, lat: next.lat, lon: next.lon }]);
            if (km >= 0.3) out.push({ type: "move", from: s.to, to: next.from, minutes: Math.max(1, Math.round((next.from - s.to) / 60000)), km });
        }
    }
    return out;
}

/** At most `max` points for the page, always keeping the first and the last. */
function thin(points, max = 400) {
    if (points.length <= max) return points;
    const step = points.length / max, out = [];
    for (let i = 0; i < max; i++) out.push(points[Math.floor(i * step)]);
    if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
    return out;
}

/** Everyone's last 24 hours. phones: HomeDevice docs of the family phones. */
async function dayTrail(owner, settings, phones, now = Date.now()) {
    const people = [];
    for (const p of phones) {
        const points = await placeFixes.last24h(owner, p._id, now);
        const last = points[points.length - 1] || null;
        people.push({
            person: p.person || p.name, phone: String(p._id), count: points.length,
            last: last ? { at: last.at, lat: last.lat, lon: last.lon, name: placeName(last, settings) } : null,
            km: kmOf(points), timeline: timeline(points, settings, now),
            points: thin(points).map((x) => ({ at: x.at, lat: Math.round(x.lat * 1e6) / 1e6, lon: Math.round(x.lon * 1e6) / 1e6, acc: Math.round(x.acc || 0) }))
        });
    }
    return people;
}

const mapLink = (lat, lon) => `https://maps.google.com/?q=${lat},${lon}`;

/** A person's day as text lines (Telegram and the assistant). */
function describe(t, tz = "Asia/Kolkata") {
    const clock = (ms) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz });
    const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`);
    if (!t.count) return [`${t.person}: pichle 24 ghante ka koi location nahi mila.`];
    const lines = [`${t.person} — pichle 24 ghante (${t.km} km)`];
    for (const e of t.timeline) {
        if (e.type === "stay") lines.push(`📍 ${clock(e.from)}–${e.here ? "abhi" : clock(e.to)} ${e.name || "ek jagah"} (${dur(e.minutes)}) ${e.name ? "" : mapLink(e.lat, e.lon)}`.trim());
        else lines.push(`   ↪ ${dur(e.minutes)} safar, ${e.km} km`);
    }
    if (!t.timeline.length && t.last) lines.push(`Ek hi jagah ke aas paas: ${t.last.name || mapLink(t.last.lat, t.last.lon)} (aakhri location ${clock(t.last.at)})`);
    return lines;
}

module.exports = { dayTrail, timeline, stays, placeName, describe, kmOf, thin, mapLink };
