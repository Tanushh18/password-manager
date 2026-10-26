import test from "node:test";
import assert from "node:assert/strict";
import { visibleItems, sectionCounts, folderNames, securityStatus, inSection, SECTIONS } from "../src/lib/vaultView.js";

const items = [
  { id: "a", name: "GitHub", username: "me", url: "https://github.com", folder: "Work", favorite: true, updatedAt: "2026-01-01" },
  { id: "b", name: "Bank", type: "card", folder: "Finance", updatedAt: "2026-03-01" },
  { id: "c", name: "Diary", type: "note", notes: "secret garden", updatedAt: "2026-02-01" },
  { id: "d", name: "Passport", type: "identity", updatedAt: "2025-01-01" },
  { id: "e", name: "Amazon", username: "x", folder: "Work", updatedAt: "2026-04-01" },
];
const trash = [{ id: "t", name: "Old", deletedAt: "2026-01-01" }];
const info = { a: { score: 4, reused: false, breached: 0 }, e: { score: 1, reused: true, breached: 2, old: true } };

test("sections filter by type, favourite, folder and trash", () => {
  const ids = (section) => visibleItems({ items, trash, section, info }).map((i) => i.id);
  assert.deepEqual(ids(SECTIONS.logins).sort(), ["a", "e"]);
  assert.deepEqual(ids(SECTIONS.card), ["b"]);
  assert.deepEqual(ids(SECTIONS.note), ["c"]);
  assert.deepEqual(ids(SECTIONS.identity), ["d"]);
  assert.deepEqual(ids(SECTIONS.fav), ["a"]);
  assert.deepEqual(ids(SECTIONS.trash), ["t"]);
  assert.deepEqual(ids("Work"), ["a", "e"]); // favourite first
  assert.equal(ids(SECTIONS.all).length, 5);
  assert.equal(inSection({ type: "bogus" }, SECTIONS.logins), true);
});

test("search, health filter and sort", () => {
  assert.deepEqual(visibleItems({ items, search: "garden", info }).map((i) => i.id), ["c"]);
  assert.deepEqual(visibleItems({ items, search: "github.com", info }).map((i) => i.id), ["a"]);
  assert.deepEqual(visibleItems({ items, filter: "weak", info }).map((i) => i.id), ["e"]);
  assert.deepEqual(visibleItems({ items, filter: "strong", info }).map((i) => i.id), ["a"]);
  assert.deepEqual(visibleItems({ items, filter: "breached", info }).map((i) => i.id), ["e"]);
  assert.deepEqual(visibleItems({ items, sort: "az", info }).map((i) => i.name), ["Amazon", "Bank", "Diary", "GitHub", "Passport"]);
  assert.deepEqual(visibleItems({ items, sort: "recent", info }).map((i) => i.id), ["a", "e", "b", "c", "d"]);
});

test("counts, folders and status", () => {
  const c = sectionCounts(items, trash);
  assert.equal(c.__all, 5); assert.equal(c.__logins, 2); assert.equal(c.__card, 1); assert.equal(c.__fav, 1); assert.equal(c.__trash, 1);
  assert.deepEqual(c.folders, { Work: 2, Finance: 1 });
  assert.deepEqual(folderNames(items), ["Finance", "Work"]);
  assert.equal(securityStatus({ total: 0 }).tone, "idle");
  assert.equal(securityStatus({ total: 3, breached: 1, score: 90 }).tone, "danger");
  assert.equal(securityStatus({ total: 3, reused: 2, weak: 0, score: 80 }).tone, "warn");
  assert.equal(securityStatus({ total: 3, weak: 0, reused: 0, score: 95 }).tone, "ok");
});
