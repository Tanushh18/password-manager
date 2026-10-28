/* Registry drift: a backend address written into an env var that no longer matches a live service of the user's.
   Typical case: an app still points at a Render service that was deleted, suspended, or moved to another account.
   Only *.onrender.com addresses are checked, because those are the ones Render takes away; third-party hosts are left alone.
   Pure: names and hosts only, never the full value. */

const RENDER_HOST = /\.onrender\.com$/i;

function hostOfUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" ? url.hostname.toLowerCase() : "";
  } catch { return ""; }
}

/**
 * vars:          [{ key, value }] of one service
 * liveServices:  [{ url, suspended }] of the user's Render services (all accounts)
 * Returns findings for env vars that point at a Render host with no live service behind it.
 */
function findStaleAddresses(vars, liveServices) {
  const live = new Set();
  const suspended = new Set();
  for (const s of liveServices || []) {
    const host = hostOfUrl(s.url);
    if (!host) continue;
    (s.suspended ? suspended : live).add(host);
  }
  const findings = [];
  for (const { key, value } of vars || []) {
    const host = hostOfUrl(value);
    if (!host || !RENDER_HOST.test(host) || live.has(host)) continue;
    findings.push({
      name: String(key),
      host,
      status: suspended.has(host) ? "suspended" : "missing",
      severity: suspended.has(host) ? "medium" : "high"
    });
  }
  return findings.sort((a, b) => (a.severity === b.severity ? a.name.localeCompare(b.name) : a.severity === "high" ? -1 : 1));
}

module.exports = { findStaleAddresses, hostOfUrl };
