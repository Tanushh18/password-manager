const test = require("node:test");
const assert = require("node:assert/strict");
const { supportsDomains, normalizeDomains, missingVerifiedDomains, payloadFrom } = require("../utils/moveServer");

test("custom domains are enabled only for Render web services and static sites", () => {
  assert.equal(supportsDomains("web_service"), true);
  assert.equal(supportsDomains("static_site"), true);
  assert.equal(supportsDomains("background_worker"), false);
  assert.equal(supportsDomains("cron_job"), false);
});

test("Render custom-domain list rows normalize wrapped and plain shapes safely", () => {
  const rows = normalizeDomains({
    items: [
      { customDomain: { id: "cd-1", name: "WWW.Example.com", verificationStatus: "verified" }, cursor: "next" },
      { name: "api.example.com", verificationStatus: "unverified" }
    ]
  });
  assert.deepEqual(rows.map((d) => [d.name, d.verificationStatus]), [
    ["www.example.com", "verified"],
    ["api.example.com", "unverified"]
  ]);
});

test("migration is not ready until every expected custom domain is verified on the replacement", () => {
  const expected = ["www.example.com", "api.example.com"];
  const partial = [{ name: "www.example.com", verificationStatus: "verified" }];
  assert.deepEqual(missingVerifiedDomains(expected, partial), ["api.example.com"]);
  assert.deepEqual(missingVerifiedDomains(expected, [
    { name: "www.example.com", verificationStatus: "verified" },
    { name: "api.example.com", verificationStatus: "verified" }
  ]), []);
});

test("replacement payload carries direct secret files and supported build settings", () => {
  const old = {
    type: "web_service",
    ownerId: "old-owner",
    repo: "https://github.com/example/app",
    branch: "main",
    autoDeployTrigger: "checksPass",
    rootDir: "server",
    serviceDetails: {
      runtime: "node",
      plan: "starter",
      region: "oregon",
      envSpecificDetails: { buildCommand: "npm ci", startCommand: "npm start" },
      healthCheckPath: "/health"
    }
  };
  const envVars = [{ key: "API_MODE", value: "production" }];
  const secretFiles = [{ name: "cert.pem", content: "private-key-material" }];
  const payload = payloadFrom(old, envVars, secretFiles, "new-owner", "app-copy");
  assert.equal(payload.ownerId, "new-owner");
  assert.equal(payload.autoDeployTrigger, "checksPass");
  assert.deepEqual(payload.envVars, envVars);
  assert.deepEqual(payload.secretFiles, secretFiles);
  assert.equal(payload.rootDir, "server");
  assert.equal(payload.serviceDetails.envSpecificDetails.startCommand, "npm start");
});

test("persistent-disk services cannot be copied as if their data migrated", () => {
  const old = {
    type: "web_service",
    repo: "https://github.com/example/app",
    branch: "main",
    serviceDetails: { runtime: "node", plan: "free", disk: { name: "data", sizeGB: 1 } }
  };
  assert.throws(() => payloadFrom(old, [], [], "new-owner", "app-copy"), /persistent disk.*separate data migration/i);
});
