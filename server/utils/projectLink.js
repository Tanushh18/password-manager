/* Pure helpers: automatically linking a project to its Render service. No I/O. */
const { parseGithubRepo } = require("./github");

const norm = (value) => String(value || "").trim().toLowerCase();
const repoKey = (url) => {
  const parsed = parseGithubRepo(url);
  return parsed ? (parsed.owner + "/" + parsed.repo).toLowerCase() : "";
};

/**
 * Finds the Render service a project belongs to. Services: [{ id, name, repo, suspended, accountId }].
 * Conservative on purpose: it only links when the answer is unambiguous.
 *   1. Same GitHub repo; if several services share the repo, the one whose name equals the project's
 *      "hosting service name" (then the project name) wins; a single repo match wins outright.
 *   2. No repo URL on the project: a service whose name equals the hosting service name / project name,
 *      if exactly one does.
 * A project whose repo URL matches nothing is left alone (name matching would risk a wrong link).
 */
function matchService(project, services) {
  const list = Array.isArray(services) ? services : [];
  const wanted = [project?.hostingServiceName, project?.name].map(norm).filter(Boolean);
  const narrow = (candidates) => {
    for (const name of wanted) {
      const hits = candidates.filter((s) => norm(s.name) === name);
      if (hits.length === 1) return hits[0];
    }
    return null;
  };
  const key = repoKey(project?.repoUrl);
  if (key) {
    const byRepo = list.filter((s) => repoKey(s.repo) === key);
    if (!byRepo.length) return { none: true };
    const hit = byRepo.length === 1 ? byRepo[0] : narrow(byRepo);
    return hit ? { service: hit } : { ambiguous: byRepo.length };
  }
  if (!wanted.length) return { none: true };
  const named = list.filter((s) => wanted.includes(norm(s.name)));
  const hit = named.length === 1 ? named[0] : narrow(named);
  return hit ? { service: hit } : named.length > 1 ? { ambiguous: named.length } : { none: true };
}

const present = (value) => String(value || "").trim() !== "";

/**
 * Fields to save when a project is auto-linked. Existing project data is NEVER overwritten: hosting
 * details are only filled where the project has nothing yet.
 */
function linkPatch(project, service, accountName) {
  const patch = {
    renderAccountId: service.accountId, renderServiceId: service.id, renderServiceName: service.name,
    renderAutoSync: "on", renderAutoLinked: "yes"
  };
  const fill = (field, value) => { if (!present(project?.[field]) && present(value)) patch[field] = String(value); };
  fill("repoUrl", service.repo);
  fill("hostingProvider", "Render");
  fill("hostingServiceName", service.name);
  fill("hostingAccountLabel", accountName);
  fill("hostingRegion", service.region);
  fill("hostingPlan", service.plan);
  fill("autoDeployBranch", service.branch);
  if (/^https:\/\//i.test(String(service.url || ""))) fill("liveUrl", service.url);
  return patch;
}

/**
 * Keeps a linked project in step with Render. `services` is everything currently on Render; `listed` is the set
 * of account ids whose service list loaded (services in other accounts are kept as they are, never dropped).
 *   - renderServices becomes every service deployed from the project's repo, in every account
 *   - a primary link to a deleted service moves to a running one from the same repo, or is cleared
 * Returns the fields to change, or null when nothing changed.
 */
function refreshLinks(project, services, listed) {
  const list = Array.isArray(services) ? services : [];
  if (!(project?.renderAccountId && project?.renderServiceId)) return null; // linking itself stays with matchService
  const known = (accountId) => listed.has(String(accountId));
  const exists = (accountId, id) => list.some((s) => s.accountId === accountId && s.id === id);
  const key = repoKey(project?.repoUrl);
  const prev = Array.isArray(project?.renderServices) ? project.renderServices : [];
  const fromRepo = key ? list.filter((s) => repoKey(s.repo) === key) : [];
  const next = [
    ...fromRepo.map((s) => ({ accountId: s.accountId, serviceId: s.id, name: s.name })),
    ...prev.filter((s) => s && !known(s.accountId) && !fromRepo.some((f) => f.id === s.serviceId))
  ];
  const patch = {};
  const linked = project?.renderAccountId && project?.renderServiceId;
  if (linked && known(project.renderAccountId) && !exists(project.renderAccountId, project.renderServiceId)) {
    const pick = fromRepo.find((s) => !s.suspended) || fromRepo[0];
    Object.assign(patch, pick
      ? { renderAccountId: pick.accountId, renderServiceId: pick.id, renderServiceName: pick.name }
      : { renderAccountId: "", renderServiceId: "", renderServiceName: "" });
  }
  // Only projects with several deployments (now or before) carry the list; single-service projects stay as they were.
  const shown = next.length > 1 || prev.length ? next : prev;
  if (JSON.stringify(shown) !== JSON.stringify(prev)) patch.renderServices = shown;
  return Object.keys(patch).length ? patch : null;
}

module.exports = { matchService, linkPatch, repoKey, refreshLinks };
