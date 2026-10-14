import test from "node:test";
import assert from "node:assert/strict";
import { formatAmount, forecastText, summarize } from "../src/Pages/Services/servicesUtils.js";

test("formatAmount scales bytes and formats money", () => {
  assert.equal(formatAmount(512 * 1024 * 1024, "bytes"), "512 MB");
  assert.equal(formatAmount(1536, "bytes"), "1.5 KB");
  assert.equal(formatAmount(null, "bytes"), "—");
  assert.equal(formatAmount(4.5, "USD"), "4.50 USD");
});

test("forecastText covers lasting, running out and reached", () => {
  assert.match(forecastText({ willLast: true, resetsInDays: 12 }), /last until the quota resets/);
  assert.match(forecastText({ willLast: false, daysLeft: 0.3 }), /about 7 h/);
  assert.match(forecastText({ willLast: false, daysLeft: 9 }), /about 9 days/);
  assert.equal(forecastText({ method: "reached" }), "Limit reached.");
});

test("summarize counts statuses and finds the soonest exhaustion", () => {
  const data = { projects: [{ name: "api", services: [{ state: "ok", reports: [{ metrics: [
    { label: "A", status: "warn", exhaustsAt: "2026-11-01T00:00:00Z" }, { label: "B", status: "critical", exhaustsAt: "2026-10-20T00:00:00Z" }, { label: "C", status: "ok" }] }] }] }] };
  const s = summarize(data);
  assert.deepEqual([s.tracked, s.warn, s.critical, s.soonest.label], [1, 1, 1, "B"]);
});

test("projectSummary picks the worst metric and counts errors", async () => {
  const { projectSummary } = await import("../src/Pages/Services/servicesUtils.js");
  const p = { services: [
    { label: "Mongo", state: "ok", reports: [{ metrics: [{ status: "ok", percent: 40, limit: 10 }, { status: "warn", percent: 85, limit: 10 }] }] },
    { label: "Brevo", state: "error", reports: [] }] };
  const s = projectSummary(p);
  assert.equal(s.status, "warn");
  assert.equal(s.worst.service, "Mongo");
  assert.equal(s.issues, 1);
  assert.equal(projectSummary({ services: [] }).status, "unknown");
});

test("accountRows splits headline metrics from detail figures", async () => {
  const { accountRows } = await import("../src/Pages/Services/servicesUtils.js");
  const rows = accountRows({ reports: [{ label: "acct", metrics: [{ key: "credits", limit: 25, used: 1 }, { key: "storage", used: 5 }, { key: "bal", kind: "balance", remaining: 3 }] }] });
  assert.deepEqual(rows[0].headline.map((m) => m.key), ["credits", "bal"]);
  assert.deepEqual(rows[0].details.map((m) => m.key), ["storage"]);
});
