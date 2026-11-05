const { describe, test } = require("node:test");
const expect = require("./expect");
const habits = require("../utils/homeHabits");

// India time (UTC+5:30), no daylight saving: local minutes and date from a UTC timestamp.
const parts = (ms) => { const d = new Date(ms + 330 * 60000); return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), weekday: d.getUTCDay() }; };
const at = (date, hh, mm) => Date.parse(`${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+05:30`);
const now = at("2026-11-05", 12, 0);   // Thursday 5 Nov 2026, 12:00

// Papa leaves around 07:10 on weekdays 26 Oct (Mon) to 4 Nov (Wed), home around 18:30
const weekdays = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-11-02", "2026-11-03", "2026-11-04"];
const events = weekdays.flatMap((d, i) => [
    { person: "Papa", kind: "presence_away", at: at(d, 7, 5 + (i % 3) * 5) },
    { person: "Papa", kind: "presence_home", at: at(d, 18, 25 + (i % 3) * 5) }
]);

describe("habits learned from reached/left home events", () => {
    const h = habits.learn(events, parts, now);

    test("the usual time to leave and to get home, for weekdays", () => {
        expect(h.Papa.weekday.leave.at).toBe(7 * 60 + 10);
        expect(h.Papa.weekday.arrive.at >= 18 * 60 + 25).toBe(true);
        expect(h.Papa.weekday.leave.days).toBe(8);
        expect(h.Papa.weekend.leave).toBeUndefined();
    });

    test("fewer than 5 days is no habit; a person who rarely leaves has none either", () => {
        expect(habits.learn(events.slice(0, 6), parts, now).Papa.weekday.leave).toBeUndefined();
        const rare = [{ person: "Mom", kind: "presence_away", at: at("2026-10-26", 10, 0) }, ...weekdays.slice(1, 6).map((d) => ({ person: "Mom", kind: "presence_away", at: at(d, 10, 0) }))].slice(0, 5);
        expect(habits.learn(rare, parts, at("2026-11-11", 12, 0)).Mom.weekday.leave).toBeUndefined();   // 5 days out of 13 weekdays watched
    });

    test("late to leave: still home well after the usual time, said once per day", () => {
        const people = [{ person: "Papa", home: true }];
        const early = habits.lateNow(people, h, { date: "2026-11-05", minutes: 7 * 60 + 35, weekday: 4 }, {});
        expect(early).toHaveLength(0);                                 // only 25 minutes after: inside the grace
        const late = habits.lateNow(people, h, { date: "2026-11-05", minutes: 7 * 60 + 45, weekday: 4 }, {});
        expect(late).toHaveLength(1);
        expect(late[0].key).toBe("2026-11-05:Papa:leave");
        expect(habits.lateText(late[0])).toMatch(/Papa aaj late hain.*07:10/);
        expect(habits.lateNow(people, h, { date: "2026-11-05", minutes: 7 * 60 + 45, weekday: 4 }, { Papa: { left: true } })).toHaveLength(0);
        expect(habits.lateNow(people, h, { date: "2026-11-05", minutes: 12 * 60, weekday: 4 }, {})).toHaveLength(0);   // hours later it is a different day, not "late"
    });

    test("late to arrive: out, left today, past the usual time; nothing on a weekend", () => {
        const out = [{ person: "Papa", home: false }];
        const l = habits.lateNow(out, h, { date: "2026-11-05", minutes: 19 * 60 + 40, weekday: 4 }, { Papa: { left: true } });
        expect(l).toHaveLength(1);
        expect(habits.lateText(l[0])).toMatch(/abhi tak ghar nahi pahunche/);
        expect(habits.lateNow(out, h, { date: "2026-11-05", minutes: 19 * 60 + 40, weekday: 4 }, {})).toHaveLength(0);   // never left today: not "late home"
        expect(habits.lateNow(out, h, { date: "2026-11-07", minutes: 19 * 60 + 40, weekday: 6 }, { Papa: { left: true } })).toHaveLength(0);
    });

    test("the habit in words", () => {
        expect(habits.habitLine("Papa", h.Papa)).toMatch(/Mon–Fri: nikalte 07:10, wapas 18:/);
        expect(habits.habitLine("Mom", undefined)).toMatch(/koi pakki aadat nahi/);
    });
});
