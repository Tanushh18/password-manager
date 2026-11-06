import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildGlb, glbPartNames, matchParts, partRoom } from "../src/lib/houseGlb.js";

describe("matching the parts of a 3D model to rooms", () => {
  const rooms = ["Bedroom", "Bedroom 2", "Kitchen", "Hall"];
  test("names match whatever the case, and copies/sub-parts belong to their room", () => {
    assert.equal(partRoom("bedroom", rooms), "Bedroom");
    assert.equal(partRoom("KITCHEN", rooms), "Kitchen");
    assert.equal(partRoom("Kitchen.001", rooms), "Kitchen");
    assert.equal(partRoom("Hall_wall_left", rooms), "Hall");
    assert.equal(partRoom("Bedroom 2", rooms), "Bedroom 2");          // the longer room name wins
    assert.equal(partRoom("Bedroom_2_floor", rooms), "Bedroom 2");
    assert.equal(partRoom("Hallway", rooms), "");                      // only a whole word counts
    assert.equal(partRoom("Sofa", rooms), "");
    assert.equal(partRoom("", rooms), "");
  });
  test("what matched, what is missing, what is extra", () => {
    const r = matchParts(["Hall", "Hall_door", "Kitchen", "Sofa"], rooms);
    assert.deepEqual(r.matched, { Hall: ["Hall", "Hall_door"], Kitchen: ["Kitchen"] });
    assert.deepEqual(r.missing, ["Bedroom", "Bedroom 2"]);
    assert.deepEqual(r.extra, ["Sofa"]);
  });
});

describe("the sample .glb made from the layout", () => {
  const blocks = [{ name: "Bedroom", x: 0, y: 0, w: 4, h: 3, z: 1.2 }, { name: "Kitchen", x: 4.5, y: 0, w: 2, h: 2, z: 0.55 }];
  test("is a well-formed glTF binary with one named box per room", () => {
    const buf = buildGlb(blocks);
    const dv = new DataView(buf);
    assert.equal(dv.getUint32(0, true), 0x46546c67);
    assert.equal(dv.getUint32(4, true), 2);
    assert.equal(dv.getUint32(8, true), buf.byteLength);
    assert.equal(buf.byteLength % 4, 0);
    assert.deepEqual(glbPartNames(buf), ["Bedroom", "Kitchen"]);
    const jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
    assert.equal(json.accessors.length, 6);
    assert.deepEqual(json.accessors[0].max, [4, 1.2, 3]);
    assert.deepEqual(json.accessors[3].min, [4.5, 0, 0]);
    const binLen = dv.getUint32(20 + jsonLen, true);
    assert.equal(json.buffers[0].byteLength, binLen);
  });
  test("a file that is not a .glb has no part names", () => {
    assert.equal(glbPartNames(new TextEncoder().encode("hello hello hello hello").buffer), null);
  });
});
