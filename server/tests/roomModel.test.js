const { describe, test } = require("node:test");
const expect = require("./expect");
const m = require("../utils/roomModel");

// A pretend house: each room has its own "fingerprint" of what the phone hears (dBm), plus a little noise on every scan.
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const noise = (s) => Math.round((rnd() - 0.5) * 2 * s);
const FP = {
    Bedroom: { r1: -45, n1: -60, n2: -85, n3: -90, b1: -50 },
    Kitchen: { r1: -60, n1: -80, n2: -55, n3: -88, b2: -48 },
    Hall: { r1: -52, n1: -72, n2: -75, n3: -62, b3: -55 }
};
const scanOf = (room, jitter = 3) => {
    const wifi = [], ble = [];
    for (const [k, base] of Object.entries(FP[room])) (k[0] === "b" ? ble : wifi).push({ b: k, r: Math.min(-30, base + noise(jitter)) });
    return { wifi, ble };
};
const T0 = Date.UTC(2026, 10, 5), DAY = 86400000;
const sampleOf = (room, i, at = T0) => ({ room, vec: m.vectorOf(scanOf(room)), at, session: `${room}-${Math.floor(i / 4)}` });   // 4 scans per tap
const train = (perRoom = 20, at = T0) => Object.keys(FP).flatMap((r) => Array.from({ length: perRoom }, (_, i) => sampleOf(r, i, at)));

describe("scans and distance", () => {
    test("ids are hashed per household and never readable; the strongest of a repeated id wins; junk is dropped", () => {
        const a = m.hashId("owner1", "AA:BB:CC:DD:EE:01"), b = m.hashId("owner1", "aa:bb:cc:dd:ee:01"), c = m.hashId("owner2", "aa:bb:cc:dd:ee:01");
        expect(a).toBe(b);
        expect(a).not.toBe(c);
        expect(a).toMatch(/^[0-9a-f]{12}$/);
        const v = m.vectorOf({ wifi: [{ b: "x", r: -70 }, { b: "x", r: -50 }, { b: "y", r: 5 }, { b: "", r: -40 }], ble: [{ b: "d", r: -80 }] });
        expect(v).toEqual({ "w:x": -50, "b:d": -80 });
    });
    test("the same scan is distance 0, a network heard in only one counts as -100 in the other, Bluetooth counts less", () => {
        const a = { "w:x": -50, "w:y": -60 };
        expect(m.distance(a, a)).toBe(0);
        expect(Math.abs(m.distance({ "w:x": -50 }, { "w:x": -50, "w:y": -60 }) - Math.sqrt((40 * 40) / 2)) < 1e-9).toBe(true);
        const wifiOnly = m.distance({ "w:x": -50 }, { "w:x": -60 }), withBle = m.distance({ "w:x": -50, "b:q": -50 }, { "w:x": -60, "b:q": -50 });
        expect(withBle < wifiOnly).toBe(true);
    });
});

describe("finding the room from ALL the samples", () => {
    const samples = train();
    test("a fresh scan from each room is recognised, with real confidence", () => {
        for (const room of Object.keys(FP)) {
            const g = m.classify(samples, m.vectorOf(scanOf(room)), T0);
            expect(g.room).toBe(room);
            expect(g.confidence > 0.6).toBe(true);
            expect(g.ranking[0].room).toBe(room);
        }
    });
    test("every sample takes part: a lone far-away sample of another room cannot overrule dozens that match", () => {
        const odd = [...samples, { room: "Kitchen", vec: m.vectorOf({ wifi: [{ b: "zz", r: -40 }] }), at: T0, session: "odd" }];
        expect(m.classify(odd, m.vectorOf(scanOf("Bedroom")), T0).room).toBe("Bedroom");
        // and the answer moves as more samples of the right room are added (nothing is cut off at a few nearest)
        const few = samples.filter((s) => s.room !== "Hall" || s.session === "Hall-0");
        const many = m.classify(samples, m.vectorOf(scanOf("Hall")), T0), fewer = m.classify(few, m.vectorOf(scanOf("Hall")), T0);
        expect(many.ranking.find((x) => x.room === "Hall").p >= fewer.ranking.find((x) => x.room === "Hall").p - 0.1).toBe(true);
    });
    test("a scan that looks like nothing known, or only one room trained, is 'not sure', never a wrong guess", () => {
        const alien = m.classify(samples, m.vectorOf({ wifi: [{ b: "q1", r: -40 }, { b: "q2", r: -45 }] }), T0);
        expect(alien.room).toBeNull();
        expect(alien.why).toMatch(/nothing here looks familiar/);
        expect(m.classify(samples.filter((s) => s.room === "Hall"), m.vectorOf(scanOf("Hall")), T0).room).toBeNull();
        expect(m.classify([], {}, T0).room).toBeNull();
    });
    test("old samples fade: a room remembered a year ago counts for little", () => {
        const stale = train(10, T0 - 365 * DAY), fresh = train(10, T0);
        const mixed = [...stale.filter((s) => s.room !== "Hall"), ...fresh.filter((s) => s.room === "Hall")];
        const g = m.classify(mixed, m.vectorOf(scanOf("Hall")), T0);
        expect(g.room).toBe("Hall");
    });
});

describe("honest accuracy", () => {
    test("hiding each tap and guessing it from the rest gives a high score on distinct rooms and shows the confusion", () => {
        const r = m.crossValidate(train(20), T0);
        expect(r.accuracy >= 85).toBe(true);
        expect(r.tested).toBe(60);
        expect(Object.keys(r.perRoom).sort()).toEqual(["Bedroom", "Hall", "Kitchen"]);
        expect(r.confusion.Bedroom.Bedroom >= 15).toBe(true);
        expect(r.thin).toEqual([]);
    });
    test("two rooms that sound the same are caught: low accuracy, a mix-up in the table, thin rooms flagged", () => {
        const same = (room, i) => ({ room, vec: m.vectorOf({ wifi: [{ b: "r1", r: -50 + noise(3) }, { b: "n1", r: -70 + noise(3) }] }), at: T0, session: `${room}-${Math.floor(i / 4)}` });
        const s = [...Array.from({ length: 20 }, (_, i) => same("A", i)), ...Array.from({ length: 20 }, (_, i) => same("B", i)), ...Array.from({ length: 3 }, (_, i) => sampleOf("Hall", i))];
        const r = m.crossValidate(s, T0);
        expect(r.thin).toEqual(["Hall"]);
        const mixups = (r.confusion.A.B || 0) + (r.confusion.B.A || 0) + (r.confusion.A["(not sure)"] || 0) + (r.confusion.B["(not sure)"] || 0);
        expect(mixups > 5).toBe(true);
    });
    test("fewer than two rooms cannot be tested", () => {
        expect(m.crossValidate(train(5).filter((s) => s.room === "Hall"), T0).tested).toBe(0);
    });
});

describe("smoothing: one scan never moves a person", () => {
    test("the first answer is taken, a different room needs two in a row, 'not sure' changes nothing", () => {
        let r = m.smooth(null, "Hall");
        expect(r.changed).toBe(true);
        r = m.smooth(r.state, "Kitchen");
        expect(r.changed).toBe(false); expect(r.state.room).toBe("Hall");
        r = m.smooth(r.state, "Hall");                      // back: the pending move is forgotten
        expect(r.state.pending).toBeNull();
        r = m.smooth(r.state, "Kitchen"); r = m.smooth(r.state, null); r = m.smooth(r.state, "Kitchen");
        expect(r.changed).toBe(false);                      // the "not sure" in between broke the streak
        r = m.smooth(r.state, "Kitchen");
        expect(r.changed).toBe(true); expect(r.state.room).toBe("Kitchen");
    });
});
