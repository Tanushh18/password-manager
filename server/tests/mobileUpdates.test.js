const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const originalFetch = global.fetch;
const manifest = {
  packageName: "com.tanush.stashr.com",
  version: "2.3.1",
  versionCode: 100123,
  buildNumber: 100123,
  sha256: "a".repeat(64),
  sizeBytes: 2_500_000,
  releaseNotes: "Native module fix",
};

global.fetch = async (url) => {
  const target = String(url);
  if (target.endsWith("/releases/latest")) {
    return new Response(JSON.stringify({
      draft: false,
      prerelease: false,
      tag_name: "stashr-v2.3.1-build-100123",
      name: "Stashr Android 2.3.1",
      published_at: "2026-10-28T00:00:00Z",
      assets: [
        { name: "stashr-release.apk", url: "https://api.github.com/repos/Tanushh18/password-manager/releases/assets/123", browser_download_url: "https://github.com/Tanushh18/password-manager/releases/download/test/stashr-release.apk", size: manifest.sizeBytes },
        { name: "stashr-update.json", url: "https://api.github.com/repos/Tanushh18/password-manager/releases/assets/124", browser_download_url: "https://github.com/Tanushh18/password-manager/releases/download/test/stashr-update.json", size: 200 },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (target.endsWith("/releases/assets/124")) {
    return new Response(JSON.stringify(manifest), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (target.endsWith("/releases/assets/123")) {
    return new Response("fake-apk-binary", { status: 200, headers: { "content-type": "application/octet-stream" } });
  }
  throw new Error("Unexpected fetch URL in test: " + target);
};

const app = require("../app");

test("latest Android manifest reports a newer complete APK", async () => {
  const response = await request(app).get("/api/mobile-updates/android/latest?currentVersionCode=100000");
  assert.equal(response.status, 200);
  assert.equal(response.body.appId, "com.tanush.stashr.com");
  assert.equal(response.body.versionCode, 100123);
  assert.equal(response.body.updateAvailable, true);
  assert.match(response.body.downloadUrl, /\/api\/mobile-updates\/android\/download$/);
});

test("latest Android manifest reports no update for current build", async () => {
  const response = await request(app).get("/api/mobile-updates/android/latest?currentVersionCode=100123");
  assert.equal(response.status, 200);
  assert.equal(response.body.updateAvailable, false);
});

test("APK endpoint streams the release asset through the server", async () => {
  const response = await request(app).get("/api/mobile-updates/android/download");
  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/vnd.android.package-archive");
  assert.match(response.headers["content-disposition"], /Stashr-2\.3\.1-build-100123\.apk/);
  assert.equal(response.body.toString(), "fake-apk-binary");
});

test.after(() => {
  global.fetch = originalFetch;
});
