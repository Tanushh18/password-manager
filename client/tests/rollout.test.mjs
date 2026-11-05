import test from "node:test";
import assert from "node:assert/strict";
import { summary, cannotBePicked, payload } from "../src/lib/rollout.js";

const app = (mode, devices = [], extra = {}) => ({ key: "where", selectable: true, latest: { version: "1.7.0" }, rule: { mode, devices: [] }, devices, ...extra });
const dev = (id, offered, canIdentify = true) => ({ id, offered, canIdentify });

test("the summary says in plain words who is being offered the newest release", () => {
  assert.match(summary(app("hold")), /kisi ko offer nahi ho raha/);
  assert.match(summary(app("all", [dev("a", true), dev("b", true)])), /sab ko offer ho raha hai \(2 devices\)/);
  assert.match(summary(app("selected", [dev("a", true), dev("b", false)])), /sirf 1 device ko offer ho raha hai \(2 mein se\)/);
  assert.match(summary(app("all", [], { selectable: false })), /1\.7\.0: sab ko offer ho raha hai\.$/);
  assert.equal(summary({ latest: null, error: "No release found yet.", rule: {}, devices: [] }), "No release found yet.");
});

test("a device whose app is too old to say who it is is flagged when it is ticked", () => {
  const a = app("selected", [dev("a", true), dev("b", false, false), dev("c", false, null)]);
  assert.deepEqual(cannotBePicked(a, ["a", "b", "c"]).map((d) => d.id), ["b"]);       // unknown (null) is not flagged: it may be fine
  assert.deepEqual(cannotBePicked(a, ["a"]), []);
});

test("what is saved: devices only for 'selected', and the default for newer releases", () => {
  assert.deepEqual(payload("selected", new Set(["a", "b"]), true), { mode: "selected", devices: ["a", "b"], defaultMode: "hold" });
  assert.deepEqual(payload("all", new Set(["a"]), false), { mode: "all", defaultMode: "all" });
  assert.deepEqual(payload("hold", new Set(), true), { mode: "hold", defaultMode: "hold" });
});
