const { describe, test } = require("node:test");
const expect = require("./expect");
const { visitorId, summarize, recordVisit, dayKey } = require("../utils/registryVisits");

const req = (ip, ua) => ({ headers: { "x-forwarded-for": ip, "user-agent": ua }, ip });

describe("registry visitor tracker", () =>
{
    test("same caller gets the same id, different callers differ, no raw IP in the id", () =>
    {
        const a = visitorId(req("1.2.3.4", "Stashr/1"));
        expect(visitorId(req("1.2.3.4", "Stashr/1"))).toBe(a);
        expect(visitorId(req("1.2.3.5", "Stashr/1"))).not.toBe(a);
        expect(a.includes("1.2.3.4")).toBe(false);
    });

    test("summarize counts distinct visitors per window and per app", () =>
    {
        const now = new Date("2026-10-31T12:00:00Z");
        const rows = [
            { app: "stashr", day: "2026-10-31", visitor: "a", hits: 3, lastAt: "2026-10-31T10:00:00Z" },
            { app: "stashr", day: "2026-10-31", visitor: "b", hits: 1, lastAt: "2026-10-31T11:00:00Z" },
            { app: "stashr", day: "2026-10-28", visitor: "a", hits: 2, lastAt: "2026-10-28T10:00:00Z" },
            { app: "stashr", day: "2026-09-01", visitor: "c", hits: 1, lastAt: "2026-09-01T10:00:00Z" },
            { app: "dealradar", day: "2026-10-30", visitor: "a", hits: 1, lastAt: "2026-10-30T10:00:00Z" }
        ];
        const s = summarize(rows, now);
        expect(s.stashr.today).toBe(2);
        expect(s.stashr.last7).toBe(2);
        expect(s.stashr.last30).toBe(2);
        expect(s.stashr.total).toBe(3);
        expect(s.stashr.hits).toBe(7);
        expect(s.stashr.lastSeen).toBe("2026-10-31T11:00:00.000Z");
        expect(s.dealradar.total).toBe(1);
    });

    test("recordVisit upserts and never throws", async () =>
    {
        const calls = [];
        recordVisit({ updateOne: (f, u, o) => { calls.push({ f, u, o }); return Promise.resolve(); } }, "stashr", req("9.9.9.9", "x"));
        expect(calls).toHaveLength(1);
        expect(calls[0].f.app).toBe("stashr");
        expect(calls[0].f.day).toBe(dayKey());
        expect(calls[0].o.upsert).toBe(true);
        recordVisit({ updateOne: () => { throw new Error("db down"); } }, "stashr", req("9.9.9.9", "x"));
        recordVisit({ updateOne: () => Promise.reject(new Error("db down")) }, "stashr", req("9.9.9.9", "x"));
    });
});
