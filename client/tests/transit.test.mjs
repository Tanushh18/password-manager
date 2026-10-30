import test from "node:test";
import assert from "node:assert/strict";
import { carState, trains, skyline, buses, arrival, announcements } from "../src/lib/transit.js";

const items = [
  { id: "a", name: "GitHub", type: "login", password: "pw-secret-1", updatedAt: "2026-01-01" },
  { id: "b", name: "Bank", type: "login", password: "pw-secret-2", updatedAt: "2026-03-01" },
  { id: "c", name: "Wi-Fi", type: "note", updatedAt: "2026-02-01" },
];
const info = { a: { score: 4, reused: false, old: false, breached: 0 }, b: { score: 1, reused: true, old: false, breached: 0 } };

test("car state follows health", () => {
  assert.equal(carState(info.a), "ok");
  assert.equal(carState(info.b), "danger");
  assert.equal(carState({ score: 3, reused: true }), "warn");
  assert.equal(carState(undefined), "idle");
});

test("one train per non-empty type, cars capped", () => {
  const t = trains(items, info, 1);
  assert.deepEqual(t.map((x) => x.type), ["login", "note"]);
  assert.equal(t[0].cars.length, 1);
  assert.equal(t[0].extra, 1);
});

test("skyline, buses and arrival come from real state", () => {
  const s = skyline(items, info);
  assert.equal(s.length, 3);
  assert.ok(s[0].height > s[1].height);
  assert.deepEqual(buses([{ id: 1, status: "deployed" }, { id: 2, status: "archived" }]).map((b) => b.state), ["ok"]);
  assert.equal(arrival(items).name, "Bank");
  assert.equal(arrival([]), null);
});

test("announcements never contain password values", () => {
  const lines = announcements({ items, health: { info, reused: 1 }, projects: [{ status: "deployed" }] });
  const text = lines.join(" ");
  assert.match(text, /Platform 1: Logins express, 2 cars, 1 verified, 1 held/);
  assert.match(text, /Now landing: Bank/);
  assert.ok(!text.includes("pw-secret"));
  assert.equal(announcements({}).length, 1);
});
