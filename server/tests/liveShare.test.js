// The public live-location link: the secret, and exactly what it may show. No database: node --test tests/liveShare.test.js
const { describe, test } = require("node:test");
const expect = require("./expect");
const ls = require("../utils/liveShare");

const settings = { places: [{ name: "Office", lat: 28.6139, lon: 77.2090, radius: 50 }], homeSpot: { lat: 28.5, lon: 77.1, radius: 200 } };
const phone = (status, extra = {}) => ({ _id: "dev1", name: "Oppo A38", person: "Tanush", token: "SECRET", tokenHash: "H", lastSeen: new Date(), lan: [], status, ...extra });

describe("the secret", () => {
    test("a new secret is 32 URL-safe characters, never repeats, and a bad one is refused before any lookup", () => {
        const a = ls.newToken(), b = ls.newToken();
        expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
        expect(a === b).toBe(false);
        expect(ls.looksLikeToken(a)).toBe(true);
        for (const bad of ["", "short", "has space inside the token 0123456789012345", "../../etc/passwd", "a".repeat(100), null, undefined]) expect(ls.looksLikeToken(bad)).toBe(false);
    });
});

describe("what the link shows", () => {
    const now = 1_000_000_000_000;
    test("name, position, accuracy, age, speed, battery and where", () => {
        const v = ls.personView(phone({ location: { lat: 28.6139, lon: 77.2095, acc: 12.4, at: now - 20000, speed: 5 }, battery: 81 }), settings, now);
        expect(v).toEqual({ name: "Tanush", hasPosition: true, lat: 28.6139, lon: 77.2095, acc: 12, at: now - 20000, ageSec: 20, speedKmh: 18, battery: 81, where: "At Office" });
    });
    test("nothing else leaks: no device id, token, hash, Wi-Fi or health", () => {
        const v = ls.personView(phone({ location: { lat: 1, lon: 2, acc: 5, at: now }, battery: { pct: 50, charging: true }, wifi: true, ip: "192.168.1.9", health: { x: 1 } }), settings, now);
        const text = JSON.stringify(v);
        for (const secret of ["dev1", "SECRET", "tokenHash", "192.168", "health", "wifi", "charging"]) expect(text.includes(secret)).toBe(false);
        expect(v.battery).toBe(50);
    });
    test("a phone with no position yet says so, and 'At home' / empty work", () => {
        expect(ls.personView(phone({}), settings, now)).toEqual({ name: "Tanush", hasPosition: false });
        expect(ls.personView(phone({ location: { lat: 28.5, lon: 77.1, acc: 5, at: now } }), settings, now).where).toBe("At home");
        expect(ls.personView(phone({ location: { lat: 10, lon: 10, acc: 5, at: now } }), settings, now).where).toBe("");
        expect(ls.personView(phone({ location: { lat: 10, lon: 10, acc: 5, at: now, speed: -1 } }), settings, now).speedKmh).toBeNull();
    });
});
