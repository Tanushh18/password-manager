const { describe, test } = require("node:test");
const expect = require("./expect");
const fc = require("../../mobile/src/lib/faceCluster");

// Deterministic fake fingerprints: a person is a direction in 128-d space plus a little noise.
const seeded = (seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
const person = (seed) => { const r = seeded(seed); return Array.from({ length: 128 }, () => r()); };
const look = (base, noise, seed) => { const r = seeded(seed); return base.map((x) => x + r() * noise); };
const A = person(11), B = person(97);

describe("faceCluster", () => {
  test("groups the same person together and keeps different people apart", () => {
    const s = fc.emptyStore();
    fc.addFaces(s, "m1", [{ emb: look(A, 0.1, 1) }]);
    fc.addFaces(s, "m2", [{ emb: look(A, 0.1, 2) }, { emb: look(B, 0.1, 3) }]);
    fc.addFaces(s, "m3", [{ emb: look(B, 0.1, 4) }]);
    expect(s.clusters.length).toBe(2);
    expect(fc.people(s).map((p) => p.photos).sort()).toEqual([2, 2]);
  });
  test("a photo is only counted once and re-adding it changes nothing", () => {
    const s = fc.emptyStore();
    fc.addFaces(s, "m1", [{ emb: look(A, 0.1, 1) }]);
    fc.addFaces(s, "m1", [{ emb: look(A, 0.1, 1) }]);
    expect(Object.keys(s.faces).length).toBe(1);
  });
  test("a stricter threshold makes more groups", () => {
    const s = fc.emptyStore();
    fc.addFaces(s, "m1", [{ emb: look(A, 0.1, 1) }], 0.99999);
    fc.addFaces(s, "m2", [{ emb: look(A, 0.1, 2) }], 0.99999);
    expect(s.clusters.length).toBe(2);
  });
  test("merge combines two people and keeps a name", () => {
    const s = fc.emptyStore();
    fc.addFaces(s, "m1", [{ emb: A }]);
    fc.addFaces(s, "m2", [{ emb: B }]);
    const [x, y] = s.clusters;
    fc.renameCluster(s, y.id, "Asha");
    expect(fc.mergeClusters(s, x.id, y.id)).toBe(true);
    expect(s.clusters.length).toBe(1);
    expect(s.clusters[0].name).toBe("Asha");
    expect(s.clusters[0].faceIds.length).toBe(2);
  });
  test("split moves one face into its own person, but never empties a person", () => {
    const s = fc.emptyStore();
    fc.addFaces(s, "m1", [{ emb: look(A, 0.05, 1) }]);
    fc.addFaces(s, "m2", [{ emb: look(A, 0.05, 2) }]);
    expect(s.clusters.length).toBe(1);
    expect(fc.splitFace(s, "m2#0")).toBeTruthy();
    expect(s.clusters.length).toBe(2);
    expect(fc.splitFace(s, "m1#0")).toBe(null);
  });
  test("deleting a person removes their faces but the photo stays scanned", () => {
    const s = fc.emptyStore();
    fc.addFaces(s, "m1", [{ emb: A }]);
    fc.deleteCluster(s, s.clusters[0].id);
    expect(s.clusters.length).toBe(0);
    expect(Object.keys(s.faces).length).toBe(0);
    expect(Boolean(s.processed.m1)).toBe(true);
  });
  test("forgetMissing drops faces of photos that no longer exist", () => {
    const s = fc.emptyStore();
    fc.addFaces(s, "m1", [{ emb: A }]);
    fc.addFaces(s, "m2", [{ emb: B }]);
    fc.forgetMissing(s, ["m1"]);
    expect(s.clusters.length).toBe(1);
    expect(s.processed.m2).toBe(undefined);
  });
  test("standardize gives zero mean and unit spread, and survives a flat image", () => {
    const v = fc.standardize(Float32Array.from({ length: 1000 }, (_, i) => i % 255));
    const mean = v.reduce((n, x) => n + x, 0) / v.length;
    expect(Math.abs(mean) < 1e-3).toBe(true);
    expect(Number.isFinite(fc.standardize(new Float32Array(100).fill(7))[0])).toBe(true);
  });
  test("ignores a fingerprint of the wrong length", () => {
    const s = fc.emptyStore();
    fc.addFaces(s, "m1", [{ emb: [1, 2, 3] }]);
    expect(s.clusters.length).toBe(0);
  });
});
