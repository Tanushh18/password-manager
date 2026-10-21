const mongoose = require("mongoose");
const User = require("../models/schema");
const { renderRequest } = require("./renderOps");
const { fetchAllPages } = require("./renderPaging");
const { linkedServices } = require("./projectMerge");
const { findUrlReferences, replaceUrlReferences } = require("./urlRefs");
const { checkServiceDeletion } = require("./renderGuards");

/*
 * Moving a Render server to another connected account, as steps the user runs one at a time:
 *   plan -> create the new service (same repo, branch, settings and variables) -> wait until it is live ->
 *   point the frontends at the new address -> relink the project to the new service -> delete the old service.
 * Each step is its own call, and the delete refuses to run until the project already points at the new service.
 * Variable values go from Render to Render only; responses carry names and counts.
 */
const safeId = (value) => /^[A-Za-z0-9_-]{1,160}$/.test(String(value || ""));
const STRIP = ["_id", "createdAt", "updatedAt", "broken"];
const fail = (status, message) => Object.assign(new Error(message), { status });
const servicePath = (id) => "/v1/services/" + encodeURIComponent(id);

async function loadProject(user, projectId) {
  if (!mongoose.isValidObjectId(projectId)) throw fail(404, "Could not find that project.");
  const dataKey = await user.getDataKey();
  const entry = (user.projects || []).find((item) => String(item._id) === String(projectId));
  if (!entry) throw fail(404, "Could not find that project.");
  const fields = User.publicEntry(entry, dataKey);
  if (fields.broken) throw fail(422, "This project could not be decrypted.");
  return { entry, dataKey, fields };
}

/** Connected Render account by id: its api key and display name. */
function accountOf(user, dataKey, accountId) {
  if (!mongoose.isValidObjectId(accountId)) return null;
  const entry = (user.renderAccounts || []).find((item) => String(item._id) === String(accountId) && item.enc === "udk");
  const fields = entry ? User.publicEntry(entry, dataKey) : null;
  return fields?.apiKey ? { id: String(accountId), apiKey: fields.apiKey, name: fields.name || "Render account" } : null;
}

/** The linked service of this project that is being moved. */
function linkedSource(fields, serviceId) {
  const hit = linkedServices([fields]).find((s) => s.serviceId === serviceId);
  if (!hit) throw fail(404, "This server is not linked to the project.");
  return hit;
}

/** Create-service body from the old service, so the new one matches it: same repo, branch, runtime, commands, region and variables. */
function payloadFrom(old, envVars, ownerId, name) {
  const d = old.serviceDetails || {};
  const base = { ownerId, name, repo: old.repo, branch: old.branch, autoDeploy: old.autoDeploy === "no" ? "no" : "yes", envVars: envVars.map((v) => ({ key: v.key, value: v.value })) };
  if (old.rootDir) base.rootDir = old.rootDir;
  if (old.type === "static_site") return { ...base, type: "static_site", serviceDetails: { buildCommand: d.buildCommand || "", publishPath: d.publishPath || "." } };
  const details = { runtime: d.runtime, plan: d.plan || "free", region: d.region, envSpecificDetails: { buildCommand: d.envSpecificDetails?.buildCommand || "", startCommand: d.envSpecificDetails?.startCommand || "" } };
  if (d.healthCheckPath) details.healthCheckPath = d.healthCheckPath;
  return { ...base, type: "web_service", serviceDetails: details };
}

async function readService(apiKey, id) {
  const raw = await renderRequest(apiKey, servicePath(id));
  return raw?.service || raw;
}

/** Everything the user needs to decide, with no variable values in the answer. */
async function plan(user, projectId, { serviceId, targetAccountId, ownerId = "" }) {
  if (!safeId(serviceId)) throw fail(400, "Invalid service.");
  const { dataKey, fields } = await loadProject(user, projectId);
  const src = linkedSource(fields, serviceId);
  const from = accountOf(user, dataKey, src.accountId);
  if (!from) throw fail(422, "The current Render account is no longer connected.");
  const target = accountOf(user, dataKey, targetAccountId);
  if (!target) throw fail(400, "Choose a connected Render account to move the server to.");
  if (target.id === src.accountId) throw fail(400, "Choose a different account. This server is already in that one.");

  const old = await readService(from.apiKey, serviceId);
  const envList = await fetchAllPages((p) => renderRequest(from.apiKey, p), servicePath(serviceId) + "/env-vars");
  const envCount = envList.items.map((i) => i?.envVar || i).filter((i) => i && typeof i.key === "string").length;

  const owners = (await renderRequest(target.apiKey, "/v1/owners?limit=20") || []).map((o) => o?.owner || o).filter((o) => o?.id).map((o) => ({ id: o.id, name: String(o.name || o.id), type: o.type || "" }));
  if (!owners.length) throw fail(422, "No Render workspace was found in the target account.");
  if (ownerId && !owners.some((o) => o.id === ownerId)) throw fail(400, "That workspace is not in the target account.");
  const chosenOwner = ownerId || (owners.length === 1 ? owners[0].id : "");

  const frontends = (old.serviceDetails?.url ? await findUrlReferences(user, old.serviceDetails.url).catch(() => []) : [])
    .filter((r) => r.serviceId !== serviceId);
  const warnings = [];
  if (old.suspended === "suspended") warnings.push("The old server is suspended. Resume it first if the new one should replace a running service.");
  if (old.serviceDetails?.plan && old.serviceDetails.plan !== "free") warnings.push("The old server is on the “" + old.serviceDetails.plan + "” plan. The new server uses the same plan, so it may bill in the target account.");
  if (!old.serviceDetails?.url) warnings.push("The old server has no public address yet, so there is no frontend address to replace.");

  return {
    source: { serviceId, name: old.name, accountName: from.name, url: old.serviceDetails?.url || "", branch: old.branch || "", type: old.type || "", plan: old.serviceDetails?.plan || "", region: old.serviceDetails?.region || "", envCount, live: old.suspended !== "suspended" },
    target: { accountId: target.id, accountName: target.name, ownerId: chosenOwner, owners },
    frontends: frontends.map((r) => ({ accountId: r.accountId, serviceId: r.serviceId, serviceName: r.serviceName, key: r.key, accountName: r.accountName })),
    warnings
  };
}

/** Creates the new service in the target account. Returns its id and address; the old one is untouched. */
async function create(user, projectId, { serviceId, targetAccountId, ownerId, name = "" }) {
  if (!safeId(serviceId) || !ownerId) throw fail(400, "Choose the source server and the target workspace.");
  const { dataKey, fields } = await loadProject(user, projectId);
  const src = linkedSource(fields, serviceId);
  const from = accountOf(user, dataKey, src.accountId);
  const target = accountOf(user, dataKey, targetAccountId);
  if (!from || !target) throw fail(422, "A Render account is no longer connected.");
  const old = await readService(from.apiKey, serviceId);
  const envList = await fetchAllPages((p) => renderRequest(from.apiKey, p), servicePath(serviceId) + "/env-vars");
  const envVars = envList.items.map((i) => i?.envVar || i).filter((i) => i && typeof i.key === "string" && typeof i.value === "string").map((i) => ({ key: i.key, value: i.value }));
  const wanted = String(name || "").trim().slice(0, 60) || old.name;
  try {
    const raw = await renderRequest(target.apiKey, "/v1/services", { method: "POST", body: payloadFrom(old, envVars, ownerId, wanted) });
    const created = raw?.service || raw;
    if (!created?.id) throw fail(502, "Render did not return the new service.");
    return { serviceId: created.id, name: created.name || wanted, accountId: target.id, url: created.serviceDetails?.url || "", envCount: envVars.length };
  } catch (error) {
    throw fail(error.status === 400 || error.status === 409 || error.status === 422 ? 422 : 502, error.message || "Render could not create the new server. Check the name and the workspace.");
  }
}

/** Live state of a server in an account, for the wait step. */
async function status(user, projectId, { accountId, serviceId }) {
  if (!safeId(serviceId)) throw fail(400, "Invalid service.");
  const { dataKey } = await loadProject(user, projectId);
  const account = accountOf(user, dataKey, accountId);
  if (!account) throw fail(404, "Choose a connected Render account.");
  const service = await readService(account.apiKey, serviceId);
  let deploy = null;
  try {
    const rows = await renderRequest(account.apiKey, servicePath(serviceId) + "/deploys?limit=1");
    const d = (Array.isArray(rows) ? rows : []).map((r) => r?.deploy || r)[0];
    if (d) deploy = { id: String(d.id || ""), status: String(d.status || "unknown") };
  } catch { /* the deploy line is optional */ }
  const st = deploy?.status || "";
  return { name: service.name, url: service.serviceDetails?.url || "", suspended: service.suspended === "suspended", deploy, ready: st === "live" };
}

/** Points the frontends' variables from the old address to the new one, optionally redeploying them. */
async function frontends(user, { fromUrl, toUrl, targets, deploy }) {
  return replaceUrlReferences(user, { fromUrl, toUrl, targets: Array.isArray(targets) ? targets : [], deploy: deploy === true });
}

/** Links the project to the new service in place of the old one (the old link is removed, nothing is deleted). */
async function relink(user, projectId, { oldServiceId, newAccountId, newServiceId, newName, newUrl }) {
  if (!safeId(oldServiceId) || !safeId(newServiceId) || !mongoose.isValidObjectId(newAccountId)) throw fail(400, "Invalid servers.");
  const { entry, dataKey, fields } = await loadProject(user, projectId);
  const others = (Array.isArray(fields.renderServices) ? fields.renderServices : []).filter((s) => s && s.serviceId !== oldServiceId && s.serviceId !== newServiceId);
  const added = { accountId: String(newAccountId), serviceId: newServiceId, name: String(newName || newServiceId), url: /^https:\/\//i.test(String(newUrl || "")) ? newUrl : "", suspended: false };
  const next = { ...fields, renderServices: [...others, added] };
  if (fields.renderServiceId === oldServiceId || !fields.renderServiceId) {
    next.renderAccountId = String(newAccountId); next.renderServiceId = newServiceId; next.renderServiceName = added.name;
  }
  STRIP.forEach((key) => delete next[key]);
  const now = new Date();
  await User.updateOne({ _id: user._id, "projects._id": entry._id }, { $set: { "projects.$.enc": "udk", "projects.$.data": User.sealEntry(dataKey, next), "projects.$.updatedAt": now } });
  return { renderServiceId: newServiceId, renderAccountId: String(newAccountId) };
}

/** Deletes the old service. Refused while the project still points at it, and needs the exact name typed. */
async function deleteOld(user, projectId, { serviceId, accountId, confirmName }) {
  if (!safeId(serviceId)) throw fail(400, "Invalid service.");
  const { dataKey, fields } = await loadProject(user, projectId);
  if (fields.renderServiceId === serviceId) throw fail(409, "The project still uses this server. Relink it to the new server first.");
  const account = accountOf(user, dataKey, accountId);
  if (!account) throw fail(404, "Choose a connected Render account.");
  const service = await readService(account.apiKey, serviceId);
  const verdict = checkServiceDeletion(service, confirmName, { requireName: true, allowActive: true });
  if (!verdict.ok) throw fail(verdict.status, verdict.error);
  try { await renderRequest(account.apiKey, servicePath(serviceId), { method: "DELETE" }); }
  catch (error) { throw fail(error.status === 404 ? 404 : 502, "Render could not delete the old server."); }
  return { deleted: true, name: service.name };
}

module.exports = { plan, create, status, frontends, relink, deleteOld };
