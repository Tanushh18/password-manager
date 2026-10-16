const mongoose = require("mongoose");
const { without } = require("./projection");
const User = require("../models/schema");
const { loadRenderServices, ensureLinks } = require("./projectStatus");
const { loadGithubAccounts } = require("./githubClient");
const { listRepos } = require("./githubRepos");
const { planAutoProjects } = require("./projectPlan");
const { syncProjectEnv } = require("./renderEnvSync");
const dns = require("dns").promises;
const { deriveDetails, apexOf, hostOf } = require("./projectDerive");

const nsCache = new Map(); // apex -> { at, ns }
async function nameserversFor(host) {
  const apex = apexOf(host);
  if (!apex || /onrender\.com$/.test(apex)) return null;
  const hit = nsCache.get(apex);
  if (hit && Date.now() - hit.at < 6 * 3600 * 1000) return hit.ns;
  const ns = await Promise.race([dns.resolveNs(apex).catch(() => []), new Promise((r) => setTimeout(() => r([]), 4000))]);
  if (nsCache.size > 500) nsCache.clear();
  nsCache.set(apex, { at: Date.now(), ns });
  return ns;
}

/*
 * Keeps the Projects list in step with GitHub and Render, with no buttons:
 *   - every repository the connected GitHub tokens can see becomes a project (once)
 *   - every repo running on a connected Render account becomes a project (several deployments = one project)
 *   - links to Render services follow Render (deleted ones drop off, new deployments are added)
 *   - projects Stashr created are archived when their repo disappears, and come back if it returns
 * Projects you added yourself are never changed or removed. Reads GitHub and Render only.
 */
const MAX_ITEMS = 2000;
const THROTTLE_MS = 45 * 1000;
const inflight = new Map();
const last = new Map();

async function patchProject(user, dataKey, id, patch) {
  const entry = (user.projects || []).find((e) => String(e._id) === String(id));
  if (!entry || entry.enc !== "udk") return false;
  const fields = { ...User.publicEntry(entry, dataKey), ...patch };
  ["_id", "createdAt", "updatedAt", "broken"].forEach((k) => delete fields[k]);
  const sealed = User.sealEntry(dataKey, fields);
  await User.updateOne({ _id: user._id, "projects._id": entry._id }, { $set: { "projects.$.enc": "udk", "projects.$.data": sealed, "projects.$.updatedAt": new Date() } });
  entry.enc = "udk"; entry.data = sealed;
  return true;
}

async function run(userId) {
  const user = await User.findById(userId, without("passwords", "renderMetricHistory", "renderIncidents", "renderAudit", "usageHistory"));
  if (!user) return { created: [], archived: 0, revived: 0, refreshed: 0 };
  const dataKey = await user.getDataKey();
  const now = new Date();
  const summary = { created: [], archived: 0, revived: 0, refreshed: 0, github: { accounts: 0, repos: 0, failed: 0 }, render: { accounts: 0, services: 0 }, checkedAt: now.toISOString() };

  /* Render: every service in every connected account */
  let render = { services: [], accounts: new Map(), listed: new Set() };
  if ((user.renderAccounts || []).length) render = await loadRenderServices(user, dataKey, { refresh: true });
  summary.render = { accounts: render.accounts.size, services: render.services.length };
  const renderComplete = render.accounts.size === render.listed.size;

  /* GitHub: every repo every saved token can see */
  const tokens = loadGithubAccounts(user, dataKey);
  const repos = new Map();
  let githubComplete = true;
  for (const account of tokens) {
    const result = await listRepos(account.token);
    if (!result.ok || result.truncated) { githubComplete = false; if (!result.ok) summary.github.failed += 1; }
    for (const r of result.repos || []) if (!repos.has(r.key)) repos.set(r.key, r);
  }
  summary.github.accounts = tokens.length; summary.github.repos = repos.size;

  const projects = (user.projects || []).filter((e) => e.enc === "udk").map((e) => User.publicEntry(e, dataKey));
  const plan = planAutoProjects({
    projects, repos: [...repos.values()], services: render.services,
    complete: { github: githubComplete, render: renderComplete },
    accountName: (id) => render.accounts.get(id)?.name || ""
  });

  const newlyLinked = [];
  if (plan.create.length) {
    if ((user.projects || []).length + plan.create.length > MAX_ITEMS) plan.create.length = Math.max(0, MAX_ITEMS - (user.projects || []).length);
    const docs = plan.create.map((fields) => ({ _id: new mongoose.Types.ObjectId(), enc: "udk", data: User.sealEntry(dataKey, { ...fields, autoSyncedAt: now.toISOString() }), createdAt: now, updatedAt: now }));
    if (docs.length) {
      await User.updateOne({ _id: user._id }, { $push: { projects: { $each: docs } } });
      docs.forEach((d) => user.projects.push(d));
      summary.created = plan.create.slice(0, docs.length).map((f) => f.name);
      docs.forEach((d, i) => { if (plan.create[i].renderServiceId) newlyLinked.push(String(d._id)); });
    }
  }
  for (const id of plan.archive) if (await patchProject(user, dataKey, id, { status: "archived", autoStale: "yes" })) summary.archived += 1;
  for (const { id, status } of plan.revive) if (await patchProject(user, dataKey, id, { status, autoStale: "" })) summary.revived += 1;
  for (const { id, patch } of plan.fill) await patchProject(user, dataKey, id, patch);

  /* Links follow Render; new links pull their env vars */
  if (render.accounts.size) {
    const { refreshed, linkedNow } = await ensureLinks(user, dataKey, render.services, render.accounts, render.listed);
    summary.refreshed = refreshed + linkedNow.length;
    // New projects start with their Render variables already pulled in.
    for (const id of newlyLinked) { try { await syncProjectEnv(user, id, { apply: true, resolveConflicts: false }); } catch { /* retried by the background env sync */ } }
  }
  /* Fill blank details (databases, services used, custom domain, DNS provider) from what each project already has. */
  summary.derived = 0;
  for (const entry of (user.projects || []).filter((e) => e.enc === "udk").slice(0, 100)) {
    try {
      const fields = User.publicEntry(entry, dataKey);
      if (fields.broken) continue;
      const host = hostOf(fields.customDomain ? "https://" + fields.customDomain : fields.liveUrl);
      const nameservers = !String(fields.dnsProvider || "").trim() && host ? await nameserversFor(host) : null;
      const patch = deriveDetails(fields, { nameservers });
      if (patch && await patchProject(user, dataKey, entry._id, patch)) summary.derived += 1;
    } catch { /* one project never blocks the rest */ }
  }
  return summary;
}

/** Throttled and de-duplicated per user, so opening several pages at once costs one sync. */
async function autoSyncProjects(user, { force = false } = {}) {
  const id = String(user._id);
  if (inflight.has(id)) return inflight.get(id);
  const hit = last.get(id);
  if (!force && hit && Date.now() - hit.at < THROTTLE_MS) return { ...hit.summary, throttled: true };
  const promise = run(id).then((summary) => { last.set(id, { at: Date.now(), summary }); return summary; }).finally(() => inflight.delete(id));
  inflight.set(id, promise);
  return promise;
}

/** Background pass for the scheduler tick. One user failing never stops the others. */
async function runAllProjectSync() {
  const summary = { usersChecked: 0, created: 0, archived: 0, errors: 0 };
  const users = await User.find({ $or: [{ "githubAccounts.0": { $exists: true } }, { "renderAccounts.0": { $exists: true } }] }, without("passwords", "renderMetricHistory", "renderIncidents", "renderAudit", "usageHistory")).limit(200);
  for (const user of users) {
    try {
      const r = await autoSyncProjects(user, { force: true });
      summary.usersChecked += 1; summary.created += r.created.length; summary.archived += r.archived;
    } catch { summary.errors += 1; }
  }
  return summary;
}

module.exports = { autoSyncProjects, runAllProjectSync };
