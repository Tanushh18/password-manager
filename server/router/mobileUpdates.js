const express = require("express");
const { Readable } = require("node:stream");

const router = express.Router();
const GITHUB_REPOSITORY = process.env.STASHR_UPDATE_REPOSITORY || "Tanushh18/password-manager";
const EXPECTED_PACKAGE = "com.tanush.stashr.com";
const CACHE_MS = 60_000;
let cachedRelease = null;
let cachedAt = 0;

async function githubJson(url) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Stashr-Android-Updater",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.STASHR_UPDATE_GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.STASHR_UPDATE_GITHUB_TOKEN}`;
  }
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    const error = new Error(`Release service returned HTTP ${response.status}`);
    error.status = response.status === 404 ? 404 : 502;
    throw error;
  }
  return response.json();
}

async function latestRelease() {
  if (cachedRelease && Date.now() - cachedAt < CACHE_MS) return cachedRelease;

  const release = await githubJson(`https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest`);
  if (release.draft || release.prerelease) {
    const error = new Error("No stable Stashr Android release is published yet.");
    error.status = 404;
    throw error;
  }

  const apk = (release.assets || []).find((asset) => asset.name === "stashr-release.apk");
  const manifestAsset = (release.assets || []).find((asset) => asset.name === "stashr-update.json");
  if (!apk || !manifestAsset || !apk.browser_download_url || !manifestAsset.browser_download_url) {
    const error = new Error("The latest release is missing its APK or update manifest.");
    error.status = 503;
    throw error;
  }

  const manifestResponse = await fetch(manifestAsset.url, {
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "Stashr-Android-Updater",
      ...(process.env.STASHR_UPDATE_GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.STASHR_UPDATE_GITHUB_TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!manifestResponse.ok) {
    const error = new Error("Could not read the latest release manifest.");
    error.status = 502;
    throw error;
  }
  const manifest = await manifestResponse.json();
  const versionCode = Number(manifest.versionCode);
  if (manifest.packageName !== EXPECTED_PACKAGE || !Number.isSafeInteger(versionCode) || versionCode < 1 ||
      typeof manifest.version !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(manifest.version)) {
    const error = new Error("The latest Android release manifest is invalid.");
    error.status = 502;
    throw error;
  }

  cachedRelease = {
    version: manifest.version,
    versionCode,
    buildNumber: Number(manifest.buildNumber || versionCode),
    packageName: EXPECTED_PACKAGE,
    sha256: String(manifest.sha256 || ""),
    sizeBytes: Number(manifest.sizeBytes || apk.size || 0),
    releaseNotes: String(manifest.releaseNotes || release.name || "Stashr update"),
    publishedAt: release.published_at || null,
    tagName: release.tag_name,
    downloadUrl: apk.browser_download_url,
    assetApiUrl: apk.url,
  };
  cachedAt = Date.now();
  return cachedRelease;
}

router.get("/android/latest", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const release = await latestRelease();
    const currentVersionCode = Number.parseInt(String(req.query.currentVersionCode || "0"), 10) || 0;
    const origin = `${req.protocol}://${req.get("host")}`;
    return res.json({
      appId: release.packageName,
      version: release.version,
      versionCode: release.versionCode,
      buildNumber: release.buildNumber,
      sha256: release.sha256,
      sizeBytes: release.sizeBytes,
      releaseNotes: release.releaseNotes,
      publishedAt: release.publishedAt,
      tagName: release.tagName,
      updateAvailable: currentVersionCode < release.versionCode,
      downloadUrl: `${origin}/api/mobile-updates/android/download`,
    });
  } catch (error) {
    return res.status(error.status || 502).json({
      error: "Android update information is temporarily unavailable.",
      detail: process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  }
});

router.get("/android/download", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const release = await latestRelease();
    const headers = {
      Accept: "application/octet-stream",
      "User-Agent": "Stashr-Android-Updater",
      ...(process.env.STASHR_UPDATE_GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.STASHR_UPDATE_GITHUB_TOKEN}` } : {}),
    };
    const response = await fetch(release.assetApiUrl, { headers, signal: AbortSignal.timeout(30_000) });
    if (!response.ok || !response.body) {
      const error = new Error(`GitHub asset download returned HTTP ${response.status}`);
      error.status = 502;
      throw error;
    }
    res.status(200);
    res.set("Content-Type", "application/vnd.android.package-archive");
    res.set("Content-Disposition", `attachment; filename="Stashr-${release.version}-build-${release.versionCode}.apk"`);
    res.set("X-Content-Type-Options", "nosniff");
    if (release.sizeBytes > 0) res.set("Content-Length", String(release.sizeBytes));
    return Readable.fromWeb(response.body).pipe(res);
  } catch (error) {
    if (res.headersSent) return res.destroy(error);
    return res.status(error.status || 502).json({
      error: "The latest Android APK is not available yet.",
      detail: process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  }
});

module.exports = router;
