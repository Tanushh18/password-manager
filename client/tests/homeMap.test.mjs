import test from "node:test";
import assert from "node:assert/strict";
import { shapes, iso, awayLine } from "../src/lib/homeMap.js";

const map = {
  zones: [
    { id: "a", name: "Hall", auto: false, hint: "", x: 0, y: 0, w: 2, h: 2, hub: true, devices: [{ label: "Sony TV", up: true }], people: [{ person: "Papa" }] },
    { id: "b", name: "Zone 2", auto: true, hint: "phones sleep here (bedroom?)", x: 2.5, y: 0, w: 2, h: 2, devices: [], people: [] },
    { id: "room:Kitchen", name: "Kitchen", labelOnly: true, x: 0, y: 2.5, w: 2, h: 2, devices: [], people: [] }
  ],
  away: [{ person: "Mom", distanceKm: 3.2 }], plan: ""
};

test("2D: one rectangle and title per block, markers inside it, the size covers every block", () => {
  const r = shapes(map, "2d");
  assert.equal(r.items.filter((i) => i.type === "rect").length, 3);
  assert.equal(r.items.filter((i) => i.type === "dot").map((d) => d.kind).sort().join(), "device-up,hub,person");
  assert.ok(r.width >= 4.5 * 120 && r.height >= 4.5 * 120);
  assert.ok(r.items.some((i) => i.type === "text" && /bedroom\?/.test(i.text)));          // an auto name shows its hint
  assert.ok(!r.items.some((i) => i.type === "text" && i.text === "" ));
  assert.equal(r.items.find((i) => i.type === "rect" && i.id === "room:Kitchen").cls, "label");
});

test("2D with a floor plan: the picture goes behind and the blocks become see-through overlays", () => {
  const r = shapes({ ...map, plan: "data:image/png;base64,AAAA" }, "2d");
  assert.equal(r.items[0].type, "plan");
  assert.ok(r.items.filter((i) => i.type === "rect").every((i) => i.plan === true));
  assert.ok(!shapes({ ...map, plan: "data:image/png;base64,AAAA" }, "2d", false).items.some((i) => i.type === "plan"));
});

test("3D: three faces per block, everything inside the picture, nearer blocks drawn after farther ones", () => {
  const r = shapes(map, "3d");
  const polys = r.items.filter((i) => i.type === "poly");
  assert.equal(polys.length, 9);
  for (const p of polys) for (const pair of p.points.split(" ")) { const [x, y] = pair.split(",").map(Number); assert.ok(x >= 0 && x <= r.width && y >= 0 && y <= r.height, `${pair} outside ${r.width}x${r.height}`); }
  const order = polys.filter((p) => p.cls.endsWith("-top")).map((p) => p.id);
  assert.deepEqual(order, ["a", "b", "room:Kitchen"].sort((x, y) => { const bx = map.zones.find((z) => z.id === x), by = map.zones.find((z) => z.id === y); return (bx.x + bx.y) - (by.x + by.y); }));
});

test("isometric projection: moving right goes right and down, moving back goes left and down, height goes up", () => {
  const o = iso(0, 0, 0), r = iso(1, 0, 0), b = iso(0, 1, 0), up = iso(0, 0, 1);
  assert.ok(r.x > o.x && r.y > o.y);
  assert.ok(b.x < o.x && b.y > o.y);
  assert.ok(up.y < o.y && up.x === o.x);
});

test("an empty map still draws, and the away people are listed", () => {
  assert.deepEqual(shapes({ zones: [] }, "2d").items, []);
  assert.ok(shapes({ zones: [] }, "3d").width > 0);
  assert.equal(awayLine(map), "Bahar: Mom (3.2 km)");
  assert.equal(awayLine({ away: [] }), "");
});
