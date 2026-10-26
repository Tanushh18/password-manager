import test from "node:test";
import assert from "node:assert/strict";
import { paceSeconds, laneState, cratesFor, memoryNote, lanesFromBots, demoLanes } from "../src/lib/robotFloor.js";

test("busier servers run faster, fire and angry robots run flat out", () => {
  assert.ok(paceSeconds(5, "chill") > paceSeconds(80, "sweaty"));
  assert.equal(paceSeconds(10, "fire"), 2.2);
  assert.equal(paceSeconds(null, "chill"), 7);
  assert.ok(paceSeconds(100, "sweaty") >= 2.2);
});

test("lane state follows the mood", () => {
  assert.deepEqual(["sleeping", "dead", "transforming", "fire", "chill"].map(laneState), ["sleeping", "down", "deploying", "burning", "running"]);
});

test("crates grow with CPU and are capped", () => {
  assert.deepEqual([null, 2, 20, 50, 80, 100].map(cratesFor), [0, 0, 1, 2, 3, 3]);
});

test("memory notes match the thresholds", () => {
  assert.equal(memoryNote(95).level, "full");
  assert.equal(memoryNote(80).level, "heavy");
  assert.equal(memoryNote(60).level, "ok");
  assert.equal(memoryNote(10).level, "light");
  assert.equal(memoryNote(null).level, "unknown");
});

test("lanesFromBots copies live numbers and flags incidents", () => {
  const bot = { key: "a:1", s: { name: "web" }, stats: { mood: "dizzy", face: "😵", title: "Chakkar", line: "x", hp: 30, load: 92 }, last: { cpu: 60, memory: 93, latency: 400, deploy: { status: "build_in_progress" } } };
  const [lane] = lanesFromBots([bot], new Set(["a:1"]));
  assert.equal(lane.incident, true);
  assert.equal(lane.deploy, "build in progress");
  assert.equal(lane.mem.level, "full");
  assert.equal(lane.crates, 2);
  assert.equal(lane.state, "running");
});

test("the demo fleet has a mix of moods", () => {
  const moods = new Set(demoLanes(0).map((l) => l.mood));
  assert.ok(moods.has("sleeping") && moods.has("dead"));
  assert.ok(moods.has("transforming"));
  assert.ok(moods.size >= 4);
});
