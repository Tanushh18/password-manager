import { test } from "node:test";
import assert from "node:assert/strict";
import { answerLocally, understand, mask, askAgent } from "../src/lib/agent.js";

const projects = [
  { name: "ggnhome", firebaseProjectId: "ggn-home", envVars: [{ name: "FIREBASE_API_KEY", value: "AIza123" }, { name: "PORT", value: "3000" }], extraFields: [{ label: "Firebase service account", value: "{json}" }] },
  { name: "billing-api", envVars: [{ name: "MONGO_URI", value: "mongodb://u:p@h/db" }, { name: "FIREBASE_KEY", value: "zzz" }] }
];

test("understand splits subject from kind", () => {
  const q = understand("give me the api key of the ggnhome firebase creds");
  assert.ok(q.subject.includes("ggnhome") && q.subject.includes("firebase"));
  assert.ok(q.kind.includes("secret"));
});
test("finds the right project's credentials first", () => {
  const r = answerLocally("give me the ggnhome firebase creds", projects);
  assert.equal(r.groups[0].project.name, "ggnhome");
  assert.ok(r.groups[0].fields.some((f) => f.label === "FIREBASE_API_KEY"));
  assert.ok(!r.groups[0].fields.some((f) => f.label === "PORT"));
});
test("a specific variable name works", () => {
  const r = answerLocally("MONGO_URI for billing api", projects);
  assert.equal(r.groups[0].fields[0].label, "MONGO_URI");
});
test("nothing found, and empty asks, say so", () => {
  assert.equal(answerLocally("kubernetes token", projects).groups.length, 0);
  assert.equal(answerLocally("please give me", projects).groups.length, 0);
});
test("a failing model falls back; the prompt never holds values", async () => {
  let seen = "";
  const ok = await askAgent("ggnhome firebase creds", projects, { model: { generate: async (p) => { seen = p; return "Found it."; } } });
  assert.equal(ok.answer, "Found it.");
  assert.ok(!seen.includes("AIza123"));
  const bad = await askAgent("ggnhome firebase creds", projects, { model: { generate: async () => { throw new Error("x"); } } });
  assert.match(bad.answer, /Found/);
  assert.equal(mask("AIza123456"), "••••••••56");
});
