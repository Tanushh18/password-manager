import test from "node:test";
import assert from "node:assert/strict";
import { navGroups, bottomItems, isActivePath, activeEntry } from "../src/lib/navigation.js";

const labels = (groups) => groups.flatMap((g) => g.items.map((i) => i.label));

test("signed-in users always see the vault group", () => {
  const groups = navGroups({ features: {} });
  assert.equal(groups[0].id, "vault");
  assert.deepEqual(groups[0].items.map((i) => i.to), ["/dashboard", "/passwords", "/generator", "/security-center"]);
});

test("feature flags hide their entries and empty groups disappear", () => {
  const groups = navGroups({ features: { photos: false, projects: false, servers: false, services: false, cron: false } });
  assert.deepEqual(groups.map((g) => g.id), ["vault"]);
});

test("admin entries need isAdmin; the admin panel also needs its feature", () => {
  assert.ok(!labels(navGroups({ features: {} })).includes("Server URLs"));
  const admin = labels(navGroups({ isAdmin: true, features: {} }));
  assert.ok(admin.includes("Server URLs") && !admin.includes("Admin panel"));
  assert.ok(labels(navGroups({ isAdmin: true, features: { adminPanel: true } })).includes("Admin panel"));
});

test("Photos keeps its place in the navigation (Workspace, first)", () => {
  const ws = navGroups({ features: { photos: true } }).find((g) => g.id === "workspace");
  assert.equal(ws.items[0].to, "/photos");
});

test("the most specific entry is active", () => {
  const groups = navGroups({ features: {} });
  assert.equal(activeEntry(groups, "/services/map").to, "/services/map");
  assert.equal(activeEntry(groups, "/services").to, "/services");
  assert.equal(activeEntry(groups, "/projects/abc/edit").to, "/projects");
  assert.equal(activeEntry(groups, "/settings"), null);
  assert.ok(!isActivePath({ to: "/services", end: true }, "/services/map"));
});

test("bottom bar falls back to Security when Projects is off", () => {
  assert.deepEqual(bottomItems({ features: { projects: false } }).map((i) => i.to), ["/dashboard", "/passwords", "/security-center"]);
});
