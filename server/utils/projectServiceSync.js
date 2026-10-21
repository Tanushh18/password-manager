const mongoose = require("mongoose");
const User = require("../models/schema");
const { renderRequest } = require("./renderOps");
const { fetchAllPages } = require("./renderPaging");
const { mapWithConcurrency } = require("./renderGuards");
const { linkedServices } = require("./projectMerge");
const { planEnvSync, pendingNames } = require("./serviceEnvSync");
const { retargetService } = require("./projectServiceAccount");

/*
 * Server-side work for a project's Render servers: copying variables from one server to the others that run
 * the same repository branch, and moving a server to another connected Render account. Values are only ever
 * sent to Render; no return value contains a value (names and counts only).
 */
const safeId = (value) => /^[A-Za-z0-9_-]{1,160}$/.test(String(value || ""));
const STRIP = ["_id", "createdAt", "updatedAt", "broken"];
const MAX_TARGETS = 10;
const fail = (status, message) => Object.assign(new Error(message), { status });

async function loadProject(user, projectId) {
  if (!mongoose.isValidObjectId(projectId)) throw fail(404, "Could not find that project.");
  const dataKey = await user.getDataKey();
  const entry = (user.projects || []).find((item) => String(item._id) === String(projectId));
  if (!entry) throw fail(404, "Could not find that project.");
  const fields = User.publicEntry(entry, dataKey);
  if (fields.broken) throw fail(422, "This project could not be decrypted.");
  return { entry, dataKey, fields };
}

/** The apiKey of a connected Render account, or "" when it is gone. */
function accountKey(user, dataKey, accountId) {
  if (!mongoose.isValidObjectId(accountId)) return "";
  const entry = (user.renderAccounts || []).find((item) => String(item._id) === String(accountId) && item.enc === "udk");
  return entry ? User.publicEntry(entry, dataKey).apiKey || "" : "";
}

async function saveProject(user, entry, dataKey, fields, patch) {
  const now = new Date();
  const next = { ...fields, ...patch };
  STRIP.forEach((key) => delete next[key]);
  const sealed = User.sealEntry(dataKey, next);
  await User.updateOne({ _id: user._id, "projects._id": entry._id }, { $set: { "projects.$.enc": "udk", "projects.$.data": sealed, "projects.$.updatedAt": now } });
  entry.enc = "udk";
  entry.data = sealed;
}

/** Reads every linked server: its branch, status and variables (values kept in memory only). */
async function readServers(user, dataKey, fields) {
  const services = linkedServices([fields]).filter((s) => safeId(s.serviceId));
  return mapWithConcurrency(services, 3, async (s) => {
    const apiKey = accountKey(user, dataKey, s.accountId);
    const base = { serviceId: s.serviceId, accountId: s.accountId, name: s.name || s.serviceId, apiKey };
    if (!apiKey) return { ...base, error: "Its Render account is no longer connected." };
    const path = "/v1/services/" + encodeURIComponent(s.serviceId);
    try {
      const raw = await renderRequest(apiKey, path);
      const service = raw?.service || raw;
      const listing = await fetchAllPages((p) => renderRequest(apiKey, p), path + "/env-vars");
      if (listing.truncated) return { ...base, branch: service?.branch || "", error: "Too many variables to compare safely." };
      const vars = listing.items.map((item) => item?.envVar || item).filter((item) => item && typeof item.key === "string").map((item) => ({ key: item.key, value: item.value }));
      return { ...base, name: String(service?.name || base.name), branch: service?.branch || "", suspended: service?.suspended === "suspended", vars };
    } catch (error) {
      return { ...base, error: error.status === 404 ? "This service no longer exists on Render." : "Could not read this service from Render." };
    }
  });
}

/**
 * Plans (and, when `apply` is set, performs) the copy of `sourceServiceId`'s variables onto `targetServiceIds`.
 * Default targets: every other linked server on the same branch as the source (`allServers` widens that to all).
 * `overwrite` also replaces values that differ; without it only missing variables are written.
 * `deploy` triggers a new build of the latest commit on every server that was changed.
 */
async function syncServicesEnv(user, projectId, { apply = false, overwrite = false, deploy = false, sourceServiceId = "", targetServiceIds = null, allServers = false } = {}) {
  const { entry, dataKey, fields } = await loadProject(user, projectId);
  const servers = await readServers(user, dataKey, fields);
  const source = servers.find((s) => s.serviceId === (sourceServiceId || fields.renderServiceId));
  if (!source) throw fail(400, "Choose a source server from this project.");
  if (source.error) throw fail(502, source.error);

  const wanted = Array.isArray(targetServiceIds) ? new Set(targetServiceIds.map(String)) : null;
  // allServers lists servers on every branch (for the preview); by default only the source's branch is targeted.
  const targets = servers
    .filter((s) => s !== source && (wanted ? wanted.has(s.serviceId) : allServers || s.branch === source.branch))
    .slice(0, MAX_TARGETS);
  const plans = targets.map((t) => ({ target: t, plan: t.error ? null : planEnvSync(source.vars, t.vars) }));
  const preview = plans.map(({ target, plan }) => ({
    serviceId: target.serviceId, name: target.name, branch: target.branch || "", suspended: Boolean(target.suspended), error: target.error || "",
    create: plan ? plan.create : [], update: plan ? plan.update : [], same: plan ? plan.same.length : 0, extra: plan ? plan.extra : [], skipped: plan ? plan.skipped : 0
  }));
  const summary = { source: { serviceId: source.serviceId, name: source.name, branch: source.branch || "" }, targets: preview, applied: false, results: [] };
  if (!apply) return summary;

  const results = [];
  for (const { target, plan } of plans) {
    if (target.error || !plan) { results.push({ serviceId: target.serviceId, name: target.name, written: 0, failed: [], deployed: false, error: target.error }); continue; }
    const names = pendingNames(plan, { overwrite });
    if (!names.length) { results.push({ serviceId: target.serviceId, name: target.name, written: 0, failed: [], deployed: false, error: "" }); continue; }
    const path = "/v1/services/" + encodeURIComponent(target.serviceId);
    const written = [];
    const failed = [];
    for (const name of names) {
      try { await renderRequest(target.apiKey, path + "/env-vars/" + encodeURIComponent(name), { method: "PUT", body: { value: plan.values.get(name) } }); written.push(name); }
      catch (error) { failed.push(name); if (error.status === 404) break; }
    }
    let deployed = false;
    if (deploy && written.length && !target.suspended) {
      try { await renderRequest(target.apiKey, path + "/deploys", { method: "POST", body: { clearCache: "do_not_clear", deployMode: "build_and_deploy" } }); deployed = true; }
      catch { /* the variables are saved; the server can be deployed by hand */ }
    }
    results.push({ serviceId: target.serviceId, name: target.name, written: written.length, failed, deployed, error: target.suspended && deploy && written.length ? "Suspended, so it was not redeployed." : "" });
  }
  return { ...summary, applied: true, results };
}

/** Moves a linked server to another connected Render account. The account must be able to see the service. */
async function moveServiceAccount(user, projectId, serviceId, accountId) {
  if (!safeId(serviceId)) throw fail(400, "Invalid service.");
  const { entry, dataKey, fields } = await loadProject(user, projectId);
  const apiKey = accountKey(user, dataKey, accountId);
  if (!apiKey) throw fail(404, "Choose a connected Render account.");
  let service;
  try { const raw = await renderRequest(apiKey, "/v1/services/" + encodeURIComponent(serviceId)); service = raw?.service || raw; }
  catch (error) { throw fail(error.status === 404 ? 422 : 502, error.status === 404 ? "That account cannot see this service." : "Could not check this service on Render."); }
  const patch = retargetService(fields, serviceId, String(accountId));
  if (!patch) throw fail(404, "This server is not linked to the project.");
  await saveProject(user, entry, dataKey, fields, patch);
  return { serviceId, accountId: String(accountId), name: String(service?.name || serviceId) };
}

module.exports = { syncServicesEnv, moveServiceAccount };
