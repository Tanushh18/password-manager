import test from "node:test";
import assert from "node:assert/strict";
import { checkpointRows, overallStatus, affectedItems, lastCheckedText, scoreBand } from "../src/lib/securityAudit.js";

const items = [{ id: "a", name: "Zeta" }, { id: "b", name: "Alpha" }, { id: "c", name: "Mid" }];
const health = {
  score: 50, total: 3, weak: 1, reused: 2, old: 0, breached: 0,
  info: { a: { score: 1, reused: true }, b: { score: 4, reused: true }, c: { score: 4 } },
};

test("affected items are names only, sorted", () => {
  assert.deepEqual(affectedItems(items, health, "reused"), [{ id: "b", name: "Alpha" }, { id: "a", name: "Zeta" }]);
  assert.deepEqual(affectedItems(items, health, "weak").map((i) => i.name), ["Zeta"]);
});

test("breach row is idle until a check ran", () => {
  const rows = checkpointRows(items, health, { twoFactorEnabled: true, recoveryCodesLeft: 8 });
  assert.equal(rows.find((r) => r.key === "breached").tone, "idle");
  const after = checkpointRows(items, { ...health, breached: 0 }, {}, { breachChecked: true });
  assert.equal(after.find((r) => r.key === "breached").tone, "ok");
});

test("all clear only when every row is ok", () => {
  const clean = { score: 100, total: 1, weak: 0, reused: 0, old: 0, breached: 0, info: {} };
  const p = { twoFactorEnabled: true, recoveryCodesLeft: 8 };
  assert.equal(overallStatus(checkpointRows([], clean, p, { breachChecked: true })).text, "All clear");
  assert.notEqual(overallStatus(checkpointRows([], clean, p)).text, "All clear");
  assert.equal(overallStatus(checkpointRows([], clean, {}, { breachChecked: true })).tone, "warn");
  assert.equal(overallStatus(checkpointRows(items, { ...health, breached: 1 }, p, { breachChecked: true })).tone, "danger");
});

test("empty vault and helpers", () => {
  const rows = checkpointRows([], { total: 0, info: {} }, {});
  assert.equal(rows.find((r) => r.key === "weak").tone, "idle");
  assert.equal(scoreBand(100, 0).tone, "idle");
  assert.equal(lastCheckedText(0).startsWith("No breach"), true);
  assert.equal(lastCheckedText(1000, 1000 + 3 * 86400000), "Last breach check: 3 days ago");
});
