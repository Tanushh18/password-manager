/*
 * Where a family phone is in relation to one of the owner's places (Office, School...): how far, inside or outside, and the last 24 hours as
 * a trail. Pure functions (no database, no network), so they can be tested on their own (tests/placeTrail.test.js).
 */
const EARTH_M = 6371000;
const rad = (x) => (x * Math.PI) / 180;

/** Metres between two { lat, lon } points. */
function distanceM(a, b) {
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * How far from the centre counts as "left": just outside the circle. A small margin keeps a GPS wobble from being a trip: at least 20 m,
 * and as much as the phone's own accuracy says (up to 150 m) when the fix is poor. With a good fix a 50 m circle counts as left from 70 m.
 * This is the rule geoTick uses.
 */
function outBeyond(place, acc) {
    return Number(place.radius) + Math.max(20, Math.min(Math.max(Number(acc) || 0, 0), 150));
}

/**
 * Leaving needs a second reading, so one bad fix cannot send "Leaving office". The first reading outside is remembered (seenAt); a reading
 * at least 90 seconds later that is still outside confirms it. A phone that is clearly far away (150 m past the line) needs no second look.
 * -> { confirmed, seenAt } : the new value to remember (null = forget).
 */
function leaveCheck({ dist, place, acc, seenAt, at }) {
    const line = outBeyond(place, acc);
    if (dist <= line) return { confirmed: false, seenAt: null };
    if (dist > line + 150) return { confirmed: true, seenAt: null };
    if (!seenAt) return { confirmed: false, seenAt: at };
    return at - seenAt >= 90000 ? { confirmed: true, seenAt: null } : { confirmed: false, seenAt };
}

/** "in" (inside the circle), "out" (clearly outside) or "between" (outside the circle but not far enough to count as left). */
function classify(dist, place, acc) {
    if (dist <= Number(place.radius)) return "in";
    return dist > outBeyond(place, acc) ? "out" : "between";
}

const minutesOf = (v) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || "")); if (!m) return null; const h = Number(m[1]), mi = Number(m[2]); return h < 24 && mi < 60 ? h * 60 + mi : null; };
const inside = (mins, from, to) => (from === to ? false : from < to ? mins >= from && mins < to : mins >= from || mins < to);
const wrap = (m) => ((m % 1440) + 1440) % 1440;

/**
 * Is it the time to look closely at this place? True inside its arrive or leave window, widened by `pad` minutes on each side; a place
 * with no windows is always watched.
 */
function watching(place, mins, pad = 15) {
    const windows = [[place.arriveFrom, place.arriveTo], [place.leaveFrom, place.leaveTo]]
        .map(([a, b]) => [minutesOf(a), minutesOf(b)]).filter(([a, b]) => a !== null && b !== null);
    if (!windows.length) return true;
    return windows.some(([a, b]) => inside(mins, wrap(a - pad), wrap(b + pad)));
}

/**
 * For the phone's answer: when it is within 400 m of one of its own enabled places it should check in often and take a real fix instead
 * of the "still on the same Wi-Fi" shortcut; otherwise a phone sitting at the office is looked at every 15 to 30 minutes and walking
 * 100 m away goes unnoticed. The times of a place are a reference: inside them (15 minutes either side) the phone is asked every
 * 3 minutes, outside them every 5, because a message goes whenever the phone crosses the circle. A place set to "only inside these times"
 * is watched only inside them.
 * -> { near, sec, place }
 */
/** A place with an arrive or leave time set: those are the minutes that must not be missed. */
function hasWindow(place) {
    return [[place.arriveFrom, place.arriveTo], [place.leaveFrom, place.leaveTo]].some(([a, b]) => minutesOf(a) !== null && minutesOf(b) !== null);
}

/**
 * Inside the time of a place that has one (5 minutes ahead of it, to the end of it) and within 2 km of the place, the phone is
 * asked every 30 seconds with a real fix, so the WhatsApp message goes the moment the circle is crossed. Near the place at other
 * times it is every 3 minutes (a place without times) or 5 minutes. A phone at 20% battery or less, not charging, is left alone.
 */
function watchFor(places, deviceId, loc, mins, batt) {
    if (!loc || !Number.isFinite(Number(loc.lat)) || !Number.isFinite(Number(loc.lon))) return { near: false };
    if (batt && Number.isFinite(Number(batt.pct)) && Number(batt.pct) <= 20 && batt.charging !== true) return { near: false };
    let best = { near: false };
    for (const p of places || []) {
        if (!p || p.enabled === false || String(p.phone) !== String(deviceId)) continue;
        const dist = distanceM({ lat: Number(loc.lat), lon: Number(loc.lon) }, p);
        const timed = hasWindow(p), inWindow = watching(p, mins), tight = timed && watching(p, mins, 5);
        if (dist > Number(p.radius) + (tight ? 2000 : 400)) continue;
        if (!inWindow && p.strictWindow === true) continue;
        const sec = tight ? 30 : inWindow ? 180 : 300;
        if (!best.near || sec < best.sec) best = { near: true, sec, place: p.name };
    }
    return best;
}

/**
 * Fixes ({ at, lat, lon, acc, same }) -> points for one place, oldest first:
 * { at, lat, lon, distanceM (from the centre), beyondM (past the edge of the circle: negative while inside), acc, state, same }.
 */
function trailOf(place, fixes) {
    return [...fixes].sort((a, b) => Number(a.at) - Number(b.at)).map((f) => {
        const d = distanceM({ lat: Number(f.lat), lon: Number(f.lon) }, place);
        return { at: Number(f.at), lat: Number(f.lat), lon: Number(f.lon), distanceM: Math.round(d), beyondM: Math.round(d - Number(place.radius)), acc: Math.round(Number(f.acc) || 0), state: classify(d, place, f.acc), same: Boolean(f.same) };
    });
}

/** The day in a few numbers: the farthest point, how many points were outside the circle, and when the phone was last inside. */
function summarize(points) {
    const real = points.filter((p) => !p.same);
    if (!points.length) return { points: 0, farthest: null, lastInside: null, outsidePoints: 0 };
    let farthest = points[0];
    for (const p of points) if (p.distanceM > farthest.distanceM) farthest = p;
    const inside = [...points].reverse().find((p) => p.state === "in");
    return { points: points.length, fixes: real.length, farthest: { distanceM: farthest.distanceM, beyondM: farthest.beyondM, at: farthest.at, lat: farthest.lat, lon: farthest.lon },
        lastInside: inside ? inside.at : null, outsidePoints: points.filter((p) => p.state !== "in").length };
}

/** At most `max` points: always the first, the last and both sides of every change of state; the rest evenly spread. */
function downsample(points, max = 240) {
    if (points.length <= max) return points;
    const keep = new Set([0, points.length - 1]);
    points.forEach((p, i) => { if (i > 0 && p.state !== points[i - 1].state) { keep.add(i); keep.add(i - 1); } });
    const room = Math.max(max - keep.size, 1);
    const step = Math.max(Math.ceil(points.length / room), 1);
    for (let i = 0; i < points.length; i += step) keep.add(i);
    return [...keep].sort((a, b) => a - b).slice(0, Math.max(max, keep.size > max ? keep.size : max)).map((i) => points[i]);
}

module.exports = { distanceM, outBeyond, leaveCheck, classify, watching, watchFor, trailOf, summarize, downsample, minutesOf };
