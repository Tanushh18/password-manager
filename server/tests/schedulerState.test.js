const test = require("node:test");
const assert = require("node:assert/strict");
const { summarizeStep, overallStatus, publicRun } = require("../utils/schedulerState");

test("step summaries whitelist names and numeric counts only", () => {
  const step = summarizeStep("monitoring", 12.8, {
    usersChecked: 3, groupsChecked: 7, incidentsOpened: 1,
    error: false, apiKey: "never-store-this", details: "private"
  });
  assert.deepEqual(step, {
    name: "monitoring", status: "success", durationMs: 12,
    counts: { usersChecked: 3, groupsChecked: 7, incidentsOpened: 1 }
  });
  assert.equal(JSON.stringify(step).includes("never-store-this"), false);
});

test("partial results and thrown failures cannot be reported as success", () => {
  assert.equal(summarizeStep("pings", 1, { ran: 5, errors: 2 }).status, "partial");
  assert.equal(summarizeStep("usage", 1, null, true).status, "failed");
  assert.equal(summarizeStep("usage", 1, { error: true }).status, "failed");
  assert.equal(overallStatus([{ status: "success" }, { status: "partial" }]), "partial");
  assert.equal(overallStatus([{ status: "partial" }, { status: "failed" }]), "failed");
  assert.equal(overallStatus([{ status: "success" }]), "success");
});

test("public run output is bounded to safe step names, statuses and counters", () => {
  const result = publicRun({
    source: "unknown", status: "success", startedAt: "2026-10-16T00:00:00.000Z",
    completedAt: "2026-10-16T00:00:01.000Z", durationMs: 1000,
    steps: [{ name: "arbitrary", status: "weird", durationMs: -4, counts: { errors: 2, token: "secret" } }]
  });
  assert.equal(result.source, "internal");
  assert.equal(result.persisted, false);
  assert.equal(result.steps[0].name, "unknown");
  assert.equal(result.steps[0].status, "partial");
  assert.deepEqual(result.steps[0].counts, { errors: 2 });
  assert.equal(JSON.stringify(result).includes("secret"), false);
});
