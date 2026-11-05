import test from "node:test";
import assert from "node:assert/strict";
import { colourFor, COLOURS, cutoff, pointsSince, itemsSince, coordKey, placeLabel, kmOf, mapsLink } from "../src/lib/trailView.js";

const now = Date.UTC(2026, 10, 5, 12, 0), h = 3600 * 1000;

test("each person gets a colour, and the colours repeat only after the whole list", () => {
  assert.equal(colourFor(0), COLOURS[0]);
  assert.equal(colourFor(COLOURS.length), COLOURS[0]);
  assert.notEqual(colourFor(0), colourFor(1));
});

test("the last-N-hours window keeps recent points and stays that are still going on", () => {
  assert.equal(cutoff(6, now), now - 6 * h);
  const pts = [{ at: now - 8 * h }, { at: now - 5 * h }, { at: now - 1 * h }];
  assert.equal(pointsSince(pts, 6, now).length, 2);
  assert.equal(pointsSince(pts, 24, now).length, 3);
  assert.equal(pointsSince(pts, 1, now).length, 1);
  const tl = [{ type: "stay", from: now - 9 * h, to: now - 7 * h }, { type: "stay", from: now - 7 * h, to: now - 30 * 60000 }];
  assert.equal(itemsSince(tl, 6, now).length, 1);
  assert.equal(itemsSince(tl, 24, now).length, 2);
});

test("an address is remembered by its rounded coordinates, and a place is named in the order: your name, the street, the numbers", () => {
  assert.equal(coordKey(28.61391, 77.20901), coordKey(28.61392, 77.20902));
  assert.notEqual(coordKey(28.6139, 77.209), coordKey(28.62, 77.209));
  assert.equal(placeLabel({ name: "Home", address: "MG Road" }, 1, 2), "Home");
  assert.equal(placeLabel({ name: null, address: "MG Road, Gurugram" }, 1, 2), "MG Road, Gurugram");
  assert.equal(placeLabel(null, 28.613912, 77.2090123), "28.61391, 77.20901");
  assert.match(mapsLink(28.6, 77.2), /openstreetmap\.org.*28\.6.*77\.2/);
});

test("distance ignores wobble under 50 m and adds real movement", () => {
  const p = (lat) => ({ lat, lon: 77.209 });
  assert.equal(kmOf([p(28.6139), p(28.61395), p(28.61392)]), 0);
  assert.ok(kmOf([p(28.6139), p(28.6639)]) > 5 && kmOf([p(28.6139), p(28.6639)]) < 6);
});
