/* Pure planning for the Servers tab: match registry URLs to Render services and decide safe changes. */
const { repoKey } = require("./projectLink");

const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } };
const isRenderHost = (host) => /\.onrender\.com$/.test(host);
const pathOf = (url) => { try { return new URL(url).pathname.replace(/\/+$/, ""); } catch { return ""; } };

/**
 * urls:     the app's registry list
 * services: [{ id, name, repo, suspended, url, accountName, plan, region, dashboardUrl }]  (url = service public URL)
 */
function planRegistrySync(urls, services) {
  const byHost = new Map();
  for (const s of services || []) { const h = hostOf(s.url); if (h) byHost.set(h, s); }

  const items = (urls || []).map((url) => {
    const host = hostOf(url);
    if (!isRenderHost(host)) return { url, kind: "external", service: null };
    const service = byHost.get(host) || null;
    return { url, kind: service ? "render" : "unmatched", service };
  });

  // Safe removal: a suspended Render service is dead weight, but never remove the last working URL.
  const isDead = (item) => item.service && item.service.suspended === true;
  const working = items.filter((item) => !isDead(item));
  const remove = working.length ? items.filter(isDead).map((item) => item.url) : [];

  // Suggestions (one click, never automatic): live sibling services from the same repo.
  const repos = new Set(items.filter((i) => i.service).map((i) => repoKey(i.service.repo)).filter(Boolean));
  const suffixes = [...new Set(items.filter((i) => i.service).map((i) => pathOf(i.url)))];
  const suffix = suffixes.length === 1 ? suffixes[0] : "";
  const listed = new Set(items.map((i) => hostOf(i.url)));
  const add = [];
  for (const s of services || []) {
    const host = hostOf(s.url);
    if (!host || !isRenderHost(host) || listed.has(host) || s.suspended === true) continue;
    if (!repos.has(repoKey(s.repo))) continue;
    add.push({ url: (new URL(s.url).origin + suffix), name: s.name, accountName: s.accountName || "", reason: "Running service from the same repository" });
    if (add.length >= 5) break;
  }
  return { items, remove, add };
}

/** Applies planned removals and guarantees a non-empty list. */
function applyRemovals(urls, remove) {
  const drop = new Set(remove || []);
  const next = (urls || []).filter((u) => !drop.has(u));
  return next.length ? next : urls;
}

module.exports = { planRegistrySync, applyRemovals, hostOf };
