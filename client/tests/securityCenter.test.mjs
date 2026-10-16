import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("security center describes the scanners and does not claim live scan results", async () => {
  const page = await read("../src/Pages/Security/Security.jsx");
  for (const phrase of ["Dependency vulnerabilities", "Static code analysis", "Secret leakage", "configuration", "scan is clean"]) {
    assert.ok(page.toLowerCase().includes(phrase.toLowerCase()), `missing security center coverage: ${phrase}`);
  }
  assert.ok(page.includes("actions/workflows/security-scan.yml"));
  assert.ok(page.includes("does not claim a scan is clean"));
});

test("security center route is protected by both vault authentication and admin guard", async () => {
  const app = await read("../src/App.jsx");
  const nav = await read("../src/Components/Navbar/Navbar.jsx");
  assert.ok(app.includes('<Route path="/security" element={<RequireVault><RequireAdmin><Security /></RequireAdmin></RequireVault>} />'));
  assert.ok(nav.includes('profile?.isAdmin ? [{ to: "/servers", label: "Servers" }, { to: "/security", label: "Security scans" }]'));
});

test("security workflow covers dependency, static, secret, filesystem and PR dependency scans", async () => {
  const workflow = await read("../../../.github/workflows/security-scan.yml");
  for (const phrase of ["workflow_dispatch", "schedule:", "npm audit --audit-level=high", "gitleaks/gitleaks-action", "github/codeql-action/init", "aquasecurity/trivy-action", "actions/dependency-review-action"]) {
    assert.ok(workflow.includes(phrase), `missing workflow scan gate: ${phrase}`);
  }
  assert.ok(workflow.includes("directory: [server, client, mobile]"));
});
