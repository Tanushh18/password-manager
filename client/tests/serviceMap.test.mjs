import test from "node:test";
import assert from "node:assert/strict";
import { buildRows, applyChoice, choiceOf, sameMapping, slugify } from "../src/Pages/Services/serviceMapUtils.js";

const project = {
  id: "srv-1",
  services: [{ key: "cloudinary", label: "Cloudinary", vars: [{ name: "CLOUDINARY_API_KEY", kind: "secret", set: true, via: "name" }] }],
  otherVars: [{ name: "MYSTERY", kind: "secret", set: true }],
  internalVars: [{ name: "PORT", kind: "config", set: true, display: "3000" }]
};

test("rows list every variable, unsure ones first", () => {
  const rows = buildRows(project);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].name, "MYSTERY");
  assert.equal(rows[0].ownerKey, "");
  assert.equal(rows.find((r) => r.name === "CLOUDINARY_API_KEY").ownerLabel, "Cloudinary");
  assert.equal(rows.find((r) => r.name === "PORT").internal, true);
});

test("a choice is saved per project or for all projects, and can be undone", () => {
  let m = applyChoice({}, "srv-1", "MYSTERY", "cloudinary", { key: "brevo", role: "apiKey", group: "shop", scope: "project" });
  assert.deepEqual(m, { "srv-1|MYSTERY": { key: "cloudinary" } }, "a role chosen for another service is not kept");
  m = applyChoice(m, "srv-1", "MYSTERY", "cloudinary", { key: "cloudinary", role: "apiKey", group: "shop", scope: "all" });
  assert.deepEqual(m, { "*|MYSTERY": { key: "cloudinary", role: "apiKey", group: "shop" } });
  assert.equal(choiceOf(m, "srv-1", "MYSTERY").scope, "all");
  assert.deepEqual(applyChoice(m, "srv-1", "MYSTERY", "", null), {});
});

test("mapping comparison ignores key order; slugs are safe ids", () => {
  assert.ok(sameMapping({ a: { key: "x" }, b: { key: "y" } }, { b: { key: "y" }, a: { key: "x" } }));
  assert.ok(!sameMapping({ a: { key: "x" } }, {}));
  assert.equal(slugify("Acme Maps!"), "acme-maps");
  assert.equal(slugify("  ###  "), "");
});
