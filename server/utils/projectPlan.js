/* Pure planning for automatic project sync: which projects to create, archive, revive or fill. No I/O. */
const { repoKey, linkPatch } = require("./projectLink");
const { parseGithubRepo } = require("./github");

const nameKey = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const cleanUrl = (url) => String(url || "").replace(/\.git$/i, "").replace(/\/+$/, "");

/**
 * projects: decrypted project fields ({ _id, name, repoUrl, status, autoSource, autoStale, ... })
 * repos:    GitHub repos from every connected token ({ key, owner, name, url, description, language, archived })
 * services: Render services ({ id, name, repo, suspended, accountId, ... })
 * complete: { github, render } - true only when every connection was read in full, so a failed or partial read
 *           can never make a project look stale.
 *
 * Rules: projects you added yourself are never changed or removed. Only projects Stashr created (autoSource)
 * can be archived, and archiving is reversible: they come back when the repo does.
 */
function planAutoProjects({ projects = [], repos = [], services = [], complete = { github: true, render: true }, accountName = () => "" }) {
  const live = projects.filter((p) => p && !p.broken);
  const byRepo = new Map();
  const handNames = new Set();
  for (const p of live) {
    const key = repoKey(p.repoUrl);
    if (key) byRepo.set(key, [...(byRepo.get(key) || []), p]);
    else if (nameKey(p.name)) handNames.add(nameKey(p.name));
  }

  const renderByKey = new Map();
  for (const s of services) {
    const key = repoKey(s.repo);
    if (key) renderByKey.set(key, [...(renderByKey.get(key) || []), s]);
  }
  const githubByKey = new Map(repos.map((r) => [r.key, r]));

  const covered = (key, name) => byRepo.has(key) || handNames.has(nameKey(name));

  // Candidates: every GitHub repo, plus any repo running on Render that no token can see.
  const create = [];
  const keys = new Set([...githubByKey.keys(), ...[...renderByKey].filter(([, list]) => list.some((s) => !s.suspended)).map(([k]) => k)]);
  for (const key of keys) {
    const repo = githubByKey.get(key);
    const list = renderByKey.get(key) || [];
    const running = list.filter((s) => !s.suspended);
    const parsed = parseGithubRepo(repo?.url || list[0]?.repo);
    const name = repo?.name || parsed?.repo || list[0]?.name;
    if (!name || covered(key, name)) continue;
    const base = {
      name,
      description: repo?.description || "",
      techStack: repo?.language || "",
      repoUrl: cleanUrl(repo?.url || list[0]?.repo),
      repoAccount: repo?.owner || parsed?.owner || "",
      status: repo?.archived ? "archived" : running.length ? "deployed" : "in_progress",
      priority: "medium",
      autoSource: repo ? "github" : "render",
      envVars: [], databases: [], extraFields: []
    };
    const main = running[0];
    const fields = main ? { ...base, ...linkPatch(base, main, accountName(main.accountId)), renderAutoLinked: "yes" } : base;
    if (list.length > 1) fields.renderServices = list.map((s) => ({ accountId: s.accountId, serviceId: s.id, name: s.name, url: s.url || "", suspended: Boolean(s.suspended) }));
    create.push(fields);
  }

  // Projects Stashr created: archive when the repo is gone everywhere, revive when it comes back, fill blanks.
  const archive = [], revive = [], fill = [];
  for (const p of live) {
    if (!p.autoSource) continue;
    const key = repoKey(p.repoUrl);
    if (!key) continue;
    const present = githubByKey.has(key) || (renderByKey.get(key) || []).length > 0;
    if (!present && complete.github && complete.render && p.autoStale !== "yes" && p.status !== "archived") archive.push(String(p._id));
    if (present && p.autoStale === "yes") revive.push({ id: String(p._id), status: (renderByKey.get(key) || []).some((s) => !s.suspended) ? "deployed" : "in_progress" });
    const repo = githubByKey.get(key);
    const patch = {};
    if (repo?.description && !String(p.description || "").trim()) patch.description = repo.description;
    if (repo?.language && !String(p.techStack || "").trim()) patch.techStack = repo.language;
    if (Object.keys(patch).length) fill.push({ id: String(p._id), patch });
  }
  return { create, archive, revive, fill };
}

module.exports = { planAutoProjects, nameKey };
