const test = require("node:test");
const assert = require("node:assert/strict");
const { supportsDomains, normalizeDomains, missingVerifiedDomains } = require("../utils/moveServer");

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
