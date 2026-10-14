const mongoose = require("mongoose");
const User = require("../models/schema");
const { loadRenderServices, ensureLinks } = require("./projectStatus");
const { repoKey, linkPatch } = require("./projectLink");
const { parseGithubRepo } = require("./github");
const { duplicateGroups, pickPrimary, mergeProjects } = require("./projectMerge");
const { syncProjectEnv } = require("./renderEnvSync");

/*
 * "Sync with Render": make the Projects page match every connected Render account.
 *   1. merge projects that are the same app (same GitHub repo)
 *   2. create a project for each repo running on Render that has none yet (several deployments = one project)
 *   3. refresh every project's links (deleted services dropped) and pull env vars into the new projects
 * Reads Render only; never changes anything on Render or GitHub.
 */
const MAX_ITEMS = 2000;

async function syncAllProjects(user) {
  const dataKey = await user.getDataKey();
  const summary = { merged: 0, created: [], conflicts: [] };

  /* 1. merge duplicates */
  const read = () => (user.projects || []).filter((e) => e.enc === "udk").map((e) => ({ entry: e, fields: User.publicEntry(e, dataKey) }));
  const groups = duplicateGroups(read().map(({ fields }) => fields)).filter((g) => !g.key.startsWith("name:"));
  for (const group of groups) {
    const projects = read().filter(({ fields }) => group.ids.includes(String(fields._id))).map(({ fields }) => fields);
    if (projects.length < 2) continue;
    const primary = pickPrimary(projects);
    const others = projects.filter((p) => p !== primary);
    const { fields, conflicts } = mergeProjects(primary, others);
    await User.updateOne({ _id: user._id, "projects._id": primary._id }, { $set: { "projects.$.enc": "udk", "projects.$.data": User.sealEntry(dataKey, fields), "projects.$.updatedAt": new Date() } });
    await User.updateOne({ _id: user._id }, { $pull: { projects: { _id: { $in: others.map((p) => p._id) } } } });
    summary.merged += others.length;
    if (conflicts.length) summary.conflicts.push({ name: fields.name, vars: conflicts });
  }

  /* 2. one project per repo deployed on Render */
  const fresh = await User.findById(user._id);
  const { services, accounts, listed } = await loadRenderServices(fresh, dataKey, { refresh: true });
  const projects = (fresh.projects || []).filter((e) => e.enc === "udk").map((e) => User.publicEntry(e, dataKey));
  const haveRepo = new Set(projects.map((p) => repoKey(p.repoUrl)).filter(Boolean));
  const linkedIds = new Set(projects.flatMap((p) => [p.renderServiceId, ...(p.renderServices || []).map((s) => s.serviceId)]).filter(Boolean));
  const byRepo = new Map();
  for (const s of services) {
    const key = repoKey(s.repo) || "id:" + s.id;
    if (!byRepo.has(key)) byRepo.set(key, []);
    byRepo.get(key).push(s);
  }
  const docs = [];
  for (const [key, list] of byRepo) {
    if (haveRepo.has(key) || list.some((s) => linkedIds.has(s.id))) continue;
    const running = list.filter((s) => !s.suspended);
    if (!running.length) continue; // only what is actually deployed
    const main = running[0];
    const name = parseGithubRepo(main.repo)?.repo || main.name;
    const base = { name, status: "deployed", priority: "medium", envVars: [], databases: [], extraFields: [] };
    const fields = { ...base, ...linkPatch(base, main, accounts.get(main.accountId)?.name), renderAutoLinked: "yes" };
    if (list.length > 1) fields.renderServices = list.map((s) => ({ accountId: s.accountId, serviceId: s.id, name: s.name }));
    const now = new Date();
    docs.push({ _id: new mongoose.Types.ObjectId(), enc: "udk", data: User.sealEntry(dataKey, fields), createdAt: now, updatedAt: now });
    summary.created.push(name);
  }
  if (docs.length) {
    if ((fresh.projects || []).length + docs.length > MAX_ITEMS) throw Object.assign(new Error("That would make your project list too large."), { status: 400 });
    await User.updateOne({ _id: user._id }, { $push: { projects: { $each: docs } } });
  }

  /* 3. refresh links everywhere, then pull env vars into the new projects */
  const latest = await User.findById(user._id);
  const { refreshed } = await ensureLinks(latest, dataKey, services, accounts, listed);
  summary.refreshed = refreshed;
  for (const doc of docs) {
    try { await syncProjectEnv(latest, String(doc._id), { apply: true, resolveConflicts: false }); } catch { /* the background pass retries */ }
  }
  return summary;
}

module.exports = { syncAllProjects };
