import test from "node:test";
import assert from "node:assert/strict";
import { tone, confusionRows, thinRooms, agoText } from "../src/lib/roomLab.js";

test("accuracy becomes a plain verdict, and nothing tested means nothing to judge", () => {
  assert.equal(tone(90, 40), "good");
  assert.equal(tone(70, 40), "fair");
  assert.equal(tone(40, 40), "weak");
  assert.equal(tone(100, 0), "none");
});

test("the confusion table lists each room's guesses, with 'not sure' as the last column", () => {
  const report = { perRoom: { Kitchen: { n: 10, accuracy: 70 }, Bedroom: { n: 12, accuracy: 100 } }, confusion: { Kitchen: { Kitchen: 7, Bedroom: 2, "(not sure)": 1 }, Bedroom: { Bedroom: 12 } } };
  const t = confusionRows(report);
  assert.deepEqual(t.cols, ["Bedroom", "Kitchen", "(not sure)"]);
  assert.deepEqual(t.rows[0], { room: "Bedroom", n: 12, accuracy: 100, cells: [12, 0, 0] });
  assert.deepEqual(t.rows[1].cells, [2, 7, 1]);
  assert.deepEqual(confusionRows({}).rows, []);
});

test("rooms with fewer than five samples are flagged, and the time reads naturally", () => {
  assert.deepEqual(thinRooms(["Bedroom", "Kitchen", "Hall"], { Bedroom: 30, Kitchen: 4 }), ["Kitchen", "Hall"]);
  const now = Date.UTC(2026, 10, 5, 12);
  assert.equal(agoText(now - 20000, now), "abhi");
  assert.equal(agoText(now - 7 * 60000, now), "7 min pehle");
  assert.equal(agoText(now - 3 * 3600000, now), "3 ghante pehle");
});

import { barText, liveRows, headline } from "../src/lib/roomLab.js";
test("the live rows list every calculated value, and the headline says room, unsure, old or why none", () => {
  const p = { on: true, trained: true, cv: { tested: 120, accuracy: 92, unsure: 4 }, field: { total: 2, accuracy: 50, confirmed: 1, wrong: 1 },
    current: { name: "Kitchen", confidence: 0.82, sure: true, fresh: true, ageSec: 12, nearest: 6.4, heard: { wifi: 24, ble: 7 }, samples: 64 } };
  const rows = Object.fromEntries(liveRows(p));
  assert.equal(rows["pakka (confidence)"], "82%");
  assert.equal(rows["aakhri scan"], "12 s pehle");
  assert.equal(rows["doori (sabse paas ka sample)"], "6.4 dBm");
  assert.equal(rows["suna"], "Wi-Fi 24 · Bluetooth 7");
  assert.equal(rows["accuracy (chhupa ke guess)"], "92% · 120 scan ka test · 4% pakka nahi");
  assert.equal(rows["asli accuracy (aapke taps)"], "50% · 1 sahi, 1 galat");
  assert.equal(headline(p), "Kitchen");
  assert.equal(headline({ ...p, current: { ...p.current, sure: false } }), "Kitchen (?)");
  assert.equal(headline({ ...p, current: { ...p.current, fresh: false } }), "Kitchen (purana)");
  assert.equal(headline({ on: true, trained: false, current: null }), "train nahi hua");
  assert.equal(headline({ on: false, trained: true, current: null }), "band");
  assert.equal(barText(50, 10), "█████░░░░░");
  assert.equal(barText(130, 4), "████");
  assert.equal(Object.fromEntries(liveRows({ cv: { tested: 0 }, field: { total: 0 }, current: null }))["accuracy (chhupa ke guess)"], "abhi nahi bani");
});
