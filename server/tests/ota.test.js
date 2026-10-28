const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const originalFetch = global.fetch;
const bundleBytes = "console.log('stashr ota');";
const manifest = {
  id: "5c6b8a2e-1f3d-4b7a-9e0f-2d4c6a8b0e1f",
  createdAt: "2026-10-28T10:00:00.000Z",
  runtimeVersion: "2.3.1",
  launchAsset: { key: "bundleJS", contentType: "application/javascript", hash: "bundlehash", fileName: "bundlehash.hbc" },
  assets: [{ key: "logo", contentType: "image/png", fileExtension: ".png", hash: "logohash", fileName: "logohash.png" }],
  metadata: {},
};

global.fetch = async (url) => {
  const target = String(url);
  if (target.endsWith("/releases/latest")) {
    return new Response(JSON.stringify({
      draft: false,
      prerelease: false,
      tag_name: "stashr-v2.3.1-build-100123",
      assets: [
        { name: "ota-manifest.json", url: "https://api.github.com/repos/x/y/releases/assets/1", size: 10 },
        { name: "bundlehash.hbc", url: "https://api.github.com/repos/x/y/releases/assets/2", size: bundleBytes.length },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (target.endsWith("/releases/assets/1")) {
    return new Response(JSON.stringify(manifest), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (target.endsWith("/releases/assets/2")) {
    return new Response(bundleBytes, { status: 200, headers: { "content-type": "application/octet-stream" } });
  }
  return new Response("not found", { status: 404 });
};

const app = require("../app");

const protocolHeaders = {
  "expo-protocol-version": "1",
  "expo-platform": "android",
  "expo-runtime-version": "2.3.1",
};

test("OTA manifest returns 204 when the runtime version does not match", async () => {
  const response = await request(app).get("/api/ota/manifest").set({ ...protocolHeaders, "expo-runtime-version": "9.9.9" });
  assert.equal(response.status, 204);
});

test("OTA manifest returns a multipart Expo response with server-hosted asset URLs", async () => {
  const response = await request(app)
    .get("/api/ota/manifest")
    .set(protocolHeaders)
    .buffer(true)
    .parse((res, callback) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => callback(null, text));
    });
  assert.equal(response.status, 200);
  response.text = response.body;
  assert.equal(response.headers["expo-protocol-version"], "1");
  assert.match(response.headers["content-type"], /^multipart\/mixed; boundary=/);
  assert.match(response.text, /name="manifest"/);
  assert.match(response.text, /"id":"5c6b8a2e-1f3d-4b7a-9e0f-2d4c6a8b0e1f"/);
  assert.match(response.text, /\/api\/ota\/asset\/bundlehash\.hbc/);
  assert.doesNotMatch(response.text, /fileName/);
});

test("OTA manifest rejects requests that are not android protocol v1", async () => {
  const response = await request(app).get("/api/ota/manifest").set({ ...protocolHeaders, "expo-platform": "ios" });
  assert.equal(response.status, 400);
});

test("OTA asset endpoint streams the published bundle", async () => {
  const response = await request(app)
    .get("/api/ota/asset/bundlehash.hbc")
    .buffer(true)
    .parse((res, callback) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => callback(null, Buffer.concat(chunks)));
    });
  assert.equal(response.status, 200);
  assert.equal(response.body.toString(), bundleBytes);
});

test.after(() => {
  global.fetch = originalFetch;
});
