import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("security center reads live workflow and job status from GitHub", async () => {
  const page = await read("../src/Pages/Security/Security.jsx");
  for (const phrase of ["Dependency vulnerabilities", "Static code analysis", "Secret leakage", "Staging DAST", "LIVE FROM GITHUB ACTIONS", "Recent runs", "Refresh status"]) {
    assert.ok(page.toLowerCase().includes(phrase.toLowerCase()), `missing security center coverage: ${phrase}`);
  }
  assert.ok(page.includes("actions/workflows/security-scan.yml"));
  assert.ok(page.includes("actions/runs/"));
  assert.ok(page.includes("GitHub API rate limit reached"));
  assert.ok(page.includes("never as clean"));
});

test("security center route is protected by both vault authentication and admin guard", async () => {
  const app = await read("../src/App.jsx");
  const nav = await read("../src/Components/Navbar/Navbar.jsx");
  assert.ok(app.includes('<Route path="/security" element={<RequireVault><RequireAdmin><Security /></RequireAdmin></RequireVault>} />'));
  assert.ok(nav.includes('profile?.isAdmin ? [{ to: "/servers", label: "Server URLs" }, { to: "/security", label: "Security scans" }]'));
});

test("security workflow covers dependency, static, secret, filesystem and PR dependency scans", async () => {
  const workflow = await read("../../.github/workflows/security-scan.yml");
  for (const phrase of ["workflow_dispatch", "schedule:", "npm audit --json", "security-exception-gate.mjs", "security/exceptions.json", "gitleaks/gitleaks-action", "github/codeql-action/init", "aquasecurity/trivy-action", "actions/dependency-review-action", "zaproxy/action-baseline", "STAGING_BASE_URL"]) {
    assert.ok(workflow.includes(phrase), `missing workflow scan gate: ${phrase}`);
  }
  assert.ok(workflow.includes("directory: [server, client, mobile]"));
});


test("security exceptions are narrow, owner-approved and expiring", async () => {
  const policy = JSON.parse(await read("../../security/exceptions.json"));
  const gate = await read("../../scripts/security-exception-gate.mjs");
  assert.equal(policy.exceptions.length, 2);
  assert.deepEqual(policy.exceptions.map((entry) => entry.package).sort(), ["braces", "node-forge"]);
  for (const entry of policy.exceptions) {
    assert.equal(entry.approvedBy, "Tanushh18 (repository owner)");
    assert.equal(entry.approvedAt, "2026-10-16");
    assert.equal(entry.expiresAt, "2026-10-30");
    assert.ok(entry.advisoryIds.length >= 2);
    assert.ok(entry.compensatingControls.length >= 2);
  }
  assert.ok(gate.includes("npm audit report is incomplete"));
  assert.ok(gate.includes("exception expired"));
});
