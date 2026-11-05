const { describe, test } = require("node:test");
const expect = require("./expect");
const trail = require("../utils/homeTrail");

// Home is at 28.6139, 77.209. 0.001 degrees of latitude is about 111 m.
const settings = { homeSpot: { lat: 28.6139, lon: 77.209, radius: 200 }, spots: [{ name: "Office", lat: 28.65, lon: 77.209, radius: 150 }], places: [] };
const north = (m) => 28.6139 + m / 111195;
const MIN = 60_000, T0 = Date.UTC(2026, 10, 5, 3, 0);   // 08:30 in India
const pt = (min, m, acc = 20) => ({ at: T0 + min * MIN, lat: north(m), lon: 77.209, acc });

describe("the last 24 hours of one phone", () => {
    // home 08:30–09:00, drive to the office, office 09:30–10:30
    const points = [pt(0, 10), pt(10, 12), pt(20, 8), pt(30, 15), pt(40, 1500), pt(50, 3500), pt(60, 4500), pt(65, 4505), pt(80, 4502), pt(100, 4498), pt(120, 4503)];
    const now = T0 + 125 * MIN;

    test("stays and the way between are found and named", () => {
        const t = trail.timeline(points, { ...settings, spots: [{ name: "Office", lat: north(4500), lon: 77.209, radius: 150 }] }, now);
        expect(t.map((e) => e.type)).toEqual(["stay", "move", "stay"]);
        expect(t[0].name).toBe("Home");
        expect(t[0].minutes).toBe(30);
        expect(t[1].km >= 4).toBe(true);
        expect(t[2].name).toBe("Office");
        expect(t[2].here).toBe(true);
    });

    test("an unnamed stay gets a map link in the text, a named one does not", () => {
        const lines = trail.describe({ person: "Papa", count: points.length, km: 4.5, last: null, timeline: trail.timeline(points, settings, now) });
        expect(lines[0]).toMatch(/Papa — pichle 24 ghante/);
        expect(lines.some((l) => /Home \(30m\)/.test(l))).toBe(true);
        expect(lines.some((l) => /https:\/\/maps\.google\.com\/\?q=/.test(l))).toBe(true);
    });

    test("no points says so; distance ignores GPS wobble under 50 m", () => {
        expect(trail.describe({ person: "Papa", count: 0, timeline: [] })[0]).toMatch(/koi location nahi/);
        expect(trail.kmOf([pt(0, 0), pt(1, 20), pt(2, 5), pt(3, 30)])).toBe(0);
    });

    test("the page gets at most 400 points, first and last kept", () => {
        const many = Array.from({ length: 1500 }, (_, i) => pt(i, i));
        const thin = trail.thin(many, 400);
        expect(thin.length <= 401).toBe(true);
        expect(thin[0]).toBe(many[0]);
        expect(thin[thin.length - 1]).toBe(many[many.length - 1]);
    });
});
