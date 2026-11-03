/**
 * The newest release of one of the small Android apps (Hub, TV, Cast, Location), found through GitHub's public web pages instead of
 * api.github.com. The API allows only 60 calls an hour to a server without a token, and Render's shared address often hits that, which
 * made the download buttons on /apps answer 502. The release feed and the release files are ordinary web downloads without that limit.
 *
 * app = { pkg, prefix, apk, manifest, label }. Returns the same shape the API path builds, with `directUrl` for the APK.
 */
async function latestFromFeed(repo, app, fetchImpl = fetch) {
  const headers = { "User-Agent": "Stashr-Android-Updater" };
  const feed = await fetchImpl(`https://github.com/${repo}/releases.atom`, { headers, signal: AbortSignal.timeout(10_000) });
  if (!feed.ok) throw Object.assign(new Error(`GitHub feed returned HTTP ${feed.status}`), { status: 502 });
  const xml = await feed.text();
  let tag = "", publishedAt = null;
  for (const entry of xml.match(/<entry>[\s\S]*?<\/entry>/g) || []) {
    const m = /\/releases\/tag\/([^"<>\s]+)"/.exec(entry);
    const t = m ? decodeURIComponent(m[1]) : "";
    if (t.startsWith(app.prefix)) { tag = t; publishedAt = (/<updated>([^<]+)<\/updated>/.exec(entry) || [])[1] || null; break; }
  }
  if (!tag) throw Object.assign(new Error(`No ${app.label} release is published yet.`), { status: 404 });

  const base = `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}`;
  const res = await fetchImpl(`${base}/${app.manifest}`, { headers, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw Object.assign(new Error(`Could not read the ${app.label} release manifest.`), { status: 502 });
  const manifest = await res.json();
  const versionCode = Number(manifest.versionCode);
  if (manifest.packageName !== app.pkg || !Number.isSafeInteger(versionCode) || versionCode < 1 || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(String(manifest.version || "")) ||
      !/^[a-f0-9]{64}$/i.test(String(manifest.sha256 || "")) || !Number.isSafeInteger(Number(manifest.sizeBytes)) || Number(manifest.sizeBytes) < 1) {
    throw Object.assign(new Error(`The ${app.label} release manifest is invalid.`), { status: 502 });
  }
  return {
    version: manifest.version, versionCode, sha256: manifest.sha256.toLowerCase(), sizeBytes: Number(manifest.sizeBytes),
    releaseNotes: String(manifest.releaseNotes || `${app.label} update`), publishedAt, tagName: tag, assetApiUrl: "", directUrl: `${base}/${app.apk}`,
  };
}

module.exports = { latestFromFeed };
