import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeProject } from "../src/lib/projectItems.js";

test("a project keeps its server URLs, the auto flag and the servers removed by hand", () => {
  const p = normalizeProject({
    name: "Shop",
    registryApp: "Shop-Api",
    serverUrls: [{ url: "https://a.onrender.com/api/", enabled: false, auto: true }, { url: "ftp://bad" }, { url: "https://b.example.com" }],
    serverUrlsIgnored: ["https://c.onrender.com/", 7],
  });
  assert.deepEqual(p.serverUrls, [{ url: "https://a.onrender.com/api", enabled: false, auto: true }, { url: "https://b.example.com", enabled: true }]);
  assert.deepEqual(p.serverUrlsIgnored, ["https://c.onrender.com"]);
  assert.equal(p.registryApp, "shop-api");
});
