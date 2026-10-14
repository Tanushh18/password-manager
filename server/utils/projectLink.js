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

module.exports = { matchService, linkPatch, repoKey };
