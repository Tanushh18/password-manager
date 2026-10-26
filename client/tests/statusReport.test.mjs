import test from "node:test";
import assert from "node:assert/strict";
import { buildReport, reportText, reportCSV, probeServers } from "../src/lib/statusReport.js";

const now = Date.parse("2026-10-26T12:00:00Z");

test("groups rows into ok, failed and not checked", () => {
  const r = buildReport({
    now,
    api: [{ url: "https://a.example.com", ok: true, status: 200, ms: 120 }, { url: "https://b.example.com", ok: false, status: 404, error: "HTTP 404" }],
    pings: [{ name: "web", result: { ok: true, status: 200, ms: 90 } }, { name: "late", result: null }, { name: "noroute", result: { ok: false, status: 404, missingRoute: true } }],
    crons: [{ name: "nightly" }, { name: "old", suspended: "suspended" }],
    tick: { completedAt: "2026-10-26T11:55:00Z" },
  });
  assert.deepEqual(r.summary, { total: 8, ok: 4, failed: 3, unchecked: 1 });
  assert.ok(r.failed.some((x) => x.name === "noroute" && x.detail.includes("404")));
  assert.ok(r.failed.some((x) => x.name === "old" && x.detail === "Suspended"));
});

test("a scheduler that has not run for too long is a failure", () => {
  const r = buildReport({ now, tick: { completedAt: "2026-10-26T09:00:00Z" } });
  assert.equal(r.failed[0].name, "Scheduler tick");
  assert.match(r.failed[0].detail, /180 min/);
  assert.equal(buildReport({ now, tick: null }).unchecked.length, 1);
});

test("text and CSV exports list every row", () => {
  const r = buildReport({ now, pings: [{ name: "a,b", result: { ok: true, status: 200, ms: 5 } }], tick: undefined });
  assert.match(reportText(r, new Date(now)), /1 OK, 0 failed/);
  assert.match(reportCSV(r), /ok,Ping jobs,"a,b",200,5,/);
});

test("probeServers reports 200 as ok, other codes and errors as failed, and never throws", async () => {
  const fake = async (url) => {
    if (url.startsWith("https://up")) return { status: 200 };
    if (url.startsWith("https://gone")) return { status: 404 };
    throw new TypeError("network");
  };
  const out = await probeServers(["https://up.example.com/", "https://gone.example.com", "https://down.example.com"], fake, 1000);
  assert.deepEqual(out.map((o) => [o.ok, o.status]), [[true, 200], [false, 404], [false, 0]]);
  assert.equal(out[0].url, "https://up.example.com");
  assert.equal(out[2].error, "Unreachable");
});
