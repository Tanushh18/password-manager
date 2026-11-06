/*
 * What can be worked out from a phone's location fixes (a fix every 1 to 30 minutes, so everything here is approximate):
 *  - stops: the phone stayed within ~150 m for 20 minutes or more
 *  - places: stops that repeat on 3 or more different days, near each other (a guess you can name: Office, School…)
 *  - trips: the movement between two stops, with distance, time, average and the highest speed SEEN IN A FIX
 *  - commute: the usual time someone leaves a place and how long the way home normally takes
 * Hard braking cannot be measured from fixes this far apart, so there is no such number.
 */
const R = 6371000;
const rad = (x) => (x * Math.PI) / 180;
function dist(a, b) {
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const STOP_RADIUS = 150, STOP_MIN_MS = 20 * 60 * 1000;

/** fixes: [{at (ms), lat, lon, speed?}] sorted by time -> stops [{from, to, lat, lon, n}] */
function stops(fixes) {
    const out = [];
    let i = 0;
    while (i < fixes.length) {
        let j = i, cx = fixes[i].lat, cy = fixes[i].lon, n = 1;
        while (j + 1 < fixes.length && dist({ lat: cx, lon: cy }, fixes[j + 1]) <= STOP_RADIUS) {
            j++; n++; cx += (fixes[j].lat - cx) / n; cy += (fixes[j].lon - cy) / n;
        }
        if (fixes[j].at - fixes[i].at >= STOP_MIN_MS) out.push({ from: fixes[i].at, to: fixes[j].at, lat: cx, lon: cy, n });
        i = j + 1;
    }
    return out;
}

/** Trips between consecutive stops (the fixes in between). */
function trips(fixes, stopList) {
    const out = [];
    for (let k = 0; k + 1 < stopList.length; k++) {
        const a = stopList[k], b = stopList[k + 1];
        const mid = fixes.filter((f) => f.at >= a.to && f.at <= b.from);
        const pts = [{ at: a.to, lat: a.lat, lon: a.lon }, ...mid, { at: b.from, lat: b.lat, lon: b.lon }];
        let m = 0, max = 0;
        for (let q = 1; q < pts.length; q++) m += dist(pts[q - 1], pts[q]);
        for (const f of mid) if (Number.isFinite(f.speed)) max = Math.max(max, f.speed * 3.6);
        const mins = (b.from - a.to) / 60000;
        if (m < 500 || mins < 3 || mins > 4 * 60) continue;
        out.push({ from: a.to, to: b.from, fromLat: a.lat, fromLon: a.lon, toLat: b.lat, toLon: b.lon, km: Math.round(m / 100) / 10, minutes: Math.round(mins), avgKmh: Math.round((m / 1000) / (mins / 60)), maxKmh: Math.round(max), samples: mid.length });
    }
    return out;
}

/** Stops from many days, merged when within 250 m; a candidate needs 3+ different days. */
function candidates(stopList, tz) {
    const day = (t) => new Date(t).toLocaleDateString("en-CA", { timeZone: tz });
    const hour = (t) => Number(new Date(t).toLocaleString("en-GB", { timeZone: tz, hour: "2-digit", hour12: false })) % 24;
    const groups = [];
    for (const s of stopList) {
        let g = groups.find((x) => dist(x, s) <= 250);
        if (!g) { g = { lat: s.lat, lon: s.lon, visits: 0, days: new Set(), hours: [], ms: 0 }; groups.push(g); }
        g.lat += (s.lat - g.lat) / (g.visits + 1); g.lon += (s.lon - g.lon) / (g.visits + 1);
        g.visits++; g.days.add(day(s.from)); g.hours.push(hour(s.from)); g.ms += s.to - s.from;
    }
    return groups.filter((g) => g.days.size >= 3).map((g) => {
        const midday = g.hours.filter((h) => h >= 8 && h <= 17).length / g.hours.length;
        return { lat: Math.round(g.lat * 1e5) / 1e5, lon: Math.round(g.lon * 1e5) / 1e5, visits: g.visits, days: g.days.size, avgHours: Math.round((g.ms / g.visits) / 360000) / 10,
            guess: midday > 0.6 ? "Daytime place: work or school?" : "Evening or night place: a relative, a gym or a market?" };
    }).sort((a, b) => b.days - a.days).slice(0, 8);
}

module.exports = { dist, median, stops, trips, candidates };
