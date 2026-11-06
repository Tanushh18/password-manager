import { test } from "node:test";
import assert from "node:assert/strict";

// A tiny stand-in for the browser's localStorage.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { isPin, weakPin, readMpin, saveMpin, clearMpin } = await import("../src/lib/mpin.js");

test("only four digits are a PIN", () => {
  assert.ok(isPin("1805") && isPin("0007"));
  for (const bad of ["123", "12345", "abcd", "", "12 4", " 1805", null, undefined]) assert.ok(!isPin(bad));
});

test("easy ones are weak, ordinary ones are not", () => {
  for (const w of ["0000", "1111", "9999", "1234", "4321", "2345"]) assert.ok(weakPin(w), w);
  for (const ok of ["1805", "2580", "1357", "7391"]) assert.ok(!weakPin(ok), ok);
});

test("the device's secret is kept, read back and cleared", () => {
  assert.equal(readMpin(), null);
  const d = { deviceId: "a".repeat(24), deviceSecret: "b".repeat(48) };
  saveMpin(d);
  assert.deepEqual(readMpin(), d);
  clearMpin();
  assert.equal(readMpin(), null);
});

test("a damaged or foreign entry is ignored, not trusted", () => {
  for (const junk of ["not json", "{}", JSON.stringify({ deviceId: "short", deviceSecret: "x" }), JSON.stringify({ deviceId: "a".repeat(24) })]) {
    store.set("stashr_mpin", junk);
    assert.equal(readMpin(), null);
  }
});
