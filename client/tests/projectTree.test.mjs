import test from "node:test";
import assert from "node:assert/strict";
import { projectTree, countLeaves, searchProjects } from "../src/lib/projectTree.js";

const shop = {
  id: "p1",
  name: "Shop",
  status: "deployed",
  hostingProvider: "Render",
  liveUrl: "shop.example.com",
  databases: [{ label: "Main DB", provider: "MongoDB Atlas", type: "", accountEmail: "", notes: "" }],
  envVars: [
    { name: "MONGO_URI", value: "mongodb+srv://user:pw@cluster/shop", purpose: "db" },
    { name: "JWT_SECRET", value: "s3cret", purpose: "" },
  ],
  extraFields: [],
};
const blog = { id: "p2", name: "Blog", status: "planning", envVars: [{ name: "MONGO_URI_TEST", value: "mongodb://localhost", purpose: "" }] };

test("projectTree keeps only filled sections and nests databases", () => {
  const tree = projectTree(shop);
  assert.deepEqual(tree.map((s) => s.id), ["repo", "hosting", "databases", "env"]);
  const db = tree.find((s) => s.id === "databases");
  assert.equal(db.children[0].label, "Main DB");
  assert.equal(countLeaves(db), 1);
  const env = tree.find((s) => s.id === "env");
  assert.ok(env.children.every((c) => c.secret));
  assert.equal(tree.find((s) => s.id === "repo").children[0].link, true);
});

test("searching a variable name returns its value and the project", () => {
  const { projects, values } = searchProjects([shop, blog], "mongo_uri");
  assert.deepEqual(projects.map((p) => p.id), ["p1", "p2"]);
  assert.equal(values[0].field.label, "MONGO_URI");
  assert.equal(values[0].field.value, "mongodb+srv://user:pw@cluster/shop");
  assert.equal(values[0].project.id, "p1");
  assert.equal(values[1].field.label, "MONGO_URI_TEST");
});

test("search matches values and project names; empty query returns all", () => {
  assert.equal(searchProjects([shop, blog], "render").values[0].field.label, "Provider");
  assert.deepEqual(searchProjects([shop, blog], "blog").projects.map((p) => p.id), ["p2"]);
  assert.equal(searchProjects([shop, blog], "  ").projects.length, 2);
  assert.equal(searchProjects([shop, blog], "nothing-here").values.length, 0);
});

test("web and app copies of projectTree.js are identical", async () => {
  const { readFile } = await import("node:fs/promises");
  const web = await readFile(new URL("../src/lib/projectTree.js", import.meta.url), "utf8");
  const app = await readFile(new URL("../../mobile/src/lib/projectTree.js", import.meta.url), "utf8");
  assert.equal(app, web);
});
