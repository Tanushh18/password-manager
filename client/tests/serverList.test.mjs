import { test } from "node:test";
import assert from "node:assert/strict";
import { addUrl, moveUrl, setPrimary, isDirty, describeChanges } from "../src/lib/serverList.js";

const A = "https://a.onrender.com";
const B = "https://b.onrender.com";
const C = "https://c.onrender.com";

test("addUrl accepts a valid https address and trims trailing slashes", () => {
  assert.deepEqual(addUrl([A], " https://b.onrender.com/ ").urls, [A, B]);
});

test("addUrl rejects empty, non-https, malformed and duplicate addresses without changing the list", () => {
  for (const bad of ["", "http://x.com", "https://", "HTTPS://A.onrender.com"]) {
    const res = addUrl([A], bad);
    assert.ok(res.error, bad);
    assert.deepEqual(res.urls, [A]);
  }
});

test("moveUrl swaps neighbours and ignores out-of-range moves", () => {
  assert.deepEqual(moveUrl([A, B, C], 2, -1), [A, C, B]);
  const same = [A, B];
  assert.equal(moveUrl(same, 0, -1), same);
  assert.equal(moveUrl(same, 1, 1), same);
});

test("setPrimary moves one URL first and keeps the rest in order", () => {
  assert.deepEqual(setPrimary([A, B, C], 2), [C, A, B]);
  const same = [A, B];
  assert.equal(setPrimary(same, 0), same);
});

test("several edits then discard: dirty tracks the saved list, discard restores it", () => {
  const saved = [A, B];
  let draft = setPrimary(moveUrl(addUrl(saved, C).urls, 2, -1), 1);
  assert.equal(isDirty(draft, saved), true);
  draft = saved;
  assert.equal(isDirty(draft, saved), false);
});

test("editing back to the saved order is not dirty", () => {
  const saved = [A, B];
  assert.equal(isDirty(moveUrl(moveUrl(saved, 0, 1), 0, 1), saved), false);
});

test("describeChanges summarises adds, removals, primary and order", () => {
  assert.equal(describeChanges([B, A, C], [A, B]), "1 added · primary changed");
  assert.equal(describeChanges([A], [A, B]), "1 removed");
  assert.equal(describeChanges([B, A], [A, B]), "primary changed");
  assert.equal(describeChanges([A, C, B], [A, B, C]), "order changed");
});
