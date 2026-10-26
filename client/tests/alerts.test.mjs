import test from "node:test";
import assert from "node:assert/strict";
import { openIncidents, newIncidents } from "../src/lib/alerts.js";

const ev = (id, state, at, extra = {}) => ({ id, groupId: "g", serviceKey: "s", type: "health", state, at, ...extra });

test("a later resolved event closes the incident", () => {
  assert.deepEqual(openIncidents([ev("1", "open", "2026-01-01T00:00:00Z"), ev("2", "resolved", "2026-01-01T01:00:00Z")]), []);
});

test("an incident that reopens is open again, newest first", () => {
  const open = openIncidents([
    ev("1", "open", "2026-01-01T00:00:00Z"), ev("2", "resolved", "2026-01-01T01:00:00Z"), ev("3", "open", "2026-01-01T02:00:00Z"),
    ev("4", "open", "2026-01-02T00:00:00Z", { serviceKey: "t" }),
  ]);
  assert.deepEqual(open.map((e) => e.id), ["4", "3"]);
});

test("newIncidents filters out ids already seen", () => {
  const open = [ev("a", "open", "2026-01-01T00:00:00Z"), ev("b", "open", "2026-01-01T00:00:00Z", { serviceKey: "x" })];
  assert.deepEqual(newIncidents(open, new Set(["a"])).map((e) => e.id), ["b"]);
});
