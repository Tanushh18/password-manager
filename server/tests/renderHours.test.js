const { describe, test } = require("node:test");
const expect = require("./expect");
const { FREE_HOURS_PER_MONTH, monthKey, addRunningMinutes, budgetStatus, shouldAlert, latestCount, minutesSince } = require("../utils/renderHours");

const at = (iso) => new Date(iso);

describe("addRunningMinutes", () =>
{
    test("one running instance for a minute adds one instance-minute to its service", () =>
    {
        const t = addRunningMinutes(null, { serviceId: "srv-1", count: 1, minutes: 1, now: at("2026-10-10T12:00:00Z") });
        expect(t.month).toBe("2026-10");
        expect(t.byService).toEqual({ "srv-1": 1 });
    });

    test("a new month starts from zero instead of adding to the old month", () =>
    {
        const old = { month: "2026-09", byService: { "srv-1": 9000 } };
        const t = addRunningMinutes(old, { serviceId: "srv-1", count: 1, minutes: 5, now: at("2026-10-01T00:02:00Z") });
        expect(t.month).toBe("2026-10");
        expect(t.byService).toEqual({ "srv-1": 5 });
    });

    test("zero or negative counts add nothing", () =>
    {
        const t = addRunningMinutes(null, { serviceId: "srv-1", count: 0, minutes: 5, now: at("2026-10-10T00:00:00Z") });
        expect(t.byService).toEqual({});
    });
});

describe("budgetStatus", () =>
{
    test("the month is in UTC, so the reset is the first of the month at 00:00 UTC", () =>
    {
        expect(monthKey(at("2026-10-31T23:59:59Z"))).toBe("2026-10");
        expect(monthKey(at("2026-11-01T00:00:00Z"))).toBe("2026-11");
    });

    test("750 hours is the free allowance and percent is computed from it", () =>
    {
        expect(FREE_HOURS_PER_MONTH).toBe(750);
        const totals = { month: "2026-10", byService: { "srv-1": 600 * 60 } };
        const s = budgetStatus(totals, { now: at("2026-10-15T00:00:00Z") });
        expect(s.usedHours).toBe(600);
        expect(s.remainingHours).toBe(150);
        expect(s.percent).toBe(80);
        expect(s.level).toBe("warn");
    });

    test("over 100% is 'over' and nothing remains", () =>
    {
        const totals = { month: "2026-10", byService: { "srv-1": 800 * 60 } };
        const s = budgetStatus(totals, { now: at("2026-10-28T00:00:00Z") });
        expect(s.level).toBe("over");
        expect(s.remainingHours).toBe(0);
    });

    test("the projection scales the usage so far to the whole month", () =>
    {
        // Half of October gone, 300 hours used: projected 600 for the month, under 750.
        const totals = { month: "2026-10", byService: { "srv-1": 300 * 60 } };
        const s = budgetStatus(totals, { now: at("2026-10-16T12:00:00Z") });
        expect(s.projectedHours > 590 && s.projectedHours < 610).toBe(true);
        expect(s.projectedOver).toBe(false);
    });

    test("a last-month total does not count in this month", () =>
    {
        const totals = { month: "2026-09", byService: { "srv-1": 900 * 60 } };
        const s = budgetStatus(totals, { now: at("2026-10-02T00:00:00Z") });
        expect(s.usedHours).toBe(0);
        expect(s.level).toBe("ok");
    });

    test("per-service hours are sorted largest first", () =>
    {
        const totals = { month: "2026-10", byService: { a: 60, b: 600, c: 120 } };
        const s = budgetStatus(totals, { now: at("2026-10-10T00:00:00Z") });
        expect(s.perService.map((x) => x.serviceId)).toEqual(["b", "c", "a"]);
    });

    test("runsOutAt is given only when the pace will reach the limit before month end", () =>
    {
        const totals = { month: "2026-10", byService: { "srv-1": 400 * 60 } };
        const s = budgetStatus(totals, { now: at("2026-10-16T00:00:00Z") });
        expect(s.runsOutAt).not.toBe(null);
        expect(new Date(s.runsOutAt).getTime() > Date.parse("2026-10-16T00:00:00Z")).toBe(true);
        const idle = budgetStatus({ month: "2026-10", byService: {} }, { now: at("2026-10-16T00:00:00Z") });
        expect(idle.runsOutAt).toBe(null);
    });
});

describe("shouldAlert", () =>
{
    test("alerts once when the level first gets worse, not on every check", () =>
    {
        const warn = { level: "warn" };
        expect(shouldAlert("ok", warn)).toBe(true);
        expect(shouldAlert("warn", warn)).toBe(false);
        expect(shouldAlert("warn", { level: "over" })).toBe(true);
        expect(shouldAlert("over", { level: "ok" })).toBe(false);
    });
});


describe("latestCount", () =>
{
    test("reads the newest instance count from a Render metrics payload", () =>
    {
        const payload = { data: [{ values: [{ timestamp: "2026-10-10T12:05:00Z", value: 1 }, { timestamp: "2026-10-10T12:10:00Z", value: 0 }] }] };
        expect(latestCount(payload)).toBe(0);
    });

    test("no points gives null, so nothing is counted", () =>
    {
        expect(latestCount({ data: [] })).toBe(null);
        expect(latestCount(null)).toBe(null);
    });
});

describe("minutesSince", () =>
{
    test("the first sample counts five minutes, and a long gap is capped at fifteen", () =>
    {
        expect(minutesSince(null, at("2026-10-10T12:00:00Z"))).toBe(5);
        expect(minutesSince("2026-10-10T00:00:00Z", at("2026-10-10T12:00:00Z"))).toBe(15);
        expect(minutesSince("2026-10-10T11:58:00Z", at("2026-10-10T12:00:00Z"))).toBe(2);
    });
});
