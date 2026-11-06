// The Office card on the Automations page: how far the phone is, when it counts as "left", and when the phone should be looked at closely.
// No database: node --test tests/placeTrail.test.js
const { describe, test } = require("node:test");
const expect = require("./expect");
const t = require("../utils/placeTrail");

const office = { name: "Office", lat: 28.6139, lon: 77.2090, radius: 50, phone: "ph1", enabled: true, arriveFrom: "09:25", arriveTo: "09:55", leaveFrom: "18:30", leaveTo: "19:10" };
// a point this many metres due north of the office (1 degree of latitude is about 111,195 m)
const north = (m) => ({ lat: office.lat + m / 111195, lon: office.lon });

describe("distance and the 'left' rule", () => {
    test("distance in metres is right to within a metre or two", () => {
        expect(Math.abs(t.distanceM(north(100), office) - 100) < 1.5).toBe(true);
        expect(Math.abs(t.distanceM(north(1000), office) - 1000) < 5).toBe(true);
        expect(t.distanceM(office, office)).toBe(0);
    });
    test("outside the circle counts as left after a small margin: 100 m from a 50 m circle is left", () => {
        expect(t.outBeyond(office, 10)).toBe(70);                       // 50 m circle + the 20 m minimum margin
        expect(t.classify(40, office, 10)).toBe("in");
        expect(t.classify(50, office, 10)).toBe("in");                  // exactly on the edge is still inside
        expect(t.classify(65, office, 10)).toBe("between");             // just outside the circle, inside the margin
        expect(t.classify(71, office, 10)).toBe("out");
        expect(t.classify(100, office, 10)).toBe("out");                // the 100 m that did not send the message before
    });
    test("a poor fix widens the margin (up to 150 m) so a wobble is not a trip", () => {
        expect(t.outBeyond(office, 100)).toBe(150);
        expect(t.outBeyond(office, 5000)).toBe(200);
        expect(t.outBeyond(office, 0)).toBe(70);
        expect(t.classify(140, office, 100)).toBe("between");
    });
    test("leaving needs a second reading 90 seconds later, unless the phone is clearly far away", () => {
        const T = 1_000_000;
        const at = (m, seenAt, when) => t.leaveCheck({ dist: m, place: office, acc: 10, seenAt, at: when });
        expect(at(60, 0, T)).toEqual({ confirmed: false, seenAt: null });               // inside the margin: nothing to remember
        expect(at(100, 0, T)).toEqual({ confirmed: false, seenAt: T });                 // first reading outside: remembered, not yet "left"
        expect(at(105, T, T + 60000)).toEqual({ confirmed: false, seenAt: T });         // too soon after the first
        expect(at(110, T, T + 90000)).toEqual({ confirmed: true, seenAt: null });       // a second reading, still outside: left
        expect(at(95, T, T + 200000)).toEqual({ confirmed: true, seenAt: null });
        expect(at(300, 0, T)).toEqual({ confirmed: true, seenAt: null });               // 300 m: clearly gone (past the line + 150 m), no wait
        expect(at(60, T, T + 100000)).toEqual({ confirmed: false, seenAt: null });      // came back in the margin: forget the first sighting
    });
});

describe("when to look closely", () => {
    test("inside an arrive or leave window, widened by 15 minutes", () => {
        expect(t.watching(office, 9 * 60 + 10)).toBe(true);            // 09:10, 15 min before the arrive window
        expect(t.watching(office, 9 * 60 + 9)).toBe(false);
        expect(t.watching(office, 19 * 60 + 24)).toBe(true);           // the leave window ends 19:10, widened to 19:25 (exclusive)
        expect(t.watching(office, 19 * 60 + 25)).toBe(false);
        expect(t.watching(office, 13 * 60)).toBe(false);               // lunchtime: no need to check often
    });
    test("a place with no windows is always watched; a window across midnight works", () => {
        expect(t.watching({ ...office, arriveFrom: "", arriveTo: "", leaveFrom: "", leaveTo: "" }, 3 * 60)).toBe(true);
        expect(t.watching({ ...office, arriveFrom: "", arriveTo: "", leaveFrom: "23:30", leaveTo: "00:30" }, 15)).toBe(true);
    });
    test("near its own place the phone is asked often: every 3 minutes in the times, every 5 outside them (they are a reference)", () => {
        const at = (m) => ({ ...north(m), acc: 10 });
        expect(t.watchFor([office], "ph1", at(60), 18 * 60 + 40)).toMatchObject({ near: true, sec: 30 });      // leave window: every 30 s
        expect(t.watchFor([office], "ph1", at(1500), 18 * 60 + 40)).toMatchObject({ near: true, sec: 30 });   // 1.5 km away, still in the window
        expect(t.watchFor([office], "ph1", at(2300), 18 * 60 + 40).near).toBe(false);                         // beyond radius + 2 km
        expect(t.watchFor([office], "ph1", at(60), 9 * 60 + 21).sec).toBe(30);                                 // 4 minutes before the arrive window
        expect(t.watchFor([office], "ph1", at(60), 9 * 60 + 12).sec).toBe(180);                                // 13 minutes before: the 15-minute margin, every 3 minutes
        expect(t.watchFor([office], "ph1", at(450), 13 * 60).near).toBe(true);                                // 450 m = radius + 400 (lunchtime)
        expect(t.watchFor([office], "ph1", at(600), 13 * 60).near).toBe(false);                               // too far outside the window
        expect(t.watchFor([office], "ph1", at(60), 13 * 60)).toMatchObject({ near: true, sec: 300 });         // lunchtime: still watched, a little less often
        expect(t.watchFor([office], "other-phone", at(60), 18 * 60 + 40).near).toBe(false);
        expect(t.watchFor([{ ...office, enabled: false }], "ph1", at(60), 18 * 60 + 40).near).toBe(false);
        expect(t.watchFor([office], "ph1", null, 18 * 60 + 40).near).toBe(false);
    });
    test("a place set to 'only inside these times' is watched only inside them", () => {
        const strict = { ...office, strictWindow: true };
        expect(t.watchFor([strict], "ph1", { ...north(60), acc: 10 }, 13 * 60).near).toBe(false);
        expect(t.watchFor([strict], "ph1", { ...north(60), acc: 10 }, 18 * 60 + 40)).toMatchObject({ near: true, sec: 30 });
    });
    test("a phone at 20% battery or less (not charging) is not watched closely; a charging one is", () => {
        const at = { ...north(60), acc: 10 };
        expect(t.watchFor([office], "ph1", at, 18 * 60 + 40, { pct: 20, charging: false }).near).toBe(false);
        expect(t.watchFor([office], "ph1", at, 18 * 60 + 40, { pct: 12, charging: true }).sec).toBe(30);
        expect(t.watchFor([office], "ph1", at, 18 * 60 + 40, { pct: 55, charging: false }).sec).toBe(30);
    });
    test("a place without times is watched every 3 minutes near it", () => {
        const free = { ...office, arriveFrom: "", arriveTo: "", leaveFrom: "", leaveTo: "" };
        expect(t.watchFor([free], "ph1", { ...north(60), acc: 10 }, 13 * 60)).toMatchObject({ near: true, sec: 180 });
        expect(t.watchFor([free], "ph1", { ...north(1500), acc: 10 }, 13 * 60).near).toBe(false);
    });
});

describe("the 24 hour trail", () => {
    const fix = (min, m, extra = {}) => ({ at: Date.UTC(2026, 10, 3, 12, 0) + min * 60000, ...north(m), acc: 10, ...extra });
    test("fixes become distance points with a state, oldest first", () => {
        const pts = t.trailOf(office, [fix(10, 150), fix(0, 2), fix(5, 70)]);
        expect(pts.map((p) => p.state)).toEqual(["in", "between", "out"]);
        expect(pts.map((p) => p.distanceM).map((d) => Math.round(d / 10) * 10)).toEqual([0, 70, 150]);
        expect(pts[0].at < pts[1].at).toBe(true);
    });
    test("each point carries its coordinates and how far past the edge of the circle it is (negative inside), and the day is summed up", () => {
        const pts = t.trailOf(office, [fix(0, 20), fix(5, 130), fix(10, 70), fix(15, 20, { same: true })]);
        expect(pts[0].lat > 28.6139).toBe(true); expect(pts[0].lon).toBe(office.lon);
        expect(pts.map((p) => p.beyondM)).toEqual([-30, 80, 20, -30]);              // 20 m from the centre of a 50 m circle = 30 m inside
        const day = t.summarize(pts);
        expect(day.farthest).toMatchObject({ distanceM: 130, beyondM: 80 });
        expect(day.outsidePoints).toBe(2); expect(day.fixes).toBe(3);
        expect(day.lastInside).toBe(pts[3].at);
        expect(t.summarize([]).farthest).toBeNull();
    });
    test("a long trail is thinned but keeps the first, the last and every change of state", () => {
        const fixes = [];
        for (let i = 0; i < 1000; i++) fixes.push(fix(i, i < 500 ? 5 : 300));       // 500 minutes inside, then outside
        const pts = t.downsample(t.trailOf(office, fixes), 100);
        expect(pts.length <= 110).toBe(true);
        expect(pts[0].at).toBe(fixes[0].at); expect(pts[pts.length - 1].at).toBe(fixes[999].at);
        const i = pts.findIndex((p) => p.state === "out");
        expect(pts[i - 1].state).toBe("in");                                         // both sides of the crossing are there
        expect(t.downsample([{ state: "in" }], 100).length).toBe(1);
    });
});
