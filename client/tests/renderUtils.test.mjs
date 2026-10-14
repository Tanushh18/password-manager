import test from "node:test";
import assert from "node:assert/strict";
import {
  serviceKind, normalizeServices, normalizeList, timeAgo, normalizeMetricPoints, sumMetricPoints,
  downsample, diagnoseLogText, openIncidents, summarizeFleet, serviceState, sortServices, paginate,
  filterServices, safeUrl, isErrorLog, rangeStart, initials
} from "../src/Pages/Render/renderUtils.js";

const svc = (id, extra = {}) => ({ id, accountId: "a1", accountName: "Prod", name: id, type: "web_service", ...extra });

test("serviceKind maps Render types", () => {
  assert.equal(serviceKind({ type: "static_site" }), "Static site");
  assert.equal(serviceKind({ type: "cron_job" }), "Cron job");
  assert.equal(serviceKind({ type: "private_service" }), "Private service");
  assert.equal(serviceKind({ type: "background_worker" }), "Background worker");
  assert.equal(serviceKind({ id: "dpg-1", type: "postgres" }), "PostgreSQL");
  assert.equal(serviceKind({ type: "web_service" }), "Web service");
  assert.equal(serviceKind(null), "Web service");
});

test("normalizeServices unwraps and attaches ownerId", () => {
  const out = normalizeServices([{ service: { id: "srv-1", owner: { id: "own-1" } } }, { id: "srv-2", ownerId: "x" }, {}]);
  assert.deepEqual(out.map((s) => [s.id, s.ownerId]), [["srv-1", "own-1"], ["srv-2", "x"]]);
  assert.deepEqual(normalizeServices(null), []);
});

test("normalizeList accepts arrays, keyed and data payloads", () => {
  assert.equal(normalizeList([{ deploy: { id: 1 } }], "deploy")[0].id, 1);
  assert.equal(normalizeList({ envVars: [{ envVar: { key: "A" } }] }, "envVar")[0].key, "A");
  assert.equal(normalizeList({ data: [{ id: 2 }] }, "deploy")[0].id, 2);
  assert.deepEqual(normalizeList(undefined, "deploy"), []);
});

test("timeAgo is robust to bad input", () => {
  const now = Date.parse("2026-01-02T00:00:00Z");
  assert.equal(timeAgo(null, now), "—");
  assert.equal(timeAgo("not a date", now), "—");
  assert.equal(timeAgo("2026-01-01T23:59:40Z", now), "just now");
  assert.equal(timeAgo("2026-01-01T23:30:00Z", now), "30m ago");
  assert.equal(timeAgo("2026-01-01T20:00:00Z", now), "4h ago");
  assert.equal(timeAgo("2025-12-30T00:00:00Z", now), "3d ago");
});

test("metric points are filtered, sorted and bounded", () => {
  const payload = { data: [{ values: [
    { timestamp: "2026-01-01T00:02:00Z", value: "3" },
    { timestamp: "2026-01-01T00:01:00Z", value: 1 },
    { timestamp: "bad", value: 5 },
    { timestamp: "2026-01-01T00:03:00Z", value: null }
  ] }] };
  assert.deepEqual(normalizeMetricPoints(payload).map((p) => Number(p.value)), [1, 3]);
  const big = Array.from({ length: 1000 }, (_, i) => ({ timestamp: new Date(i * 60000).toISOString(), value: i }));
  const thinned = normalizeMetricPoints({ data: [{ values: big }] });
  assert.ok(thinned.length <= 120);
  assert.equal(Number(thinned[thinned.length - 1].value), 999);
  assert.equal(downsample([1, 2, 3], 120).length, 3);
});

test("sumMetricPoints adds series that share a timestamp", () => {
  const payload = { data: [
    { values: [{ timestamp: "2026-01-01T00:00:00Z", value: 1, unit: "MB" }, { timestamp: "2026-01-01T00:01:00Z", value: 2 }] },
    { values: [{ timestamp: "2026-01-01T00:00:00Z", value: 4 }] }
  ] };
  const out = sumMetricPoints(payload);
  assert.deepEqual(out.map((p) => p.value), [5, 2]);
  assert.equal(out[0].unit, "MB");
});

test("diagnoseLogText finds signatures and has fallbacks", () => {
  assert.match(diagnoseLogText([{ message: "Error: connect ECONNREFUSED 127.0.0.1" }])[0], /Connection refused/);
  assert.match(diagnoseLogText([{ message: "JavaScript heap out of memory" }]).join(" "), /memory pressure/);
  assert.match(diagnoseLogText([]).join(" "), /Load application or build logs first/);
  assert.match(diagnoseLogText([{ message: "all good" }]).join(" "), /No common failure signature/);
  // A port like :4010 must not trip the 4xx/5xx heuristics.
  assert.match(diagnoseLogText([{ message: "listening on port 5050" }]).join(" "), /Server-side errors|No common/);
});

test("isErrorLog checks level and message", () => {
  assert.ok(isErrorLog({ level: "error", message: "x" }));
  assert.ok(isErrorLog({ message: "HTTP 503 upstream" }));
  assert.ok(!isErrorLog({ message: "started" }));
});

test("openIncidents keeps only the latest state per key", () => {
  const list = [
    { groupId: "g", serviceKey: "a:1", type: "cpu", state: "open", at: "2026-01-01T00:00:00Z" },
    { groupId: "g", serviceKey: "a:1", type: "cpu", state: "resolved", at: "2026-01-01T01:00:00Z" },
    { groupId: "g", serviceKey: "a:2", type: "health", state: "open", at: "2026-01-01T02:00:00Z" }
  ];
  assert.deepEqual(openIncidents(list).map((i) => i.serviceKey), ["a:2"]);
  assert.deepEqual(openIncidents(undefined), []);
});

test("summarizeFleet and serviceState prioritise suspended over incident", () => {
  const services = [svc("1"), svc("2"), svc("3", { suspended: "suspended" }), svc("4", { type: "postgres" })];
  const incidents = [
    { groupId: "g", serviceKey: "a1:2", type: "cpu", state: "open", at: "2026-01-01T00:00:00Z" },
    { groupId: "g", serviceKey: "a1:3", type: "cpu", state: "open", at: "2026-01-01T00:00:00Z" }
  ];
  const fleet = summarizeFleet(services, incidents);
  assert.equal(fleet.total, 4);
  assert.equal(fleet.active, 2);
  assert.equal(fleet.incident, 1);
  assert.equal(fleet.suspended, 1);
  assert.equal(fleet.kinds.PostgreSQL, 1);
  assert.equal(serviceState(services[2], fleet.incidentKeys), "suspended");
});

test("sortServices and paginate", () => {
  const rows = [svc("b"), svc("a"), svc("c", { suspended: "suspended" })];
  assert.deepEqual(sortServices(rows, "name").map((s) => s.id), ["a", "b", "c"]);
  assert.deepEqual(sortServices(rows, "name", "desc").map((s) => s.id), ["c", "b", "a"]);
  assert.equal(sortServices(rows, "status", "desc")[0].id, "c");
  const page = paginate(Array.from({ length: 25 }, (_, i) => i), 9, 10);
  assert.equal(page.page, 3);
  assert.equal(page.rows.length, 5);
  assert.equal(paginate([], 1, 10).pages, 1);
});

test("filterServices combines query, account, kind, favourites and suspended", () => {
  const rows = [
    svc("api", { branch: "main" }),
    svc("site", { type: "static_site", accountId: "a2", accountName: "Staging" }),
    svc("old", { suspended: "suspended" })
  ];
  assert.equal(filterServices(rows, { query: "MAIN" }).length, 1);
  assert.equal(filterServices(rows, { accountId: "a2" }).length, 1);
  assert.equal(filterServices(rows, { kind: "Static site" }).length, 1);
  assert.equal(filterServices(rows, { hideSuspended: true }).length, 2);
  assert.equal(filterServices(rows, { favoriteIds: ["a1:api"] }).length, 1);
});

test("safeUrl only allows http(s)", () => {
  assert.equal(safeUrl("https://dashboard.render.com/web/srv-1"), "https://dashboard.render.com/web/srv-1");
  assert.equal(safeUrl("javascript:alert(1)"), "https://dashboard.render.com");
  assert.equal(safeUrl(undefined, "https://x.test/"), "https://x.test/");
});

test("rangeStart and initials", () => {
  const now = Date.parse("2026-01-02T00:00:00Z");
  assert.equal(rangeStart("6h", now), "2026-01-01T18:00:00.000Z");
  assert.equal(rangeStart("bogus", now), "2026-01-01T23:00:00.000Z");
  assert.equal(initials("deal radar"), "DR");
  assert.equal(initials(""), "R");
});
