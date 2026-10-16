import test from "node:test";
import assert from "node:assert/strict";
import { buildRows, applyChoice, choiceOf, sameMapping, slugify, guessRole, isFrontendVar, folderRows } from "../src/Pages/Services/serviceMapUtils.js";

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

test("the part of a login is guessed from the variable name, when the guess is unambiguous", () => {
  const cl = [["cloudName", "Cloud name"], ["apiKey", "API key"], ["apiSecret", "API secret"]];
  assert.equal(guessRole(cl, "CLOUDINARY_API_KEY", "cloudinary"), "apiKey");
  assert.equal(guessRole(cl, "CLOUDINARY_API_SECRET", "cloudinary"), "apiSecret");
  assert.equal(guessRole(cl, "NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", "cloudinary"), "cloudName");
  assert.equal(guessRole(cl, "XK1", "cloudinary"), "");
  assert.equal(guessRole([["uri", "Connection string"]], "MONGO_URI", "mongodb"), "uri");
});

test("frontend variables are told apart by prefix or by where the code reads them", () => {
  const project = { code: { frontendVars: ["API_BASE"] } };
  assert.ok(isFrontendVar("VITE_API_URL", project));
  assert.ok(isFrontendVar("NEXT_PUBLIC_X", {}));
  assert.ok(isFrontendVar("API_BASE", project));
  assert.ok(!isFrontendVar("DB_URI", project));
});

test("the folder list is indented and flags the suggestion and frontend-looking folders", () => {
  const rows = folderRows([{ path: "client", code: 3 }, { path: "server", code: 9 }, { path: "server/utils", code: 2 }], { folder: "server", reason: "uses express" });
  assert.deepEqual(rows.map((r) => [r.path, r.depth, r.suggested, r.looksFrontend]), [["client", 0, false, true], ["server", 0, true, false], ["server/utils", 1, false, false]]);
  assert.equal(rows[1].why, "uses express");
});
