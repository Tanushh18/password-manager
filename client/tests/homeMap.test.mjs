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

import { clampBlock, moveBlock, resizeBlock, overlapping, layoutOf, exportText, parseLayoutFile, snap } from "../src/lib/homeMap.js";

test("a block snaps to half a unit and stays inside the limits", () => {
  assert.equal(snap(1.3), 1.5); assert.equal(snap(1.2), 1);
  assert.deepEqual(clampBlock({ name: "A", x: -3, y: 99, w: 0.2, h: 40, z: 9 }), { name: "A", x: 0, y: 40, w: 1, h: 8, z: 3 });
  assert.equal(clampBlock({ x: 0, y: 0, w: 2, h: 2 }).z, 0.55);                       // no height yet: the default
  assert.deepEqual(moveBlock({ x: 1, y: 1, w: 2, h: 2, z: 1 }, 0.74, -2.2), { x: 1.5, y: 0, w: 2, h: 2, z: 1 });
  assert.deepEqual(resizeBlock({ x: 1, y: 1, w: 2, h: 2, z: 1 }, -5, 1.3), { x: 1, y: 1, w: 1, h: 3.5, z: 1 });
});

test("blocks on top of each other are named, touching ones are not", () => {
  const a = { name: "A", x: 0, y: 0, w: 2, h: 2 }, b = { name: "B", x: 2, y: 0, w: 2, h: 2 }, c = { name: "C", x: 1, y: 1, w: 2, h: 2 };
  assert.deepEqual(overlapping([a, b]), []);
  assert.deepEqual(overlapping([a, b, c]).sort(), ["A", "B", "C"]);
});

test("the layout that is saved and exported has only the room blocks, and a file imports back into your rooms", () => {
  const blocks = [{ name: "Hall", roomBlock: true, x: 0, y: 0, w: 2, h: 2, z: 1 }, { name: "Kitchen", roomBlock: true, x: 2.5, y: 0, w: 2, h: 2 }, { name: "Fridge", labelOnly: true, x: 5, y: 0, w: 2, h: 2 }];
  assert.deepEqual(Object.keys(layoutOf(blocks)), ["Hall", "Kitchen"]);
  const back = parseLayoutFile(exportText(blocks), ["hall", "Kitchen", "Bedroom"]);
  assert.equal(back.ok, true);
  assert.deepEqual(back.used.sort(), ["Kitchen", "hall"]);                              // matched ignoring capitals, the spelling of YOUR room wins
  assert.equal(back.layout.hall.z, 1);
});

test("a file that is not a layout is refused with a reason, unknown rooms are listed and ignored", () => {
  assert.match(parseLayoutFile("{nope", ["A"]).error, /not a JSON/);
  assert.match(parseLayoutFile("[1,2]", ["A"]).error, /no rooms/);
  assert.match(parseLayoutFile(JSON.stringify({ rooms: { Z: { x: 0, y: 0, w: 2, h: 2 } } }), ["A"]).error, /None of the rooms/);
  const r = parseLayoutFile(JSON.stringify({ A: { x: 1, y: 1, w: 2, h: 2 }, Z: { x: 0, y: 0, w: 2, h: 2 }, B: { x: "x" } }), ["A", "B"]);
  assert.equal(r.ok, true); assert.deepEqual(r.used, ["A"]); assert.deepEqual(r.ignored.sort(), ["B", "Z"]);
});

test("3D uses each room's own height", () => {
  const low = shapes({ zones: [{ id: "a", name: "A", x: 0, y: 0, w: 2, h: 2, z: 0.4 }] }, "3d");
  const tall = shapes({ zones: [{ id: "a", name: "A", x: 0, y: 0, w: 2, h: 2, z: 2.5 }] }, "3d");
  assert.ok(tall.height > low.height);
});

test("editing keeps a fixed roomy canvas so a block can be dragged beyond the others", () => {
  const small = shapes({ zones: [{ id: "a", name: "A", x: 0, y: 0, w: 2, h: 2 }] }, "2d");
  const roomy = shapes({ zones: [{ id: "a", name: "A", x: 0, y: 0, w: 2, h: 2 }] }, "2d", true, { w: 10, h: 7 });
  assert.ok(roomy.width > small.width && roomy.height > small.height);
});
