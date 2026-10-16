import test from "node:test";
import assert from "node:assert/strict";
import { robotMood, usageMood } from "../src/lib/robots.js";

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

test("service bots follow the closest limit", () => {
  assert.equal(usageMood({ name: "x", percent: 95 }).mood, "fire");
  assert.equal(usageMood({ name: "x", percent: 75 }).mood, "sweaty");
  assert.equal(usageMood({ name: "x", percent: 10 }).mood, "chill");
  assert.equal(usageMood({ name: "x", percent: null, errors: 2, tracked: 0 }).mood, "dead");
  assert.equal(usageMood({ name: "x", percent: null }).mood, "confused");
});

import { telemetry, fleetTelemetry } from "../src/lib/robots.js";

test("telemetry turns live numbers into a HUD readout", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  const points = [10, 12, 11, 40, 60, 80].map((cpu, i) => ({ cpu, memory: 30 + i, latency: 100 + i * 50 }));
  const t = telemetry({ id: "srv-abc123f2a", type: "web_service", region: "singapore", mood: "fire", now,
    last: { cpu: 92, memory: 70, latency: 340, status: 200, deploy: { status: "live", createdAt: "2026-10-16T09:00:00Z" } }, points });
  assert.equal(t.unit, "UNIT-3F2A");
  assert.equal(t.code, "WEB·SGP");
  assert.equal(t.threat, "CRITICAL");
  assert.equal(t.trend, "▲");
  assert.equal(t.cpuPeak, 80);
  assert.equal(t.p95, 350);
  assert.deepEqual(t.leds.map((l) => [l.id, l.tone]), [["PWR", "ok"], ["NET", "ok"], ["CPU", "bad"], ["MEM", "mid"], ["DPL", "ok"]]);
  assert.match(t.lines[0], /^> cpu 92% ▲ · avg 36% · peak 80%$/);
  assert.match(t.lines[2], /up 3h · http 200/);
});

test("a suspended unit is offline, with its LEDs off", () => {
  const t = telemetry({ id: "x", mood: "sleeping" });
  assert.equal(t.threat, "OFFLINE");
  assert.ok(t.leds.slice(0, 4).every((l) => l.tone === "off"));
  assert.match(t.lines[0], /suspended/);
});

test("fleet readout averages online units only", () => {
  const f = fleetTelemetry([
    { stats: { mood: "chill", hp: 90 }, last: { cpu: 10, memory: 20, latency: 100 } },
    { stats: { mood: "fire", hp: 30 }, last: { cpu: 90, memory: 60, latency: 300 } },
    { stats: { mood: "sleeping", hp: null }, last: null }
  ]);
  assert.deepEqual({ ...f, cpu: Math.round(f.cpu), memory: Math.round(f.memory) }, { units: 3, online: 2, integrity: 60, cpu: 50, memory: 40, p50: 100, critical: 1, updating: 0 });
});

test("many emotions, each from a real signal", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  const m = (x) => robotMood({ name: "api", now, ...x }).mood;
  assert.equal(m({ verdict: "up", deployStatus: "build_failed" }), "angry");
  assert.equal(m({ verdict: "suspect", cpu: 10 }), "scared");
  assert.equal(m({ verdict: "up", cpu: 10, incident: true }), "scared");
  assert.equal(m({ verdict: "up", cpu: 20, memory: 93 }), "dizzy");
  assert.equal(m({ verdict: "up", cpu: 10, memory: 20, latency: 2200 }), "tired");
  assert.equal(m({ verdict: "up", cpu: 10, deployStatus: "live", deployAt: "2026-10-16T11:50:00Z" }), "celebrating");
  assert.equal(m({ verdict: "up", cpu: 4, memory: 5, latency: 90, deployStatus: "live", deployAt: "2026-10-10T00:00:00Z" }), "starstruck");
  assert.equal(m({ verdict: "up", cpu: 1, memory: 2, latency: 600 }), "bored");
  assert.equal(m({ verdict: "down", deployStatus: "build_failed" }), "dead");
  for (const mood of ["angry", "scared", "dizzy", "tired", "celebrating", "starstruck", "bored"]) {
    const r = robotMood({ name: "api", now, ...{ angry: { verdict: "up", deployStatus: "update_failed" }, scared: { verdict: "suspect" }, dizzy: { verdict: "up", memory: 95 }, tired: { verdict: "up", cpu: 5, memory: 5, latency: 3000 }, celebrating: { verdict: "up", cpu: 5, deployStatus: "live", deployAt: "2026-10-16T11:59:00Z" }, starstruck: { verdict: "up", cpu: 2, memory: 3, latency: 50 }, bored: { verdict: "up", cpu: 1, memory: 1, latency: 400 } }[mood] });
    assert.equal(r.mood, mood);
    assert.match(r.line, /api/);
    assert.ok(!/\{\w+\}/.test(r.line), "no placeholder left in: " + r.line);
  }
});
