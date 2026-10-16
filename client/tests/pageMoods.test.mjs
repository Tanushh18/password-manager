import test from "node:test";
import assert from "node:assert/strict";
import { vaultMood, projectsMood, cronMood, securityMood, accountMood, registryMood } from "../src/lib/pageMoods.js";

test("each page's robot mood follows its own data", () => {
  assert.equal(vaultMood({}, 0).mood, "bored");
  assert.equal(vaultMood({ breached: 2, score: 40 }, 10).mood, "scared");
  assert.equal(vaultMood({ reused: 4, score: 50 }, 10).mood, "dizzy");
  assert.equal(vaultMood({ weak: 1, score: 80 }, 10).mood, "sweaty");
  assert.equal(vaultMood({ score: 95 }, 10).mood, "starstruck");
  assert.match(vaultMood({ breached: 1 }, 3).line, /1 password /);

  assert.equal(projectsMood([], {}).mood, "bored");
  assert.equal(projectsMood([1, 2], { a: { health: { level: "red" } }, b: { health: { level: "green" } } }).mood, "fire");
  assert.equal(projectsMood([1, 2], { a: { health: { level: "green" } }, b: { health: { level: "green" } } }).mood, "celebrating");

  assert.equal(cronMood(0, {}).mood, "bored");
  assert.equal(cronMood(2, { a: { ok: false }, b: { ok: true } }).mood, "angry");
  assert.equal(cronMood(2, { a: { ok: false, missingRoute: true }, b: { ok: true } }).mood, "confused");
  assert.equal(cronMood(2, { a: { ok: true }, b: { ok: true } }).mood, "starstruck");

  assert.equal(securityMood({ loading: true }).mood, "transforming");
  assert.equal(securityMood({ hasRun: true, failed: 1, passed: 3, active: 0 }).mood, "scared");
  assert.equal(securityMood({ hasRun: true, failed: 0, passed: 3, active: 0 }).mood, "starstruck");

  assert.equal(accountMood({ twoFactorEnabled: false }).mood, "scared");
  assert.equal(accountMood({ twoFactorEnabled: true, sessions: 2 }).mood, "starstruck");
  assert.equal(registryMood([{ urls: ["a"] }]).mood, "sweaty");
  assert.equal(registryMood([{ urls: ["a", "b"] }]).mood, "chill");
});
