import test from "node:test";
import assert from "node:assert/strict";
import { robotMood, pickFighters, arenaCommentary, usageMood } from "../src/lib/robots.js";

test("robot mood follows what the server is doing", () => {
  assert.equal(robotMood({ name: "api", suspended: true }).mood, "sleeping");
  assert.equal(robotMood({ name: "api", verdict: "down" }).mood, "dead");
  assert.equal(robotMood({ name: "api", verdict: "down" }).hp, 0);
  assert.equal(robotMood({ name: "api", deployStatus: "build_in_progress", verdict: "up" }).mood, "transforming");
  const fire = robotMood({ name: "API Bot", verdict: "up", cpu: 92, memory: 40 });
  assert.equal(fire.mood, "fire");
  assert.match(fire.line, /API Bot/);
  assert.match(fire.line, /CPU 92%/);
  assert.equal(robotMood({ name: "api", verdict: "up", cpu: 65 }).mood, "sweaty");
  const chill = robotMood({ name: "api", health: "healthy", cpu: 10, memory: 20, latency: 120 });
  assert.equal(chill.mood, "chill");
  assert.ok(chill.hp > 70 && chill.hp <= 100);
  assert.equal(robotMood({ name: "api" }).mood, "confused");
});

test("arena picks loaded servers and names the most efficient winner", () => {
  const bots = [
    { name: "a", key: "a", stats: robotMood({ name: "a", verdict: "up", cpu: 20 }) },
    { name: "b", key: "b", stats: robotMood({ name: "b", verdict: "up", cpu: 90 }) },
    { name: "c", key: "c", stats: robotMood({ name: "c" }) },
    { name: "d", key: "d", stats: robotMood({ name: "d", verdict: "down" }) }
  ];
  assert.deepEqual(pickFighters(bots).map((b) => b.key), ["b", "a", "d"]);
  assert.match(arenaCommentary([bots[0], bots[1], bots[3]]), /^👑 a jeet gaya/);
  assert.match(arenaCommentary([bots[0], bots[1], bots[3]]), /d to ring mein hi gir gaya/);
});

test("service bots follow the closest limit", () => {
  assert.equal(usageMood({ name: "x", percent: 95 }).mood, "fire");
  assert.equal(usageMood({ name: "x", percent: 75 }).mood, "sweaty");
  assert.equal(usageMood({ name: "x", percent: 10 }).mood, "chill");
  assert.equal(usageMood({ name: "x", percent: null, errors: 2, tracked: 0 }).mood, "dead");
  assert.equal(usageMood({ name: "x", percent: null }).mood, "confused");
});
