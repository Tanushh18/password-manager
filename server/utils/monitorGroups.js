/* Pure: the automatic monitoring groups ("every running service, grouped by app"). No I/O. */
const { repoKey } = require("./projectLink");

const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);
const isAutoGroup = (id) => String(id || "").startsWith("auto-");

/**
 * services: [{ id, name, repo, suspended, accountId }] from every connected account.
 * Running services that are not already in one of your own groups are grouped by GitHub repo (one group per app;
 * a service with no repo is its own group). Ids are stable ("auto-<owner>-<repo>") so incidents keep their history.
 */
function buildAutoGroups(services, manualGroups = []) {
  const covered = new Set((manualGroups || []).flatMap((g) => g.serviceKeys || []));
  const groups = new Map();
  for (const s of services || []) {
    if (!s || s.suspended || !s.id || !s.accountId) continue;
    const key = s.accountId + ":" + s.id;
    if (covered.has(key)) continue;
    const repo = repoKey(s.repo);
    const id = "auto-" + (repo ? slug(repo.replace("/", "-")) : "svc-" + slug(s.id));
    if (!groups.has(id)) groups.set(id, { id, name: repo ? repo.split("/")[1] : s.name || s.id, serviceKeys: [], dependencies: [], serviceCostEstimates: {}, monthlyBudgetUsd: 0, auto: true });
    groups.get(id).serviceKeys.push(key);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { buildAutoGroups, isAutoGroup };
