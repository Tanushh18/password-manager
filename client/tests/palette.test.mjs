import test from "node:test";
import assert from "node:assert/strict";
import { buildEntries, rank } from "../src/lib/palette.js";

const items = [{ name: "GitHub", username: "me@x.com", url: "github.com" }, { name: "Gmail", username: "me@x.com" }];

test("signed-out users get no entries", () => {
  assert.deepEqual(buildEntries({ items, signedIn: false }), []);
});

test("admin-only pages need isAdmin, photos needs the feature", () => {
  const plain = buildEntries({ profile: { features: {} } }).map((e) => e.label);
  assert.ok(!plain.includes("Servers") && !plain.includes("Photo Cloud"));
  const admin = buildEntries({ profile: { isAdmin: true, features: { photos: true } } }).map((e) => e.label);
  assert.ok(admin.includes("Servers") && admin.includes("Photo Cloud"));
});

test("rank prefers label prefixes and requires every word", () => {
  const entries = buildEntries({ items, profile: {} });
  assert.equal(rank(entries, "git")[0].label, "GitHub");
  assert.deepEqual(rank(entries, "gmail zzz"), []);
  assert.ok(rank(entries, "").every((e) => e.kind === "Page"));
});
