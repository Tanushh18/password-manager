// Turns `npx expo export --platform android` output into the files the Stashr server
// serves over the Expo Updates protocol. Every file is content-addressed by its SHA-256,
// so the server can stream them and the app can verify each one before using it.
//
// Usage: node scripts/build-ota-bundle.js <runtimeVersion> [exportDir=dist] [outDir=ota]
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const [runtimeVersion, exportDir = "dist", outDir = "ota"] = process.argv.slice(2);
if (!runtimeVersion) {
  console.error("runtimeVersion is required");
  process.exit(1);
}

const CONTENT_TYPES = {
  hbc: "application/javascript",
  js: "application/javascript",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  otf: "font/otf",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  json: "application/json",
};

function base64UrlSha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("base64url");
}

function publish(sourcePath, extension) {
  const buffer = fs.readFileSync(sourcePath);
  const hash = base64UrlSha256(buffer);
  const fileName = `${hash}.${extension}`;
  fs.copyFileSync(sourcePath, path.join(outDir, fileName));
  return { hash, fileName, contentType: CONTENT_TYPES[extension] || "application/octet-stream" };
}

const metadata = JSON.parse(fs.readFileSync(path.join(exportDir, "metadata.json"), "utf8"));
const android = metadata.fileMetadata && metadata.fileMetadata.android;
if (!android || !android.bundle) {
  console.error("metadata.json has no android bundle; run `npx expo export --platform android` first");
  process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const bundleExtension = path.extname(android.bundle).slice(1) || "hbc";
const bundle = publish(path.join(exportDir, android.bundle), bundleExtension);
const assets = (android.assets || []).map((asset) => {
  const published = publish(path.join(exportDir, asset.path), asset.ext);
  return {
    key: path.basename(asset.path),
    contentType: published.contentType,
    fileExtension: `.${asset.ext}`,
    hash: published.hash,
    fileName: published.fileName,
  };
});

const manifest = {
  id: crypto.randomUUID(),
  createdAt: new Date().toISOString(),
  runtimeVersion,
  launchAsset: { key: "bundleJS", contentType: bundle.contentType, hash: bundle.hash, fileName: bundle.fileName },
  assets,
  metadata: {},
};
fs.writeFileSync(path.join(outDir, "ota-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`OTA runtime ${runtimeVersion}: 1 bundle, ${assets.length} assets -> ${outDir}/`);
