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

const domainPath = (id) => servicePath(id) + "/custom-domains";
const supportsDomains = (type) => ["web_service", "static_site"].includes(String(type || "").toLowerCase());
const normalizeDomains = (result) => (result.items || []).map((item) => item?.customDomain || item).filter((item) => item && typeof item.name === "string").map((item) => ({
  id: String(item.id || item.name),
  name: String(item.name).toLowerCase(),
  verificationStatus: String(item.verificationStatus || "unknown").toLowerCase(),
  redirectForName: item.redirectForName || ""
}));
async function listDomains(apiKey, serviceId) {
  const result = await fetchAllPages((path) => renderRequest(apiKey, path), domainPath(serviceId), { limit: 100, maxPages: 5 });
  if (result.truncated) throw fail(422, "Too many custom domains to migrate safely.");
  return normalizeDomains(result);
}
function missingVerifiedDomains(expectedNames, domains) {
  return (Array.isArray(expectedNames) ? expectedNames : []).filter((name) =>
    !(domains || []).some((domain) => domain.name === String(name).toLowerCase() && domain.verificationStatus === "verified")
  );
}
async function addDomain(apiKey, serviceId, name) {
  return renderRequest(apiKey, domainPath(serviceId), { method: "POST", body: { name } });
}
async function removeDomain(apiKey, serviceId, name) {
  return renderRequest(apiKey, domainPath(serviceId) + "/" + encodeURIComponent(name), { method: "DELETE" });
}
async function saveProjectFields(user, entry, dataKey, fields) {
  const next = { ...fields };
  STRIP.forEach((key) => delete next[key]);
  const sealed = User.sealEntry(dataKey, next);
  await User.updateOne({ _id: user._id, "projects._id": entry._id }, { $set: { "projects.$.enc": "udk", "projects.$.data": sealed, "projects.$.updatedAt": new Date() } });
  entry.enc = "udk";
  entry.data = sealed;
  return next;
}


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

async function requireLiveDeploy(apiKey, serviceId) {
  let rows;
  try { rows = await renderRequest(apiKey, servicePath(serviceId) + "/deploys?limit=1"); }
  catch { throw fail(409, "The replacement deployment status could not be confirmed. Keep the old server until Render reports Live."); }
  const deploy = (Array.isArray(rows) ? rows : []).map((row) => row?.deploy || row).find(Boolean);
  if (!deploy || String(deploy.status || "").toLowerCase() !== "live") {
    throw fail(409, "The replacement server's latest deployment is not Live. The old server will be kept.");
  }
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
  const domains = supportsDomains(old.type) ? await listDomains(from.apiKey, serviceId) : [];

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
  if (domains.length) warnings.push("Custom domains are attached to the old service. Transfer and verify every domain on the new service before deleting the old one; DNS settings are managed by your DNS provider.");

  const originId = fields.renderAccountOriginId || src.accountId;
  const originAccount = accountOf(user, dataKey, originId);
  return {
    source: { serviceId, accountId: String(src.accountId), name: old.name, accountName: from.name, url: old.serviceDetails?.url || "", branch: old.branch || "", type: old.type || "", plan: old.serviceDetails?.plan || "", region: old.serviceDetails?.region || "", envCount, live: old.suspended !== "suspended" },
    target: { accountId: target.id, accountName: target.name, ownerId: chosenOwner, owners },
    origin: { accountId: String(originId), accountName: originAccount?.name || (originId === src.accountId ? from.name : ""), available: Boolean(originAccount), isCurrent: String(originId) === String(src.accountId) },
    domains,
    frontends: frontends.map((r) => ({ accountId: r.accountId, serviceId: r.serviceId, serviceName: r.serviceName, key: r.key, accountName: r.accountName })),
    warnings
  };
}

/** Creates the new service in the target account. Returns its id and address; the old one is untouched. */
async function create(user, projectId, { serviceId, targetAccountId, ownerId, name = "" }) {
  if (!safeId(serviceId) || !ownerId) throw fail(400, "Choose the source server and the target workspace.");
  const { entry, dataKey, fields } = await loadProject(user, projectId);
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
    const sourceDomains = supportsDomains(old.type) ? await listDomains(from.apiKey, serviceId) : [];
    const migration = {
      sourceServiceId: serviceId, sourceAccountId: String(src.accountId), sourceAccountName: from.name,
      sourceName: old.name || serviceId, sourceUrl: old.serviceDetails?.url || src.url || "",
      targetServiceId: String(created.id), targetAccountId: target.id, targetAccountName: target.name,
      targetName: created.name || wanted, targetUrl: created.serviceDetails?.url || "",
      domains: sourceDomains.map((domain) => domain.name),
      stage: "created", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    await saveProjectFields(user, entry, dataKey, { ...fields, renderMigration: migration });
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


/** Persist the source/target mapping and attach each existing custom domain to the replacement service. */
async function prepareDomains(user, projectId, { sourceServiceId, targetAccountId, targetServiceId }) {
  if (!safeId(sourceServiceId) || !safeId(targetServiceId)) throw fail(400, "Choose valid source and target servers.");
  const { entry, dataKey, fields } = await loadProject(user, projectId);
  const src = linkedSource(fields, sourceServiceId);
  const sourceAccount = accountOf(user, dataKey, src.accountId);
  const targetAccount = accountOf(user, dataKey, targetAccountId);
  if (!sourceAccount || !targetAccount) throw fail(422, "A source or target Render account is no longer connected.");
  const targetService = await readService(targetAccount.apiKey, targetServiceId);
  if (targetService.suspended === "suspended") throw fail(409, "The replacement server is suspended. Resume it before moving custom domains.");
  const sourceService = await readService(sourceAccount.apiKey, sourceServiceId);
  const targetSupportsDomains = supportsDomains(targetService.type);
  const sourceDomains = supportsDomains(sourceService.type) ? await listDomains(sourceAccount.apiKey, sourceServiceId) : [];
  if (sourceDomains.length && !targetSupportsDomains) throw fail(422, "The replacement service type cannot accept the custom domains on the source service.");
  const sameMigration = fields.renderMigration
    && fields.renderMigration.sourceServiceId === sourceServiceId
    && fields.renderMigration.targetServiceId === targetServiceId
    && fields.renderMigration.targetAccountId === targetAccount.id;
  const expectedNames = sameMigration && Array.isArray(fields.renderMigration.domains) && fields.renderMigration.domains.length
    ? fields.renderMigration.domains
    : sourceDomains.map((d) => d.name);
  const migration = {
    ...(sameMigration ? fields.renderMigration : {}),
    sourceServiceId, sourceAccountId: String(src.accountId), sourceAccountName: sourceAccount.name, sourceName: sourceService.name || src.name || sourceServiceId,
    sourceUrl: sourceService.serviceDetails?.url || src.url || "",
    targetServiceId, targetAccountId: targetAccount.id, targetAccountName: targetAccount.name, targetName: targetService.name || targetServiceId,
    targetUrl: targetService.serviceDetails?.url || "",
    domains: [...new Set(expectedNames.map((n) => String(n).toLowerCase()))],
    stage: "domains_preparing",
    updatedAt: new Date().toISOString()
  };
  await saveProjectFields(user, entry, dataKey, { ...fields, renderMigration: migration });

  let targetDomains = targetSupportsDomains ? await listDomains(targetAccount.apiKey, targetServiceId) : [];
  const detachedFromOld = [];
  for (const name of migration.domains) {
    if (targetDomains.some((d) => d.name === name)) continue;
    try {
      await addDomain(targetAccount.apiKey, targetServiceId, name);
    } catch (error) {
      // Render can reject a hostname while it remains attached to the source service.
      if (Number(error?.status) !== 409) throw fail(502, "Render could not attach custom domain " + name + ". The old server has been kept; check domain limits and permissions.");
      try { await removeDomain(sourceAccount.apiKey, sourceServiceId, name); }
      catch {
        throw fail(409, "Domain " + name + " is still attached to the old service and could not be released. The old server was not deleted.");
      }
      detachedFromOld.push(name);
      try { await addDomain(targetAccount.apiKey, targetServiceId, name); }
      catch {
        try { await addDomain(sourceAccount.apiKey, sourceServiceId, name); } catch { /* best-effort restore */ }
        throw fail(502, "Could not attach " + name + " to the new service. Stashr attempted to restore it to the old service; check Render before proceeding.");
      }
    }
    targetDomains = targetSupportsDomains ? await listDomains(targetAccount.apiKey, targetServiceId) : [];
  }
  targetDomains = targetSupportsDomains ? await listDomains(targetAccount.apiKey, targetServiceId) : [];
  const verified = missingVerifiedDomains(migration.domains, targetDomains).length === 0;
  migration.stage = migration.domains.length === 0 || verified ? "domains_verified" : "domains_prepared";
  migration.updatedAt = new Date().toISOString();
  await saveProjectFields(user, entry, dataKey, { ...fields, renderMigration: migration });
  return {
    domains: targetDomains.filter((d) => migration.domains.includes(d.name)),
    expectedDomains: migration.domains,
    detachedFromOld,
    sourceUrl: migration.sourceUrl,
    targetUrl: migration.targetUrl,
    dnsTarget: (() => { try { return new URL(migration.targetUrl).hostname; } catch { return ""; } })(),
    verified: migration.stage === "domains_verified"
  };
}

/** Trigger DNS checks for migrated custom domains and persist a server-side readiness gate. */
async function verifyDomains(user, projectId, { accountId, serviceId }) {
  if (!safeId(serviceId)) throw fail(400, "Choose a valid target server.");
  const { entry, dataKey, fields } = await loadProject(user, projectId);
  const migration = fields.renderMigration;
  if (!migration || migration.targetServiceId !== serviceId || migration.targetAccountId !== String(accountId)) throw fail(409, "Prepare the custom-domain transfer for this migration first.");
  const account = accountOf(user, dataKey, accountId);
  if (!account) throw fail(404, "The target Render account is no longer connected.");
  for (const name of migration.domains || []) {
    try {
      await renderRequest(account.apiKey, domainPath(serviceId) + "/" + encodeURIComponent(name) + "/verify", { method: "POST" });
    } catch (error) {
      if (![400, 404, 409, 422].includes(Number(error?.status))) throw fail(502, "Could not request verification for " + name + ". Check Render and retry.");
    }
  }
  const domains = await listDomains(account.apiKey, serviceId);
  const results = (migration.domains || []).map((name) => {
    const item = domains.find((d) => d.name === name);
    return { name, verificationStatus: item?.verificationStatus || "missing", verified: item?.verificationStatus === "verified" };
  });
  const verified = results.every((d) => d.verified);
  const nextMigration = { ...migration, stage: verified ? "domains_verified" : "domains_prepared", domainCheckAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await saveProjectFields(user, entry, dataKey, { ...fields, renderMigration: nextMigration });
  return { verified, domains: results, targetUrl: migration.targetUrl };
}

/** Expose the original Render account so the user can move the service back to it. */
async function origin(user, projectId, serviceId) {
  if (!safeId(serviceId)) throw fail(400, "Choose a valid server.");
  const { dataKey, fields } = await loadProject(user, projectId);
  const linked = linkedSource(fields, serviceId);
  const current = accountOf(user, dataKey, linked.accountId);
  const originId = String(fields.renderAccountOriginId || linked.accountId);
  const original = accountOf(user, dataKey, originId);
  const savedMigration = fields.renderMigration;
  const migrationMatches = savedMigration && (savedMigration.sourceServiceId === serviceId || savedMigration.targetServiceId === serviceId)
    && ["created", "domains_preparing", "domains_prepared", "domains_verified", "relinked"].includes(savedMigration.stage);
  const migration = migrationMatches ? {
    stage: savedMigration.stage,
    sourceServiceId: savedMigration.sourceServiceId,
    sourceAccountId: savedMigration.sourceAccountId,
    sourceAccountName: savedMigration.sourceAccountName || "",
    sourceName: savedMigration.sourceName || "",
    sourceUrl: savedMigration.sourceUrl || "",
    targetServiceId: savedMigration.targetServiceId,
    targetAccountId: savedMigration.targetAccountId,
    targetAccountName: savedMigration.targetAccountName || "",
    targetName: savedMigration.targetName || "",
    targetUrl: savedMigration.targetUrl || "",
    domains: Array.isArray(savedMigration.domains) ? savedMigration.domains : []
  } : null;
  return {
    currentAccountId: String(linked.accountId),
    originalAccountId: originId,
    originalAccountName: original?.name || (originId === String(linked.accountId) ? current?.name || "" : fields.renderAccountOriginName || ""),
    available: Boolean(original),
    canReturn: Boolean(original && originId !== String(linked.accountId)),
    migration
  };
}

/** Points the frontends' variables from the old address to the new one, optionally redeploying them. */
async function frontends(user, { fromUrl, toUrl, targets, deploy }) {
  return replaceUrlReferences(user, { fromUrl, toUrl, targets: Array.isArray(targets) ? targets : [], deploy: deploy === true });
}

/** Links the project to the new service in place of the old one (the old link is removed, nothing is deleted). */
async function relink(user, projectId, { oldServiceId, newAccountId, newServiceId, newName, newUrl }) {
  if (!safeId(oldServiceId) || !safeId(newServiceId) || !mongoose.isValidObjectId(newAccountId)) throw fail(400, "Invalid servers.");
  const { entry, dataKey, fields } = await loadProject(user, projectId);
  const sourceLink = linkedSource(fields, oldServiceId);
  const migration = fields.renderMigration;
  if (!migration || migration.sourceServiceId !== oldServiceId || migration.targetServiceId !== newServiceId || migration.targetAccountId !== String(newAccountId)) {
    throw fail(409, "Prepare the replacement and custom-domain handoff before relinking the project.");
  }
  const destination = accountOf(user, dataKey, newAccountId);
  if (!destination) throw fail(404, "The target Render account is no longer connected.");
  await requireLiveDeploy(destination.apiKey, newServiceId);
  const targetDomains = (migration.domains || []).length ? await listDomains(destination.apiKey, newServiceId) : [];
  const missingDomains = missingVerifiedDomains(migration.domains, targetDomains);
  if (missingDomains.length) throw fail(409, "Do not relink yet. These custom domains are not verified on the new service: " + missingDomains.join(", "));
  const sourceAccount = accountOf(user, dataKey, sourceLink.accountId);
  const others = (Array.isArray(fields.renderServices) ? fields.renderServices : []).filter((s) => s && s.serviceId !== oldServiceId && s.serviceId !== newServiceId);
  const added = { accountId: String(newAccountId), serviceId: newServiceId, name: String(newName || newServiceId), url: /^https:\/\//i.test(String(newUrl || "")) ? newUrl : "", suspended: false };
  const next = { ...fields, renderServices: [...others, added] };
  if (fields.renderServiceId === oldServiceId || !fields.renderServiceId) {
    next.renderAccountId = String(newAccountId); next.renderServiceId = newServiceId; next.renderServiceName = added.name;
  }
  if (!next.renderAccountOriginId) {
    next.renderAccountOriginId = String(sourceLink.accountId);
    next.renderAccountOriginName = sourceAccount?.name || "";
  }
  next.renderMigration = { ...migration, stage: "relinked", relinkedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await saveProjectFields(user, entry, dataKey, next);
  return { renderServiceId: newServiceId, renderAccountId: String(newAccountId), originAccountId: String(next.renderAccountOriginId) };
}

/** Deletes the old service. Refused while the project still points at it, and needs the exact name typed. */
async function deleteOld(user, projectId, { serviceId, accountId, confirmName }) {
  if (!safeId(serviceId)) throw fail(400, "Invalid service.");
  const { entry, dataKey, fields } = await loadProject(user, projectId);
  if (fields.renderServiceId === serviceId) throw fail(409, "The project still uses this server. Relink it to the new server first.");
  const migration = fields.renderMigration;
  if (!migration || migration.stage !== "relinked" || migration.sourceServiceId !== serviceId || migration.sourceAccountId !== String(accountId)) {
    throw fail(409, "The old server can only be deleted after the project has been relinked through the migration wizard.");
  }
  const targetAccount = accountOf(user, dataKey, migration.targetAccountId);
  if (!targetAccount) throw fail(409, "The destination account is no longer connected; keep the old server until it is restored.");
  const targetDomainList = (migration.domains || []).length ? await listDomains(targetAccount.apiKey, migration.targetServiceId) : [];
  const missingDomains = missingVerifiedDomains(migration.domains, targetDomainList);
  if (missingDomains.length) throw fail(409, "The old server is being kept because these domains are not verified on the replacement: " + missingDomains.join(", "));
  const newService = await readService(targetAccount.apiKey, migration.targetServiceId);
  if (newService.suspended === "suspended") throw fail(409, "The replacement server is suspended. The old server will not be deleted.");
  await requireLiveDeploy(targetAccount.apiKey, migration.targetServiceId);
  const account = accountOf(user, dataKey, accountId);
  if (!account) throw fail(404, "Choose a connected Render account.");
  const service = await readService(account.apiKey, serviceId);
  const verdict = checkServiceDeletion(service, confirmName, { requireName: true, allowActive: true });
  if (!verdict.ok) throw fail(verdict.status, verdict.error);
  try { await renderRequest(account.apiKey, servicePath(serviceId), { method: "DELETE" }); }
  catch (error) { throw fail(error.status === 404 ? 404 : 502, "Render could not delete the old server."); }
  try {
    await saveProjectFields(user, entry, dataKey, { ...fields, renderMigration: { ...migration, stage: "complete", completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
  } catch { /* Service deletion succeeded; retain the migration record for recovery if the metadata write fails. */ }
  return { deleted: true, name: service.name, domainsVerified: (migration.domains || []).length };
}

module.exports = { plan, create, status, frontends, prepareDomains, verifyDomains, origin, relink, deleteOld, supportsDomains, normalizeDomains, missingVerifiedDomains };
