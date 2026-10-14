const { describe, test } = require("node:test");
const expect = require("./expect");
const { fetchAllPages } = require("../utils/renderPaging");
const { utilizationPercent, resourceChecks } = require("../utils/renderMetrics");
const { checkServiceDeletion, parseBulkTargets, mapWithConcurrency } = require("../utils/renderGuards");

const rows = (from, to) => Array.from({ length: to - from }, (_, i) => ({ service: { id: "srv-" + (from + i) }, cursor: "c" + (from + i) }));
const pagedRequest = (total, log = []) => async (path) =>
{
    log.push(path);
    const limit = Number(new URL("http://x" + path).searchParams.get("limit"));
    const cursor = new URL("http://x" + path).searchParams.get("cursor");
    const start = cursor ? Number(cursor.slice(1)) + 1 : 0;
    return rows(start, Math.min(total, start + limit));
};

describe("Render cursor pagination", () =>
{
    test("returns a single short page without a second request", async () =>
    {
        const log = [];
        const result = await fetchAllPages(pagedRequest(7, log), "/v1/services");
        expect(result.items).toHaveLength(7);
        expect(result.truncated).toBe(false);
        expect(log).toHaveLength(1);
        expect(log[0]).toBe("/v1/services?limit=100");
    });

    test("follows the cursor across pages and keeps order", async () =>
    {
        const log = [];
        const result = await fetchAllPages(pagedRequest(250, log), "/v1/services");
        expect(result.items).toHaveLength(250);
        expect(result.items[249].service.id).toBe("srv-249");
        expect(result.truncated).toBe(false);
        expect(log[1]).toContain("cursor=c99");
    });

    test("an exact multiple of the page size ends cleanly on an empty page", async () =>
    {
        const result = await fetchAllPages(pagedRequest(200), "/v1/services");
        expect(result.items).toHaveLength(200);
        expect(result.truncated).toBe(false);
    });

    test("uses & when the path already has a query string", async () =>
    {
        const log = [];
        await fetchAllPages(pagedRequest(1, log), "/v1/logs?type=app");
        expect(log[0]).toBe("/v1/logs?type=app&limit=100");
    });

    test("flags truncation when the page cap is reached", async () =>
    {
        const result = await fetchAllPages(pagedRequest(10000), "/v1/services", { limit: 100, maxPages: 3 });
        expect(result.items).toHaveLength(300);
        expect(result.truncated).toBe(true);
    });

    test("stops instead of looping if Render repeats a cursor or omits it", async () =>
    {
        const repeated = async () => rows(0, 100).map((row) => ({ ...row, cursor: "same" }));
        const first = await fetchAllPages(repeated, "/v1/services", { maxPages: 5 });
        expect(first.items).toHaveLength(200);
        expect(first.truncated).toBe(false);
        const missing = await fetchAllPages(async () => rows(0, 100).map(({ service }) => ({ service })), "/v1/services");
        expect(missing.items).toHaveLength(100);
    });

    test("treats a non-array payload as an empty page", async () =>
    {
        const result = await fetchAllPages(async () => ({ message: "nope" }), "/v1/services");
        expect(result.items).toHaveLength(0);
    });

    test("propagates upstream errors", async () =>
    {
        let failed = false;
        try { await fetchAllPages(async () => { throw new Error("boom"); }, "/v1/services"); } catch { failed = true; }
        expect(failed).toBe(true);
    });
});

describe("Render resource alerts", () =>
{
    const thresholds = { cpu: 85, memory: 90, latencyMs: 1500 };
    const metric = (current, limit, unit = "") => ({ current, unit, limit });
    const sample = (over = {}) => ({
        name: "api", suspended: false,
        metrics: {
            cpu: { current: 0.1 }, "cpu-limit": { current: 0.5 },
            memory: { current: 224686080 }, "memory-limit": { current: 536870912 },
            "http-latency": { current: 200 }, ...over
        }
    });

    test("utilisation is usage over limit, rounded to one decimal", () =>
    {
        expect(utilizationPercent(224686080, 536870912)).toBe(41.9);
        expect(utilizationPercent(0.34, 0.5)).toBe(68);
    });

    test("utilisation is null when a value is missing or invalid", () =>
    {
        expect(utilizationPercent(1, null)).toBeNull();
        expect(utilizationPercent(null, 1)).toBeNull();
        expect(utilizationPercent(1, 0)).toBeNull();
        expect(utilizationPercent("x", 1)).toBeNull();
    });

    test("regression: raw bytes below the limit do not open a memory incident", () =>
    {
        expect(resourceChecks(sample(), thresholds)).toHaveLength(0);
    });

    test("memory and cpu alert once usage crosses the threshold of the limit", () =>
    {
        const checks = resourceChecks(sample({ memory: { current: 500000000 }, cpu: { current: 0.45 } }), thresholds);
        expect(checks.map((c) => c.type).sort().join(",")).toBe("cpu,memory");
        expect(checks.find((c) => c.type === "memory").message).toContain("93.1%");
    });

    test("no alert when the limit metric is unavailable (never guess)", () =>
    {
        const result = sample({ "memory-limit": { current: null }, "cpu-limit": undefined, memory: { current: 9e12 } });
        expect(resourceChecks(result, thresholds)).toHaveLength(0);
    });

    test("latency alerts independently of limits", () =>
    {
        const checks = resourceChecks(sample({ "http-latency": { current: 2400, unit: "ms" } }), thresholds);
        expect(checks).toHaveLength(1);
        expect(checks[0].type).toBe("latency");
    });

    test("suspended services never alert", () =>
    {
        expect(resourceChecks({ ...sample({ memory: { current: 9e12 } }), suspended: true }, thresholds)).toHaveLength(0);
    });
});

describe("Render service deletion guard", () =>
{
    const suspended = { id: "srv-1", name: "old-api", suspended: "suspended" };

    test("allows a suspended service when the exact name is confirmed", () =>
    {
        expect(checkServiceDeletion(suspended, "old-api").ok).toBe(true);
    });

    test("refuses a service that is not suspended, even with the right name", () =>
    {
        const verdict = checkServiceDeletion({ ...suspended, suspended: "not_suspended" }, "old-api");
        expect(verdict.ok).toBe(false);
        expect(verdict.status).toBe(409);
    });

    test("refuses a missing or near-miss confirmation name", () =>
    {
        for (const typed of [undefined, null, "", "old-ap", "OLD-API", " old-api", 42])
        {
            const verdict = checkServiceDeletion(suspended, typed);
            expect(verdict.ok).toBe(false);
            expect(verdict.status).toBe(400);
        }
    });

    test("refuses when Render returned no service", () =>
    {
        expect(checkServiceDeletion(null, "x").status).toBe(404);
        expect(checkServiceDeletion({}, "x").status).toBe(404);
    });
});

describe("Render bulk deletion", () =>
{
    test("bulk mode needs no typed name but still requires suspension", () =>
    {
        const opts = { requireName: false };
        expect(checkServiceDeletion({ id: "s", name: "n", suspended: "suspended" }, undefined, opts).ok).toBe(true);
        const active = checkServiceDeletion({ id: "s", name: "n", suspended: "not_suspended" }, undefined, opts);
        expect(active.ok).toBe(false);
        expect(active.status).toBe(409);
    });

    test("parseBulkTargets validates, de-duplicates and caps the selection", () =>
    {
        const ok = parseBulkTargets({ services: [{ accountId: "a1", serviceId: "srv-1" }, { accountId: "a1", serviceId: "srv-1" }, { accountId: "a2", serviceId: "srv-2" }] });
        expect(ok.targets).toHaveLength(2);
        expect(parseBulkTargets({}).error).toMatch(/at least one/);
        expect(parseBulkTargets({ services: [] }).error).toMatch(/at least one/);
        expect(parseBulkTargets({ services: [{ accountId: "a", serviceId: "../x" }] }).error).toMatch(/Invalid/);
        expect(parseBulkTargets({ services: [{ accountId: "a" }] }).error).toMatch(/Invalid/);
        const many = Array.from({ length: 21 }, (_, i) => ({ accountId: "a", serviceId: "srv-" + i }));
        expect(parseBulkTargets({ services: many }).error).toMatch(/up to 20/);
    });

    test("mapWithConcurrency preserves order, bounds parallelism and isolates failures", async () =>
    {
        let active = 0, peak = 0;
        const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) =>
        {
            active += 1; peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 5));
            active -= 1;
            if (n === 4) throw new Error("boom");
            return { ok: true, n };
        });
        expect(peak <= 3).toBe(true);
        expect(results.map((r) => r.ok).join(",")).toBe("true,true,true,false,true,true,true,true");
        expect(results[3].error).toBe("boom");
        expect(results[7].n).toBe(8);
        expect(await mapWithConcurrency([], 4, async () => 1)).toHaveLength(0);
    });
});
