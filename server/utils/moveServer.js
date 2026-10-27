const mongoose = require("mongoose");
const dns = require("node:dns").promises;
const User = require("../models/schema");
const { renderRequest } = require("./renderOps");
const { fetchAllPages } = require("./renderPaging");
const { linkedServices } = require("./projectMerge");
const { findUrlReferences, replaceUrlReferences } = require("./urlRefs");
const { checkServiceDeletion } = require("./renderGuards");
const { swapServerUrl, publishToRegistry } = require("./serverUrlsSync");

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
  domainType: String(item.domainType || "").toLowerCase(),
  publicSuffix: String(item.publicSuffix || ""),
  redirectForName: item.redirectForName || ""
}));
async function listDomains(apiKey, serviceId) {
  const result = await fetchAllPages((path) => renderRequest(apiKey, path), domainPath(serviceId), { limit: 100, maxPages: 5 });
  if (result.truncated) throw fail(422, "Too many custom domains to migrate safely.");
  return normalizeDomains(result);
}
async function listDirectEnvVars(apiKey, serviceId) {
  const result = await fetchAllPages((path) => renderRequest(apiKey, path), servicePath(serviceId) + "/env-vars", { limit: 100, maxPages: 10 });
  if (result.truncated) throw fail(422, "Environment-variable pagination was incomplete. No migration was started.");
  const rows = result.items.map((item) => item?.envVar || item).filter((item) => item && typeof item.key === "string");
  if (rows.some((item) => typeof item.value !== "string")) {
    throw fail(422, "Render did not return every direct environment-variable value. No partial copy was started.");
  }
  return rows.map((item) => ({ key: item.key, value: item.value }));
}
async function listDirectSecretFiles(apiKey, serviceId) {
  const result = await fetchAllPages((path) => renderRequest(apiKey, path), servicePath(serviceId) + "/secret-files", { limit: 100, maxPages: 10 });
  if (result.truncated) throw fail(422, "Secret-file pagination was incomplete. No migration was started.");
  const rows = result.items.map((item) => item?.secretFile || item).filter((item) => item && typeof item.name === "string");
  if (rows.some((item) => typeof item.content !== "string")) {
    throw fail(422, "Render did not return every direct secret-file content. No partial copy was started.");
  }
  return rows.map((item) => ({ name: item.name, content: item.content }));
}
async function listLinkedEnvGroups(apiKey, ownerId, serviceId) {
  const query = ownerId ? "?ownerId=" + encodeURIComponent(ownerId) : "";
  const result = await fetchAllPages((path) => renderRequest(apiKey, path), "/v1/env-groups" + query, { limit: 100, maxPages: 10 });
  if (result.truncated) throw fail(422, "Environment-group pagination was incomplete. No migration was started.");
  const groups = result.items.map((item) => item?.envGroup || item)
    .filter((group) => group?.id && Array.isArray(group.serviceLinks) && group.serviceLinks.some((link) => String(link.id) === String(serviceId)));
  const details = [];
  for (const listed of groups) {
    let raw;
    try { raw = await renderRequest(apiKey, "/v1/env-groups/" + encodeURIComponent(listed.id)); }
    catch { throw fail(502, "Could not read linked environment group " + String(listed.name || listed.id) + ". Reconnect the source Render account and retry."); }
    const group = raw?.envGroup || raw;
    if (!Array.isArray(group.envVars) || !Array.isArray(group.secretFiles)) {
      throw fail(502, "Render did not return the full configuration for linked environment group " + String(listed.name || listed.id) + ".");
    }
    details.push({
      id: String(group.id || listed.id),
      name: String(group.name || listed.name || listed.id),
      environmentId: group.environmentId ? String(group.environmentId) : "",
      envVars: (() => {
        const rows = group.envVars.filter((v) => v && typeof v.key === "string");
        if (rows.some((v) => typeof v.value !== "string")) throw fail(422, "Render did not return every environment-group variable value.");
        return rows.map((v) => ({ key: v.key, value: v.value }));
      })(),
      secretFiles: (() => {
        const rows = group.secretFiles.filter((v) => v && typeof v.name === "string");
        if (rows.some((v) => typeof v.content !== "string")) throw fail(422, "Render did not return every environment-group secret-file content.");
        return rows.map((v) => ({ name: v.name, content: v.content }));
      })()
    });
  }
  return details;
}
async function inspectDomainDns(name, sourceUrl = "", targetUrl = "") {
  const sourceHost = (() => { try { return new URL(sourceUrl).hostname.toLowerCase(); } catch { return ""; } })();
  const targetHost = (() => { try { return new URL(targetUrl).hostname.toLowerCase(); } catch { return ""; } })();
  const [cnameResult, aResult, aaaaResult] = await Promise.allSettled([
    dns.resolveCname(name), dns.resolve4(name), dns.resolve6(name)
  ]);
  const cname = cnameResult.status === "fulfilled" ? cnameResult.value.map((v) => String(v).replace(/\.$/, "").toLowerCase()) : [];
  const a = aResult.status === "fulfilled" ? aResult.value : [];
  const aaaa = aaaaResult.status === "fulfilled" ? aaaaResult.value : [];
  const pointsToTarget = Boolean(targetHost && cname.some((v) => v === targetHost || v.endsWith("." + targetHost)));
  const pointsToSource = Boolean(sourceHost && cname.some((v) => v === sourceHost || v.endsWith("." + sourceHost)));
  return {
    status: pointsToTarget ? "points_to_target" : pointsToSource ? "points_to_old_target" : cname.length ? "other_cname" : "no_cname_detected",
    cname, a, aaaa, sourceHost, targetHost,
    note: aaaa.length ? "An AAAA record exists; Render's custom-domain guidance says to remove conflicting AAAA records." : ""
  };
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

function originalAccountId(fields, serviceId, currentAccountId) {
  const previous = fields?.renderMigration;
  if (previous?.targetServiceId === serviceId && previous.originAccountId) return String(previous.originAccountId);
  if (fields?.renderServiceId === serviceId && fields?.renderAccountOriginId) return String(fields.renderAccountOriginId);
  return String(currentAccountId);
}

/** Copy supported service settings without silently converting unsupported service types. */
function payloadFrom(old, envVars, secretFiles, ownerId, name) {
  const d = old.serviceDetails || {};
  const trigger = ["commit", "checksPass", "off"].includes(old.autoDeployTrigger)
    ? old.autoDeployTrigger
    : old.autoDeploy === "no" ? "off" : "commit";
  const base = {
    ownerId, name, repo: old.repo, branch: old.branch,
    autoDeployTrigger: trigger,
    envVars: envVars.map((v) => ({ key: v.key, value: v.value })),
    secretFiles: secretFiles.map((file) => ({ name: file.name, content: file.content }))
  };
  if (old.buildFilter || d.buildFilter) base.buildFilter = old.buildFilter || d.buildFilter;
  if (old.notifyOnFail) base.notifyOnFail = old.notifyOnFail;
  if (old.rootDir) base.rootDir = old.rootDir;
  if (old.type === "static_site") {
    const details = { buildCommand: d.buildCommand || "", publishPath: d.publishPath || "." };
    if (d.pullRequestPreviewsEnabled !== undefined) details.pullRequestPreviewsEnabled = d.pullRequestPreviewsEnabled;
    if (d.previews) details.previews = d.previews;
    if (d.renderSubdomainPolicy) details.renderSubdomainPolicy = d.renderSubdomainPolicy;
    return { ...base, type: "static_site", serviceDetails: details };
  }
  const details = {
    runtime: d.runtime, plan: d.plan || "free", region: d.region,
    envSpecificDetails: {
      buildCommand: d.envSpecificDetails?.buildCommand ?? d.buildCommand ?? "",
      startCommand: d.envSpecificDetails?.startCommand ?? d.startCommand ?? ""
    }
  };
  for (const key of ["dockerfilePath", "dockerContext", "dockerCommand", "preDeployCommand"]) {
    const value = d.envSpecificDetails?.[key] ?? d[key];
    if (value !== undefined && value !== null && value !== "") details.envSpecificDetails[key] = value;
  }
  for (const key of ["healthCheckPath", "numInstances", "ipAllowList", "pullRequestPreviewsEnabled", "renderSubdomainPolicy"]) {
    if (d[key] !== undefined && d[key] !== null) details[key] = d[key];
  }
  if (d.disk) throw fail(422, "This service has a persistent disk. Copying disk data requires a separate data migration; the old service will not be moved automatically.");
  if (d.plan && d.plan !== "free") { /* preserved above; destination billing may differ */ }
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
async function plan(user, projectId, { serviceId, targetAccountId, ownerId = "", targetServiceId = "" }) {
  if (!safeId(serviceId)) throw fail(400, "Invalid service.");
  const { dataKey, fields } = await loadProject(user, projectId);
  const src = linkedSource(fields, serviceId);
  const from = accountOf(user, dataKey, src.accountId);
  if (!from) throw fail(422, "The current Render account is no longer connected.");
  const target = accountOf(user, dataKey, targetAccountId);
  if (!target) throw fail(400, "Choose a connected Render account to move the server to.");
  if (target.id === src.accountId) throw fail(400, "Choose a different account. This server is already in that one.");

  const old = await readService(from.apiKey, serviceId);
  if (!supportsDomains(old.type)) throw fail(422, "Only Render web services and static sites can be migrated by this wizard today. This service type will not be silently converted.");
  if (old.disk || old.serviceDetails?.disk) throw fail(422, "This service has a persistent disk. Migrate and verify its data separately before moving the service.");
  let replacementUrl = "";
  if (targetServiceId) {
    const existingMigration = fields.renderMigration;
    if (!existingMigration || existingMigration.sourceServiceId !== serviceId || existingMigration.targetServiceId !== targetServiceId || existingMigration.targetAccountId !== String(targetAccountId)) {
      throw fail(409, "The DNS preflight target does not match the saved migration.");
    }
    const replacement = await readService(target.apiKey, targetServiceId);
    replacementUrl = replacement.serviceDetails?.url || "";
  }
  const envVars = await listDirectEnvVars(from.apiKey, serviceId);
  const secretFiles = await listDirectSecretFiles(from.apiKey, serviceId);
  const envGroups = await listLinkedEnvGroups(from.apiKey, old.ownerId, serviceId);
  const envCount = envVars.length;
  const domains = supportsDomains(old.type) ? await listDomains(from.apiKey, serviceId) : [];
  const domainsWithDns = await Promise.all(domains.map(async (domain) => ({
    ...domain,
    dns: await inspectDomainDns(domain.name, old.serviceDetails?.url || "", replacementUrl)
  })));

  const owners = (await renderRequest(target.apiKey, "/v1/owners?limit=100") || []).map((o) => o?.owner || o).filter((o) => o?.id).map((o) => ({ id: o.id, name: String(o.name || o.id), type: o.type || "" }));
  if (!owners.length) throw fail(422, "No Render workspace was found in the target account.");
  if (ownerId && !owners.some((o) => o.id === ownerId)) throw fail(400, "That workspace is not in the target account.");
  const chosenOwner = ownerId || (owners.length === 1 ? owners[0].id : "");

  const frontends = (old.serviceDetails?.url ? await findUrlReferences(user, old.serviceDetails.url, { strict: true, projectId }) : [])
    .filter((r) => r.serviceId !== serviceId || r.accountId !== String(src.accountId));
  const warnings = [];
  if (old.environmentId || old.serviceDetails?.environmentId) warnings.push("This service belongs to a Render Environment. The new server is created outside any environment in the destination, so recreate any environment isolation (such as protected or private-network rules) there if you rely on it.");
  if (old.suspended === "suspended") warnings.push("The old server is suspended. Resume it first if the new one should replace a running service.");
  if (old.serviceDetails?.plan && old.serviceDetails.plan !== "free") warnings.push("The old server is on the “" + old.serviceDetails.plan + "” plan. The new server uses the same plan, so it may bill in the target account.");
  if (!old.serviceDetails?.url) warnings.push("The old server has no public address yet, so there is no frontend address to replace.");
  if (domains.length) warnings.push("Custom domains are attached to the old service. The previous verified status does not automatically verify the replacement; DNS must point at the new Render hostname before final verification.");
  if (envGroups.some((group) => group.environmentId)) warnings.push("Some linked environment groups are scoped to a Render environment. Their values will be copied into destination groups linked only to this server; the source environment scope cannot be carried across accounts automatically.");
  if (secretFiles.length) warnings.push("Direct secret files will be copied to the new service. Review any certificates or keys whose contents are rotated or tied to a specific environment.");
  warnings.push("This workflow recreates the web/static service, its readable direct environment variables, direct secret files and linked environment groups. It does not transfer database contents, Redis/Key Value data, external provider resources or persistent-disk data; persistent-disk services are blocked until their data is migrated separately.");

  const originId = originalAccountId(fields, serviceId, src.accountId);
  const originAccount = accountOf(user, dataKey, originId);
  return {
    source: { serviceId, accountId: String(src.accountId), name: old.name, accountName: from.name, url: old.serviceDetails?.url || "", branch: old.branch || "", type: old.type || "", plan: old.serviceDetails?.plan || "", region: old.serviceDetails?.region || "", envCount, secretFileCount: secretFiles.length, envGroupCount: envGroups.length, live: old.suspended !== "suspended" },
    target: { accountId: target.id, accountName: target.name, ownerId: chosenOwner, owners },
    origin: { accountId: String(originId), accountName: originAccount?.name || (originId === src.accountId ? from.name : ""), available: Boolean(originAccount), isCurrent: String(originId) === String(src.accountId) },
    domains: domainsWithDns,
    config: {
      directEnvVarCount: envVars.length,
      directSecretFileCount: secretFiles.length,
      envGroups: envGroups.map((group) => ({ id: group.id, name: group.name, envVarCount: group.envVars.length, secretFileCount: group.secretFiles.length, environmentScoped: Boolean(group.environmentId) }))
    },
    frontends: frontends.map((r) => ({ accountId: r.accountId, serviceId: r.serviceId, envGroupId: r.envGroupId, envGroupName: r.envGroupName, secretFile: Boolean(r.secretFile), serviceName: r.serviceName, key: r.key, accountName: r.accountName, ref: r.ref, provider: r.provider })),
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
  if (!supportsDomains(old.type)) throw fail(422, "Only Render web services and static sites can be migrated by this wizard today. This service type will not be silently converted.");
  const envVars = await listDirectEnvVars(from.apiKey, serviceId);
  const secretFiles = await listDirectSecretFiles(from.apiKey, serviceId);
  const sourceGroups = await listLinkedEnvGroups(from.apiKey, old.ownerId, serviceId);
  const owners = (await renderRequest(target.apiKey, "/v1/owners?limit=100") || []).map((item) => item?.owner || item).filter((item) => item?.id);
  if (!owners.some((owner) => String(owner.id) === String(ownerId))) throw fail(400, "The selected workspace does not belong to the destination Render account.");
  // Read all source dependencies before creation so an API/permission error cannot create a partial destination.
  const sourceDomains = supportsDomains(old.type) ? await listDomains(from.apiKey, serviceId) : [];
  const originId = originalAccountId(fields, serviceId, src.accountId);
  const wanted = String(name || "").trim().slice(0, 60) || old.name;
  try {
    const raw = await renderRequest(target.apiKey, "/v1/services", { method: "POST", body: payloadFrom(old, envVars, secretFiles, ownerId, wanted) });
    const created = raw?.service || raw;
    if (!created?.id) throw fail(502, "Render did not return the new service.");
    const migration = {
      sourceServiceId: serviceId, sourceAccountId: String(src.accountId), sourceAccountName: from.name,
      sourceName: old.name || serviceId, sourceUrl: old.serviceDetails?.url || src.url || "",
      targetServiceId: String(created.id), targetAccountId: target.id, targetAccountName: target.name,
      targetName: created.name || wanted, targetUrl: created.serviceDetails?.url || "",
      originAccountId: String(originId),
      sourceOwnerId: String(old.ownerId || ""),
      targetOwnerId: String(ownerId),
      domains: sourceDomains.map((domain) => domain.name),
      envGroupCount: sourceGroups.length,
      envGroupMap: {},
      configComplete: sourceGroups.length === 0,
      stage: "created", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    await saveProjectFields(user, entry, dataKey, { ...fields, renderMigration: migration });
    return { serviceId: created.id, name: created.name || wanted, accountId: target.id, url: created.serviceDetails?.url || "", envCount: envVars.length, secretFileCount: secretFiles.length, envGroupCount: sourceGroups.length, configComplete: migration.configComplete };
  } catch (error) {
    throw fail(error.status === 400 || error.status === 409 || error.status === 422 ? 422 : 502, error.message || "Render could not create the new server. Check the name and the workspace.");
  }
}

/** Live state of a server in an account, for the wait step. */
/** Copy linked environment groups after service creation. Each group is checkpointed for safe retry. */
async function copyEnvGroups(user, projectId, { sourceServiceId, targetAccountId, targetServiceId }) {
  if (!safeId(sourceServiceId) || !safeId(targetServiceId)) throw fail(400, "Choose valid source and target servers.");
  const { entry, dataKey, fields } = await loadProject(user, projectId);
  const migration = fields.renderMigration;
  if (!migration || migration.sourceServiceId !== sourceServiceId || migration.targetServiceId !== targetServiceId || migration.targetAccountId !== String(targetAccountId) || !["created", "config_pending"].includes(migration.stage)) {
    throw fail(409, "The saved migration does not match these source and destination servers.");
  }
  const sourceAccount = accountOf(user, dataKey, migration.sourceAccountId);
  const targetAccount = accountOf(user, dataKey, targetAccountId);
  if (!sourceAccount || !targetAccount) throw fail(422, "A source or destination Render account is no longer connected.");
  const sourceService = await readService(sourceAccount.apiKey, sourceServiceId);
  const groups = await listLinkedEnvGroups(sourceAccount.apiKey, sourceService.ownerId, sourceServiceId);
  const targetOwnerId = migration.targetOwnerId;
  if (!targetOwnerId) throw fail(409, "The destination workspace was not saved. Start the migration plan again.");
  let nextMigration = { ...migration, envGroupMap: { ...(migration.envGroupMap || {}) }, configComplete: false, stage: "config_pending" };
  await saveProjectFields(user, entry, dataKey, { ...fields, renderMigration: nextMigration });
  const results = [];
  for (const group of groups) {
    if (nextMigration.envGroupMap[group.id]) {
      results.push({ sourceGroupId: group.id, name: group.name, copied: true, reused: true });
      continue;
    }
    const suffix = String(targetServiceId).slice(-8);
    const targetName = (String(group.name || "Environment group").slice(0, 70) + " - migrated " + suffix).slice(0, 100);
    try {
      const raw = await renderRequest(targetAccount.apiKey, "/v1/env-groups", {
        method: "POST",
        body: {
          ownerId: targetOwnerId,
          name: targetName,
          envVars: group.envVars,
          secretFiles: group.secretFiles,
          serviceIds: [targetServiceId]
        }
      });
      const copied = raw?.envGroup || raw;
      if (!copied?.id) throw new Error("Render did not return the new environment-group ID.");
      nextMigration = {
        ...nextMigration,
        envGroupMap: { ...nextMigration.envGroupMap, [group.id]: { id: String(copied.id), name: String(copied.name || targetName) } },
        updatedAt: new Date().toISOString()
      };
      await saveProjectFields(user, entry, dataKey, { ...fields, renderMigration: nextMigration });
      results.push({ sourceGroupId: group.id, targetGroupId: String(copied.id), name: group.name, copied: true, environmentScopeFlattened: Boolean(group.environmentId) });
    } catch (error) {
      results.push({ sourceGroupId: group.id, name: group.name, copied: false, error: error?.message || "Render refused to copy the environment group." });
      break;
    }
  }
  let complete = results.every((result) => result.copied) && results.length === groups.length;
  let deployRequested = false;
  if (complete && groups.length) {
    try {
      // The first build may start before linked environment groups are attached.
      await renderRequest(targetAccount.apiKey, servicePath(targetServiceId) + "/deploys", { method: "POST", body: { clearCache: "do_not_clear" } });
      deployRequested = true;
    } catch {
      complete = false;
      results.push({ name: "Replacement service deployment", copied: false, error: "Environment groups were copied, but Render did not accept a deploy. Retry this step; the source service is still preserved." });
    }
  }
  nextMigration = { ...nextMigration, configComplete: complete, stage: complete ? "created" : "config_pending", envGroupCount: groups.length, envGroupDeployRequested: deployRequested, updatedAt: new Date().toISOString() };
  await saveProjectFields(user, entry, dataKey, { ...fields, renderMigration: nextMigration });
  return { complete, groups: results, expectedGroups: groups.length, deployRequested };
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
  // Preserve names from an interrupted transfer (the old mapping may already have been detached) and include any newly attached domains.
  const expectedNames = [...new Set([
    ...(sameMigration && Array.isArray(fields.renderMigration.domains) ? fields.renderMigration.domains : []),
    ...sourceDomains.map((d) => d.name)
  ].map((name) => String(name).toLowerCase()))];
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
  const originId = originalAccountId(fields, serviceId, linked.accountId);
  const original = accountOf(user, dataKey, originId);
  const savedMigration = fields.renderMigration;
  const migrationMatches = savedMigration && (savedMigration.sourceServiceId === serviceId || savedMigration.targetServiceId === serviceId)
    && ["created", "config_pending", "domains_preparing", "domains_prepared", "domains_verified", "relinked", "complete"].includes(savedMigration.stage);
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
    originAccountId: savedMigration.originAccountId || originId,
    domains: Array.isArray(savedMigration.domains) ? savedMigration.domains : [],
    configComplete: savedMigration.configComplete !== false,
    envGroupCount: Number(savedMigration.envGroupCount || 0)
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
async function frontends(user, projectId, { fromUrl, toUrl, targets, deploy }) {
  return replaceUrlReferences(user, { projectId, fromUrl, toUrl, targets: Array.isArray(targets) ? targets : [], deploy: deploy === true });
}

/** Links the project to the new service in place of the old one (the old link is removed, nothing is deleted). */
async function relink(user, projectId, { oldServiceId, newAccountId, newServiceId, newName, newUrl }) {
  if (!safeId(oldServiceId) || !safeId(newServiceId) || !mongoose.isValidObjectId(newAccountId)) throw fail(400, "Invalid servers.");
  const { entry, dataKey, fields } = await loadProject(user, projectId);
  const sourceLink = linkedSource(fields, oldServiceId);
  const migration = fields.renderMigration;
  if (!migration || migration.stage !== "domains_verified" || migration.configComplete === false || migration.sourceServiceId !== oldServiceId || migration.targetServiceId !== newServiceId || migration.targetAccountId !== String(newAccountId)) {
    throw fail(409, "Prepare the replacement, DNS handoff and custom-domain verification before relinking the project.");
  }
  const destination = accountOf(user, dataKey, newAccountId);
  if (!destination) throw fail(404, "The target Render account is no longer connected.");
  await requireLiveDeploy(destination.apiKey, newServiceId);
  const targetDomains = (migration.domains || []).length ? await listDomains(destination.apiKey, newServiceId) : [];
  const missingDomains = missingVerifiedDomains(migration.domains, targetDomains);
  if (missingDomains.length) throw fail(409, "Do not relink yet. These custom domains are not verified on the new service: " + missingDomains.join(", "));
  if (migration.sourceUrl) {
    const remainingReferences = await findUrlReferences(user, migration.sourceUrl, { strict: true, projectId });
    const blocking = remainingReferences.filter((ref) => !(ref.serviceId === oldServiceId && ref.accountId === String(sourceLink.accountId)));
    if (blocking.length) {
      const sample = blocking.slice(0, 8).map((ref) => (ref.serviceName || ref.ref || ref.serviceId) + " · " + ref.key);
      throw fail(409, "Do not relink yet. Update and redeploy frontend/service variables still pointing at the old URL: " + sample.join(", "));
    }
  }
  const sourceAccount = accountOf(user, dataKey, sourceLink.accountId);
  const others = (Array.isArray(fields.renderServices) ? fields.renderServices : []).filter((s) => s && s.serviceId !== oldServiceId && s.serviceId !== newServiceId);
  const added = { accountId: String(newAccountId), serviceId: newServiceId, name: String(newName || newServiceId), url: /^https:\/\//i.test(String(newUrl || "")) ? newUrl : "", suspended: false };
  const next = { ...fields, renderServices: [...others, added] };
  if (fields.renderServiceId === oldServiceId || !fields.renderServiceId) {
    next.renderAccountId = String(newAccountId); next.renderServiceId = newServiceId; next.renderServiceName = added.name;
  }
  if (!next.renderAccountOriginId) {
    next.renderAccountOriginId = String(migration.originAccountId || sourceLink.accountId);
    next.renderAccountOriginName = accountOf(user, dataKey, next.renderAccountOriginId)?.name || sourceAccount?.name || "";
  }
  next.renderMigration = { ...migration, stage: "relinked", relinkedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  // The project's Server URLs follow the server to its new address, and so does the app registry it feeds.
  const swapped = swapServerUrl(next.serverUrls, migration.sourceUrl, added.url);
  if (swapped.changed) next.serverUrls = swapped.list;
  await saveProjectFields(user, entry, dataKey, next);
  const published = swapped.changed && next.registryApp ? await publishToRegistry(next.registryApp, swapped.list, user.email) : false;
  return { renderServiceId: newServiceId, renderAccountId: String(newAccountId), originAccountId: String(next.renderAccountOriginId), serverUrlsUpdated: swapped.changed, registryPublished: published };
}

/** Deletes the old service. Refused while the project still points at it, and needs the exact name typed. */
async function deleteOld(user, projectId, { serviceId, accountId, confirmName }) {
  if (!safeId(serviceId)) throw fail(400, "Invalid service.");
  const { entry, dataKey, fields } = await loadProject(user, projectId);
  if (fields.renderServiceId === serviceId) throw fail(409, "The project still uses this server. Relink it to the new server first.");
  const migration = fields.renderMigration;
  if (!migration || migration.stage !== "relinked" || migration.configComplete === false || migration.sourceServiceId !== serviceId || migration.sourceAccountId !== String(accountId)) {
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
  if (migration.sourceUrl) {
    const remainingReferences = await findUrlReferences(user, migration.sourceUrl, { strict: true, projectId });
    const blocking = remainingReferences.filter((ref) => !(ref.serviceId === serviceId && ref.accountId === String(accountId)));
    if (blocking.length) {
      const sample = blocking.slice(0, 8).map((ref) => ref.serviceName + " · " + ref.key);
      throw fail(409, "The old server URL is still referenced by frontend/service variables: " + sample.join(", ") + ". Update and redeploy these before deleting the old server.");
    }
  }
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

module.exports = { plan, create, status, frontends, prepareDomains, verifyDomains, copyEnvGroups, origin, relink, deleteOld, supportsDomains, normalizeDomains, missingVerifiedDomains, inspectDomainDns, listDirectEnvVars, listDirectSecretFiles, listLinkedEnvGroups, payloadFrom };
