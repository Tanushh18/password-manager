import test from "node:test";
import assert from "node:assert/strict";
import { fx, nextDelay, sparks, robotFlight, MIN_GAP_MS } from "../src/lib/fx.js";

test("emit reaches subscribers and unsubscribe stops it", () => {
  fx.reset();
  const seen = [];
  const off = fx.on((e) => seen.push(e));
  assert.equal(fx.emit("boom", { x: 5 }, 1000), true);
  off();
  fx.emit("land", {}, 5000);
  assert.deepEqual(seen, [{ type: "boom", x: 5 }]);
});

test("the same effect is throttled but different effects are not", () => {
  fx.reset();
  const seen = [];
  fx.on((e) => seen.push(e.type));
  fx.emit("boom", {}, 1000);
  assert.equal(fx.emit("boom", {}, 1000 + MIN_GAP_MS - 1), false);
  assert.equal(fx.emit("land", {}, 1000 + 5), true);
  assert.equal(fx.emit("boom", {}, 1000 + MIN_GAP_MS), true);
  assert.deepEqual(seen, ["boom", "land", "boom"]);
});

test("a throwing listener cannot break emit or other listeners", () => {
  fx.reset();
  let ok = false;
  fx.on(() => { throw new Error("bad"); });
  fx.on(() => { ok = true; });
  assert.doesNotThrow(() => fx.emit("robot", {}, 10000));
  assert.equal(ok, true);
});

test("helpers stay inside their ranges", () => {
  const rng = (() => { let n = 0; return () => ((n += 0.137) % 1); })();
  const p = sparks(18, rng);
  assert.equal(p.length, 18);
  assert.ok(p.every((s) => s.dist >= 46 && s.dist <= 120 && s.size >= 5 && s.size <= 12 && /^#/.test(s.color)));
  const d = nextDelay("plane", rng);
  assert.ok(d >= 50000 && d <= 95000);
  const f = robotFlight(rng);
  assert.ok(f.top >= 9 && f.top <= 46 && f.seconds >= 13 && f.seconds <= 22 && f.size >= 34 && f.size <= 52);
});
