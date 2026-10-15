const { describe, test } = require("node:test");
const expect = require("./expect");
const R = require("../utils/healthRules");
const { incidentButtons } = require("../utils/renderOps");

const MIN = 60000;
const T0 = Date.parse("2026-10-15T12:00:00Z");
const at = (n) => new Date(T0 + n * 5 * MIN).toISOString();
const bad = (n, extra = {}) => ({ at: at(n), state: "unhealthy", verdict: "down", ...extra });
const good = (n) => ({ at: at(n), state: "healthy", verdict: "up" });
const res = (over = {}) => ({ health: { state: "healthy", status: 200 }, latestDeploy: { status: "live" }, metrics: {}, ...over });
const down = (cause = "no_response") => res({ health: { state: "timeout", cause } });

describe("verdict: one answer per service per round", () =>
{
    test("healthy is up; unhealthy / timeout is down", () =>
    {
        expect(R.verdictFor({ result: res() })).toBe("up");
        expect(R.verdictFor({ result: down() })).toBe("down");
        expect(R.verdictFor({ result: res({ health: { state: "unhealthy", cause: "app_error", status: 503 } }) })).toBe("down");
    });

    test("deleted, suspended and Render-API failures are never 'down'", () =>
    {
        expect(R.verdictFor({ result: res({ gone: true }) })).toBe("deleted");
        expect(R.verdictFor({ result: res({ suspended: true }) })).toBe("suspended");
        expect(R.verdictFor({ result: res({ error: "Could not retrieve service status from Render." }) })).toBe("unknown");
        expect(R.verdictFor({ result: res({ health: { state: "unknown" } }) })).toBe("unknown");
        expect(R.verdictFor({ result: res({ health: { state: "unsupported" } }) })).toBe("unknown");
    });

    test("a deploy in progress explains a failing probe", () =>
    {
        for (const status of ["build_in_progress", "update_in_progress", "created", "pre_deploy_in_progress"])
            expect(R.verdictFor({ result: { ...down(), latestDeploy: { status } } })).toBe("deploying");
        expect(R.verdictFor({ result: { ...res(), latestDeploy: { status: "build_in_progress" } } })).toBe("up");
    });

    test("when Stashr's own network is down nothing is declared down", () =>
    {
        expect(R.verdictFor({ result: down("no_response"), controlOk: false })).toBe("unknown");
        expect(R.verdictFor({ result: res({ health: { state: "unhealthy", cause: "app_error", status: 500 } }), controlOk: false })).toBe("down");
    });

    test("health checking switched off means unknown", () =>
    {
        expect(R.verdictFor({ result: res(), checkHealth: false })).toBe("unknown");
    });
});

describe("confirmation: failed once is a suspect, failed twice is an incident", () =>
{
    const act = (verdict, hasOpen, trend, manual = false, now = T0 + 6 * 5 * MIN) =>
        R.healthAction({ verdict, hasOpen, confirmed: manual || R.previousBad(trend, now) });

    test("first failure only suspects", () => expect(act("down", false, [good(0), good(1)])).toBe("suspect"));
    test("second consecutive failure opens", () => expect(act("down", false, [good(0), bad(1)], false, T0 + 2 * 5 * MIN)).toBe("open"));
    test("a manual check opens at once", () => expect(act("down", false, [good(0)], true)).toBe("open"));
    test("an old failure does not count as consecutive", () => expect(act("down", false, [bad(0)], false, T0 + 40 * 5 * MIN)).toBe("suspect"));
    test("a previous 'unknown' round does not confirm", () => expect(act("down", false, [bad(0, { verdict: "unknown" })], false, T0 + 5 * MIN)).toBe("suspect"));
    test("already open: nothing new", () => expect(act("down", true, [bad(0)], false, T0 + 5 * MIN)).toBe("none"));
    test("only a definite 'up' resolves", () =>
    {
        expect(act("up", true, [])).toBe("resolve");
        for (const v of ["unknown", "deploying", "suspended", "deleted", "suspect"]) expect(act(v, true, [])).toBe("none");
    });
    test("up with nothing open does nothing", () => expect(act("up", false, [])).toBe("none"));
});

describe("a full day of ticks: no false incidents, real ones open and close once", () =>
{
    // Runs the same decision the monitor makes, round by round.
    function simulate(rounds) {
        const trend = []; let open = false; const events = [];
        rounds.forEach((r, i) =>
        {
            const result = typeof r === "string" ? { up: res(), down: down(), suspended: res({ suspended: true }), unknown: res({ error: "x" }), deploying: { ...down(), latestDeploy: { status: "update_in_progress" } }, gone: res({ gone: true }) }[r] : r;
            const verdict = R.verdictFor({ result });
            const now = T0 + i * 5 * MIN;
            const action = R.healthAction({ verdict, hasOpen: open, confirmed: R.previousBad(trend, now) });
            if (action === "open") { open = true; events.push("open@" + i); }
            if (action === "resolve") { open = false; events.push("resolve@" + i); }
            trend.push({ at: new Date(now).toISOString(), state: result.health?.state, verdict: action === "suspect" ? "suspect" : verdict });
        });
        return events;
    }

    test("one blip, then healthy: no incident", () => expect(simulate(["up", "down", "up", "up"])).toEqual([]));
    test("a real outage: opens on the second failure, closes on the first success", () => expect(simulate(["up", "down", "down", "down", "up"])).toEqual(["open@2", "resolve@4"]));
    test("a deploy restart: no incident", () => expect(simulate(["up", "deploying", "deploying", "up"])).toEqual([]));
    test("Render API outage while an incident is open: stays open, not 'recovered'", () => expect(simulate(["down", "down", "unknown", "unknown", "down", "up"])).toEqual(["open@1", "resolve@5"]));
    test("suspended while open: not resolved by guesswork", () => expect(simulate(["down", "down", "suspended", "suspended"])).toEqual(["open@1"]));
    test("a service that never answers 'up' but is merely unknown never opens", () => expect(simulate(["unknown", "unknown", "unknown"])).toEqual([]));
    test("flapping alternates but each full outage is one incident", () => expect(simulate(["down", "down", "up", "down", "up", "down", "down", "up"])).toEqual(["open@1", "resolve@2", "open@6", "resolve@7"]));
});

describe("what may be resolved (canJudge)", () =>
{
    const metrics = { cpu: { current: 1 }, "cpu-limit": { current: 2 }, memory: { current: 1 }, "memory-limit": { current: 2 }, "http-latency": { current: 10 } };
    test("health only when the verdict is definite", () =>
    {
        expect(R.canJudge("health", { verdict: "up" })).toBe(true);
        expect(R.canJudge("health", { verdict: "unknown" })).toBe(false);
        expect(R.canJudge("health", { verdict: "suspended" })).toBe(false);
    });
    test("resource incidents need their metrics", () =>
    {
        expect(R.canJudge("cpu", { metrics })).toBe(true);
        expect(R.canJudge("cpu", { metrics: { ...metrics, "cpu-limit": { unavailable: true } } })).toBe(false);
        expect(R.canJudge("memory", { metrics: {} })).toBe(false);
        expect(R.canJudge("latency", { metrics })).toBe(true);
    });
    test("a Render API failure judges nothing; unavailable deploy status cannot close a deploy incident", () =>
    {
        expect(R.canJudge("cpu", { metrics, error: "x" })).toBe(false);
        expect(R.canJudge("deploy_failure", { latestDeploy: { status: "unavailable" } })).toBe(false);
        expect(R.canJudge("deploy_failure", { latestDeploy: { status: "live" } })).toBe(true);
    });
});

describe("causes are chosen from evidence and labelled", () =>
{
    const base = { type: "health", now: T0 + 60 * MIN };
    test("memory at the limit -> out of memory", () =>
    {
        const c = R.classify({ ...base, health: { cause: "no_response" }, load: { memoryPeakPct: 99.2 } });
        expect(c.cause).toBe("memory_exhausted");
        expect(c.labels).toContain("outage");
    });
    test("failing right after a deploy -> bad deploy", () =>
    {
        const c = R.classify({ ...base, health: { cause: "app_error" }, deploy: { at: at(0), status: "live" }, firstFailure: at(2) });
        expect(c.cause).toBe("bad_deploy");
    });
    test("plain 5xx -> app error; plain timeout on a free plan explains sleeping", () =>
    {
        expect(R.classify({ ...base, health: { cause: "app_error" } }).cause).toBe("app_error");
        const c = R.classify({ ...base, health: { cause: "no_response" }, plan: "free" });
        expect(c.cause).toBe("no_response");
        expect(c.labels).toContain("free-plan");
        expect(c.hints[0]).toMatch(/free instance/);
    });
    test("Render's no-server page -> not running on Render", () => expect(R.classify({ ...base, health: { cause: "render_no_server" } }).cause).toBe("render_no_server"));
    test("resource and deploy incidents are labelled by type", () =>
    {
        expect(R.classify({ type: "cpu" }).cause).toBe("cpu_saturated");
        expect(R.classify({ type: "memory" }).cause).toBe("memory_exhausted");
        expect(R.classify({ type: "latency" }).cause).toBe("high_latency");
        expect(R.classify({ type: "deploy_failure" }).cause).toBe("deploy_failed");
        expect(R.classify({ type: "deploy_failure" }).labels).toContain("deploy");
    });
    test("no evidence -> honest 'unclear', never a made-up reason", () => expect(R.classify({ ...base, health: {} }).cause).toBe("unclear"));
});

describe("messages and details", () =>
{
    test("a down message says what, how many times and the last healthy time", () =>
    {
        const m = R.describe({ type: "health", name: "api", health: { cause: "app_error", status: 503, path: "/health" }, cause: "app_error", consecutive: 2, lastHealthy: at(0) });
        expect(m).toContain("api is DOWN");
        expect(m).toContain("HTTP 503 on /health");
        expect(m).toContain("2 checks in a row");
        expect(m).toContain("Last healthy: 12:00 UTC");
    });
    test("load is reported as percent of the limit with the peak time", () =>
    {
        const l = R.loadOf({ cpu: { current: 0.9, peak: 0.95, peakAt: at(1) }, "cpu-limit": { current: 1 }, memory: { current: 400e6, peak: 480e6 }, "memory-limit": { current: 512e6 }, "http-latency": { current: 220, peak: 900 } });
        expect(l.cpuPct).toBe(90);
        expect(l.cpuPeakPct).toBe(95);
        expect(l.memoryPeakPct).toBe(93.8);
        expect(l.latencyMs).toBe(220);
        expect(l.peakAt).toBe(at(1));
    });
    test("resource alerts need two rounds over the threshold", () =>
    {
        const th = { cpu: 85, memory: 90, latencyMs: 1500 };
        expect(R.sustained([{ cpuPct: 91 }], "cpu", th)).toBe(true);
        expect(R.sustained([{ cpuPct: 40 }], "cpu", th)).toBe(false);
        expect(R.sustained([], "cpu", th)).toBe(false);
        expect(R.sustained([{ latencyMs: 2000 }], "latency", th)).toBe(true);
    });
    test("first failure start, last healthy and flaps", () =>
    {
        const trend = [good(0), good(1), bad(2), bad(3)];
        expect(R.firstFailureAt(trend, T0 + 4 * 5 * MIN, at(4))).toBe(at(2));
        expect(R.lastHealthyAt(trend)).toBe(at(1));
        expect(R.consecutiveBad(trend)).toBe(2);
        expect(R.flapCount([{ groupId: "g", serviceKey: "a:b", type: "health", state: "open", at: at(1) }], "g:a:b:health", T0 + 30 * MIN)).toBe(1);
    });
});

describe("telegram buttons", () =>
{
    const id = "123e4567-e89b-12d3-a456-426614174000";
    test("health incidents get Check, Restart and Resolve; budget only Check and Resolve", () =>
    {
        expect(incidentButtons({ id, type: "health" })[0].map((b) => b.text)).toEqual(["🔍 Check", "🔄 Restart", "✓ Resolve"]);
        expect(incidentButtons({ id, type: "budget" })[0].map((b) => b.text)).toEqual(["🔍 Check", "✓ Resolve"]);
    });
    test("callback data fits Telegram's 64-byte limit and matches the handler's pattern", () =>
    {
        for (const b of incidentButtons({ id, type: "health" })[0]) { expect(Buffer.byteLength(b.callback_data) <= 64).toBe(true); expect(/^i:[cxyrn]:[0-9a-f-]{36}$/.test(b.callback_data)).toBe(true); }
    });
});
