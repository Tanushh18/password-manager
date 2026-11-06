/*
 * The "live location" link: a secret address that shows where chosen family phones are right now, with no login. Pure helpers here (no
 * database), so they can be tested on their own (tests/liveShare.test.js). The routes are in router/homeShare.js.
 */
const crypto = require("crypto");
const { distanceM } = require("./placeTrail");

const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

/** A new secret for the link: 24 random bytes (192 bits), 32 URL-safe characters. Nobody can guess it. */
const newToken = () => crypto.randomBytes(24).toString("base64url");
const looksLikeToken = (t) => TOKEN_RE.test(String(t || ""));

/** "At Office", "At home", or "" for where a position is, from the owner's places and home circle. */
function whereText(settings, loc) {
    const at = { lat: Number(loc.lat), lon: Number(loc.lon) };
    for (const p of (settings && settings.places) || []) {
        if (p && Number.isFinite(p.lat) && distanceM(at, p) <= Number(p.radius)) return `At ${p.name}`;
    }
    const h = settings && settings.homeSpot;
    if (h && Number.isFinite(h.lat) && Number.isFinite(h.lon) && distanceM(at, h) <= Number(h.radius || 200)) return "At home";
    return "";
}

/**
 * What the public link may show for a phone: the name, the position, how accurate and how old it is, speed, battery and "At Office".
 * Never the device id, the token, the Wi-Fi, the IP, the health report or anything else.
 */
function personView(device, settings, now = Date.now()) {
    const loc = device && device.status && device.status.location;
    const name = String(device.person || device.name || "Phone").slice(0, 40);
    if (!loc || !Number.isFinite(Number(loc.lat)) || !Number.isFinite(Number(loc.lon))) return { name, hasPosition: false };
    const bat = device.status.battery;
    const pct = bat && typeof bat === "object" ? bat.pct : bat;
    return {
        name, hasPosition: true,
        lat: Number(loc.lat), lon: Number(loc.lon), acc: Math.round(Math.max(Number(loc.acc) || 0, 0)),
        at: Number(loc.at) || null, ageSec: Math.max(0, Math.round((now - Number(loc.at || now)) / 1000)),
        speedKmh: Number.isFinite(Number(loc.speed)) && Number(loc.speed) >= 0 ? Math.round(Number(loc.speed) * 3.6) : null,
        battery: Number.isFinite(Number(pct)) ? Math.round(Number(pct)) : null,
        where: whereText(settings, loc)
    };
}

const peopleView = (devices, settings, now = Date.now()) => devices.map((d) => personView(d, settings, now));

module.exports = { newToken, looksLikeToken, whereText, personView, peopleView };
