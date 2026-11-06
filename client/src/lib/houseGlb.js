/*
 * The 3D house as a real model file (.glb, glTF Binary).
 *  - buildGlb(blocks):  makes a .glb with one box per room, named after the room: a starting point to open in Blender (or any 3D tool),
 *                       reshape, and import back.
 *  - matchParts(parts, rooms): which parts of an imported model belong to which room, by name.
 * No three.js in here, so it is cheap to import and easy to test.
 */

const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();

/** A part belongs to a room when its name is the room's name, or starts with it: "Bedroom", "bedroom.001", "Bedroom_wall", "Bedroom 2 floor" no (2 is another room). */
export function partRoom(part, rooms) {
  const p = norm(part);
  if (!p) return "";
  let best = "";
  for (const r of rooms) {
    const n = norm(r);
    if (!n) continue;
    if (p === n || p.startsWith(n + " ")) {
      const rest = p.slice(n.length).trim();
      if (/^\d+$/.test(rest) && p !== n && rest !== "001" && !/^0+\d$/.test(rest)) continue;      // "Bedroom 2" is another room, "Bedroom.001" is a copy of this one
      if (n.length > best.length) best = r;
    }
  }
  return best;
}

/** { matched: { room: [partName, ...] }, missing: [rooms with no part], extra: [parts that belong to no room] } */
export function matchParts(parts, rooms) {
  const matched = {}, extra = [];
  for (const part of parts) {
    const room = partRoom(part, rooms);
    if (room) (matched[room] = matched[room] || []).push(part); else extra.push(part);
  }
  return { matched, missing: rooms.filter((r) => !matched[r]), extra };
}

const CUBE = (() => {
  // 6 faces x 4 corners of a unit box (0..1 on each axis); y is up
  const faces = [
    { n: [0, 0, 1], v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] }, { n: [0, 0, -1], v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
    { n: [1, 0, 0], v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] }, { n: [-1, 0, 0], v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
    { n: [0, 1, 0], v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] }, { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] }
  ];
  return faces;
})();

/** blocks: [{ name, x, y, w, h, z }] in grid units (x right, y down the map = +z in 3D, z = height). Returns an ArrayBuffer holding a valid .glb. */
export function buildGlb(blocks) {
  const pos = [], nor = [], idx = [];
  blocks.forEach((b) => {
    CUBE.forEach((f, fi) => {
      f.v.forEach((v) => { pos.push(b.x + v[0] * b.w, v[1] * b.z, b.y + v[2] * b.h); nor.push(...f.n); });
      idx.push(fi * 4, fi * 4 + 1, fi * 4 + 2, fi * 4, fi * 4 + 2, fi * 4 + 3);       // indices count from the start of this room's 24 corners
    });
  });
  const P = new Float32Array(pos), N = new Float32Array(nor), I = new Uint16Array(idx);
  const bin = new Uint8Array(Math.ceil((P.byteLength + N.byteLength + I.byteLength) / 4) * 4);
  bin.set(new Uint8Array(P.buffer), 0); bin.set(new Uint8Array(N.buffer), P.byteLength); bin.set(new Uint8Array(I.buffer), P.byteLength + N.byteLength);
  const views = [
    { buffer: 0, byteOffset: 0, byteLength: P.byteLength, target: 34962 },
    { buffer: 0, byteOffset: P.byteLength, byteLength: N.byteLength, target: 34962 },
    { buffer: 0, byteOffset: P.byteLength + N.byteLength, byteLength: I.byteLength, target: 34963 }
  ];
  const accessors = [], meshes = [];
  blocks.forEach((b, i) => {
    const a = accessors.length;
    accessors.push({ bufferView: 0, byteOffset: i * 24 * 12, componentType: 5126, count: 24, type: "VEC3", min: [b.x, 0, b.y], max: [b.x + b.w, b.z, b.y + b.h] });
    accessors.push({ bufferView: 1, byteOffset: i * 24 * 12, componentType: 5126, count: 24, type: "VEC3" });
    accessors.push({ bufferView: 2, byteOffset: i * 36 * 2, componentType: 5123, count: 36, type: "SCALAR" });
    meshes.push({ name: b.name, primitives: [{ attributes: { POSITION: a, NORMAL: a + 1 }, indices: a + 2, material: 0 }] });
  });
  const json = {
    asset: { version: "2.0", generator: "Stashr house layout" },
    scene: 0, scenes: [{ nodes: blocks.map((_, i) => i) }], nodes: blocks.map((b, i) => ({ name: b.name, mesh: i })), meshes,
    materials: [{ name: "wall", pbrMetallicRoughness: { baseColorFactor: [0.55, 0.62, 0.72, 1], metallicFactor: 0, roughnessFactor: 0.9 } }],
    accessors, bufferViews: views, buffers: [{ byteLength: bin.length }]
  };
  const enc = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = Math.ceil(enc.length / 4) * 4;
  const total = 12 + 8 + jsonLen + 8 + bin.length;
  const out = new ArrayBuffer(total), dv = new DataView(out), u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4e4f534a, true);
  u8.fill(0x20, 20, 20 + jsonLen); u8.set(enc, 20);
  const b0 = 20 + jsonLen;
  dv.setUint32(b0, bin.length, true); dv.setUint32(b0 + 4, 0x004e4942, true);
  u8.set(bin, b0 + 8);
  return out;
}

/** The names of the parts (nodes) of a .glb, read straight from its JSON chunk. null if it is not a .glb. */
export function glbPartNames(buffer) {
  try {
    const dv = new DataView(buffer);
    if (dv.getUint32(0, true) !== 0x46546c67) return null;
    const len = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, len)));
    return (json.nodes || []).map((n) => n && n.name).filter(Boolean);
  } catch { return null; }
}
