import test from "node:test";
import assert from "node:assert/strict";
import { greeting, attentionItems, recentItems, favoriteItems, projectSummary, ago } from "../src/lib/dashboard.js";

test("greeting follows the time of day", () => {
  assert.equal(greeting(9), "Good morning");
  assert.equal(greeting(14), "Good afternoon");
  assert.equal(greeting(21), "Good evening");
  assert.equal(greeting(2), "Good evening");
});

test("attention list is ordered by severity and links to a fix", () => {
  const list = attentionItems({ total: 9, breached: 1, weak: 2, reused: 3, old: 1 }, { breachChecked: true });
  assert.deepEqual(list.map((i) => i.id), ["breached", "weak", "reused", "old"]);
  assert.ok(list.every((i) => i.to.startsWith("/")));
  assert.equal(list[1].title, "2 weak passwords");
});

test("an empty or healthy vault has nothing to fix", () => {
  assert.deepEqual(attentionItems({ total: 0 }), []);
  assert.deepEqual(attentionItems({ total: 4 }, { breachChecked: true }), []);
  assert.deepEqual(attentionItems({ total: 4 }).map((i) => i.id), ["check"]);
});

test("recent and favourite lists", () => {
  const items = [
    { id: 1, name: "b", favorite: true, updatedAt: "2026-01-01" },
    { id: 2, name: "a", favorite: true, updatedAt: "2026-03-01" },
    { id: 3, name: "c", updatedAt: "2026-02-01" },
  ];
  assert.deepEqual(recentItems(items, 2).map((i) => i.id), [2, 3]);
  assert.deepEqual(favoriteItems(items).map((i) => i.id), [2, 1]);
});

test("project summary ignores archived projects in the recent list", () => {
  const s = projectSummary([{ status: "deployed", updatedAt: "2026-01-02" }, { status: "archived", updatedAt: "2026-05-01" }, { status: "broken", updatedAt: "2026-01-01" }]);
  assert.equal(s.total, 3);
  assert.equal(s.active, 2);
  assert.equal(s.deployed, 1);
  assert.equal(s.broken, 1);
  assert.ok(s.recent.every((p) => p.status !== "archived"));
});

test("ago is short and never negative", () => {
  const now = Date.parse("2026-10-30T12:00:00Z");
  assert.equal(ago("2026-10-30T11:59:30Z", now), "just now");
  assert.equal(ago("2026-10-30T11:00:00Z", now), "1h ago");
  assert.equal(ago("2026-10-31T12:00:00Z", now), "just now");
  assert.equal(ago(null, now), "");
});
