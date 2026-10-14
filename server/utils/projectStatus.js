const User = require("../models/schema");
const renderOps = require("./renderOps");
const { fetchAllPages } = require("./renderPaging");
const { mapWithConcurrency } = require("./renderGuards");
const { matchService, linkPatch } = require("./projectLink");
const { projectHealth, openIncidentCount } = require("./projectHealth");
const { parseGithubRepo, ciSummary, shapeCompare } = require("./github");
const { githubGet, loadGithubAccounts, resolveRepo } = require("./githubClient");
const { syncProjectEnv } = require("./renderEnvSync");

/*
 * Fully automatic project upkeep, with no buttons involved:
 *   1. link each project to its Render service (only when the match is unambiguous) and fill empty fields
 *   2. pull the service's env vars into the project (the first sync happens right after linking)
 *   3. compute deploy drift (undeployed commits), CI and a health score from live Render + GitHub data
 * Reads only from Render and GitHub. Nothing here ever writes to either of them.
 */
const SERVICES_TTL_MS = 2 * 60 * 1000;
const STATUS_TTL_MS = 2 * 60 * 1000;
const STRIP = ["_id", "createdAt", "updatedAt", "broken"];
const servicesCache = new Map();
const statusCache = new Map();

const flatService = (s, account) => ({
  id: s.id, name: String(s.name || s.id), type: s.type || "", repo: s.repo || "", branch: s.branch || "",
  suspended: s.suspended === "suspended", url: s.serviceDetails?.url || "", region: s.serviceDetails?.region || "",
  plan: s.serviceDetails?.plan || s.serviceDetails?.buildPlan || "", dashboardUrl: s.dashboardUrl || "",
  accountId: account.id, accountName: account.name
});

/** Every service in every connected Render account (cached briefly). Failed accounts are skipped, not fatal. */
async function loadRenderServices(user, dataKey, { refresh = false } = {}) {
  const key = String(user._id);
  const hit = servicesCache.get(key);
  if (hit && !refresh && Date.now() - hit.at < SERVICES_TTL_MS) return hit.data;
  const accounts = new Map();
  for (const entry of user.renderAccounts || []) {
    if (entry.enc !== "udk") continue;
    const fields = User.publicEntry(entry, dataKey);
    if (fields?.apiKey) accounts.set(String(entry._id), { id: String(entry._id), name: fields.name || "Render account", apiKey: fields.apiKey });
  }
  const services = [];
  await mapWithConcurrency([...accounts.values()], 3, async (account) => {
    try {
      const listing = await fetchAllPages((path) => renderOps.renderRequest(account.apiKey, path), "/v1/services");
      for (const item of listing.items) { const s = item?.service || item; if (s?.id) services.push(flatService(s, account)); }
    } catch { /* one account failing must not hide the others */ }
    return null;
  });
  const data = { services, accounts };
  servicesCache.set(key, { at: Date.now(), data });
  return data;
}

async function saveProjectFields(user, dataKey, entry, fields) {
  const next = { ...fields };
  STRIP.forEach((k) => delete next[k]);
  const sealed = User.sealEntry(dataKey, next);
  await User.updateOne(
    { _id: user._id, "projects._id": entry._id },
    { $set: { "projects.$.enc": "udk", "projects.$.data": sealed, "projects.$.updatedAt": new Date() } }
  );
  entry.enc = "udk";
  entry.data = sealed;
}

const isLinked = (f) => Boolean(f.renderAccountId && f.renderServiceId);

/** Auto-links every unlinked project it can match confidently, then pulls env vars for the new links. */
async function ensureLinks(user, dataKey, services, accounts) {
  const linkedNow = [];
  const ambiguous = new Map();
  for (const entry of user.projects || []) {
    if (entry.enc !== "udk") continue;
    const fields = User.publicEntry(entry, dataKey);
    if (fields.broken || isLinked(fields) || fields.renderAutoLinked === "off") continue;
    const match = matchService(fields, services);
    if (match.ambiguous) { ambiguous.set(String(entry._id), match.ambiguous); continue; }
    if (!match.service) continue;
    const patch = linkPatch(fields, match.service, accounts.get(match.service.accountId)?.name);
    try {
      await saveProjectFields(user, dataKey, entry, { ...fields, ...patch });
      linkedNow.push({ projectId: String(entry._id), serviceName: match.service.name });
    } catch { /* leave it unlinked; it will be retried on the next pass */ }
  }
  for (const link of linkedNow) {
    try { await syncProjectEnv(user, link.projectId, { apply: true, resolveConflicts: false }); } catch { /* retried by the background pass */ }
  }
  return { linkedNow, ambiguous };
}

async function latestDeploys(account, serviceId) {
  try {
    const rows = await renderOps.renderRequest(account.apiKey, "/v1/services/" + encodeURIComponent(serviceId) + "/deploys?limit=5");
    const list = (Array.isArray(rows) ? rows : []).map((r) => r?.deploy || r).filter(Boolean)
      .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
    const brief = (d) => d ? { status: String(d.status || "unknown"), at: d.finishedAt || d.createdAt || null, sha: String(d.commit?.id || "").slice(0, 7), fullSha: String(d.commit?.id || ""), message: String(d.commit?.message || "").split("\n")[0].slice(0, 120) } : null;
    return { latest: brief(list[0]), live: brief(list.find((d) => d.status === "live")) };
  } catch { return null; }
}

async function projectStatus(ctx, entry, fields, extras = {}) {
  const projectId = String(entry._id);
  const out = { projectId, linked: isLinked(fields), autoLinked: fields.renderAutoLinked === "yes", ambiguous: extras.ambiguous || null, service: null, deploy: null, live: null, drift: null, ci: null, github: null, partial: [], checkedAt: new Date().toISOString() };
  const signals = { autoSync: fields.renderAutoSync };

  const service = out.linked ? ctx.services.find((s) => s.accountId === fields.renderAccountId && s.id === fields.renderServiceId) : null;
  if (out.linked && !service) out.partial.push("linked Render service not found");
  if (service) {
    out.service = { name: service.name, accountName: service.accountName, suspended: service.suspended, region: service.region, plan: service.plan, url: service.url, dashboardUrl: service.dashboardUrl, branch: service.branch };
    signals.suspended = service.suspended;
    const account = ctx.accounts.get(service.accountId);
    const deploys = account ? await latestDeploys(account, service.id) : null;
    if (deploys) { out.deploy = deploys.latest; out.live = deploys.live; signals.deployStatus = deploys.latest?.status; }
    else out.partial.push("deployments");
    signals.openIncidents = openIncidentCount(ctx.incidents, service.accountId + ":" + service.id);
  }
  if (Date.parse(fields.renderSyncedAt)) signals.envSyncAgeHours = (Date.now() - Date.parse(fields.renderSyncedAt)) / 3600000;

  const target = parseGithubRepo(fields.repoUrl || service?.repo);
  if (target && ctx.github.length) {
    const resolved = await resolveRepo(ctx.github, target);
    if (resolved.error) { out.github = { connected: true, error: resolved.error.message }; out.partial.push("GitHub"); }
    else {
      const { repo, used, base } = resolved;
      const branch = service?.branch || repo.default_branch || "";
      out.github = { connected: true, fullName: repo.full_name, url: repo.html_url, branch };
      const runs = await githubGet(used.token, base + "/actions/runs?per_page=5&branch=" + encodeURIComponent(branch));
      if (runs.ok) { out.ci = ciSummary(runs.body?.workflow_runs, branch); if (out.ci) { signals.ciState = out.ci.state; signals.ciBranch = branch; } }
      else out.partial.push("CI");
      if (out.live?.fullSha && branch) {
        const compare = await githubGet(used.token, base + "/compare/" + encodeURIComponent(out.live.fullSha) + "..." + encodeURIComponent(branch));
        const drift = compare.ok ? shapeCompare(compare.body, branch) : null;
        if (drift) { out.drift = drift; signals.driftStatus = drift.status; signals.behindBy = drift.behindBy; signals.branch = branch; }
        else out.partial.push("deploy drift");
      }
    }
  } else if (target && !ctx.github.length) out.github = { connected: false };

  out.health = projectHealth(signals);
  return out;
}

/** Statuses for all of a user's projects (or one). Also performs auto-linking first. */
async function getProjectStatuses(user, { only = "", refresh = false } = {}) {
  const dataKey = await user.getDataKey();
  const cacheKey = String(user._id) + ":" + (only || "*");
  const hit = statusCache.get(cacheKey);
  if (hit && !refresh && Date.now() - hit.at < STATUS_TTL_MS) return hit.data;

  const { services, accounts } = hasNoRenderAccounts(user) ? { services: [], accounts: new Map() } : await loadRenderServices(user, dataKey, { refresh });
  const { linkedNow, ambiguous } = accounts.size ? await ensureLinks(user, dataKey, services, accounts) : { linkedNow: [], ambiguous: new Map() };
  if (linkedNow.length) for (const key of [...statusCache.keys()]) if (key.startsWith(String(user._id) + ":")) statusCache.delete(key);

  const ctx = {
    services, accounts, github: loadGithubAccounts(user, dataKey),
    incidents: renderOps.encryptedList(user, "renderIncidents", dataKey, 200)
  };
  const entries = (user.projects || []).filter((e) => e.enc === "udk" && (!only || String(e._id) === only));
  const statuses = (await mapWithConcurrency(entries, 3, async (entry) => {
    const fields = User.publicEntry(entry, dataKey);
    if (fields.broken) return null;
    return projectStatus(ctx, entry, fields, { ambiguous: ambiguous.get(String(entry._id)) });
  })).filter(Boolean);
  const data = { statuses, linkedNow, checkedAt: new Date().toISOString() };
  statusCache.set(cacheKey, { at: Date.now(), data });
  return data;
}

const hasNoRenderAccounts = (user) => !(user.renderAccounts || []).length;

/** Background pass for the scheduler tick: link + first sync for every user's unlinked projects. */
async function runAllAutoLink() {
  const summary = { usersChecked: 0, projectsLinked: 0, errors: 0 };
  const users = await User.find({ "projects.0": { $exists: true }, "renderAccounts.0": { $exists: true } }).limit(1000);
  for (const user of users) {
    try {
      const dataKey = await user.getDataKey();
      const unlinked = (user.projects || []).some((e) => {
        if (e.enc !== "udk") return false;
        const f = User.publicEntry(e, dataKey);
        return !f.broken && !isLinked(f) && f.renderAutoLinked !== "off";
      });
      if (!unlinked) continue;
      summary.usersChecked += 1;
      const { services, accounts } = await loadRenderServices(user, dataKey, { refresh: true });
      const { linkedNow } = await ensureLinks(user, dataKey, services, accounts);
      summary.projectsLinked += linkedNow.length;
      if (linkedNow.length) statusCache.clear();
    } catch { summary.errors += 1; }
  }
  return summary;
}

module.exports = { getProjectStatuses, runAllAutoLink, loadRenderServices, ensureLinks };
