import test from "node:test";
import assert from "node:assert/strict";
import { grassBlades, makeActor, nextDelay, floaters, CAST, modeFor } from "../src/lib/jungle.js";

const seq = () => { let n = 0; return () => ((n = (n + 0.2357) % 1)); };

test("grass covers the whole width with sensible blades", () => {
  const g = grassBlades(90, seq());
  assert.equal(g.length, 90);
  assert.ok(g.every((b) => b.x >= 0 && b.x <= 1000 && b.h >= 22 && b.h <= 58 && b.tone >= 0 && b.tone <= 2 && b.sway >= 0 && b.sway <= 3));
  assert.ok(g[g.length - 1].x > 950);
});

test("day and night have their own animals, and robots are in both", () => {
  for (const mode of ["day", "night"]) {
    assert.ok(CAST[mode].walkers.some((w) => w.robot || w.rider === "🤖"));
    assert.ok(CAST[mode].flyers.some((f) => f.robot));
  }
  assert.ok(CAST.night.flyers.some((f) => f.emoji === "🦇"));
  assert.ok(CAST.day.flyers.some((f) => f.emoji === "🦜"));
});

test("actors get a direction, a speed and (for flyers) a height", () => {
  const rng = seq();
  const f = makeActor("flyer", "night", rng);
  assert.ok(CAST.night.flyers.some((x) => x.emoji === f.emoji));
  assert.ok(f.top >= 12 && f.top <= 38 && f.seconds >= 12 && f.seconds <= 20);
  const w = makeActor("walker", "day", rng);
  assert.equal(w.top, null);
  assert.ok(w.seconds >= 24 && w.seconds <= 40);
  assert.ok(nextDelay("flyer", rng) >= 9000);
});

test("floaters stay on screen and the theme picks day or night", () => {
  assert.ok(floaters(8, seq()).every((f) => f.left >= 3 && f.left <= 97 && f.dy < 0));
  assert.equal(modeFor("light"), "day");
  assert.equal(modeFor("dark"), "night");
});
