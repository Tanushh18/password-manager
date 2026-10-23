const mongoose = require("mongoose");
const User = require("../models/schema");
const { renderRequest } = require("./renderOps");
const { fetchAllPages } = require("./renderPaging");
const { mapWithConcurrency } = require("./renderGuards");
const deploymentOps = require("./deployOps");

/*
 * Moving a backend to a new address: find every environment variable (in every connected Render account) that
 * still points at the old host, and rewrite it to the new one. This is how frontends that bake the API URL into
 * their build (VITE_API_URL, NEXT_PUBLIC_API_URL, ...) follow the move. Values are never returned, only names.
 */
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } };
const originOf = (u) => { try { const x = new URL(u); return x.protocol === "https:" ? x.origin : ""; } catch { return ""; } };

/** Replaces the old origin (any scheme, same host) with the new origin; returns the same string when nothing matches. Pure. */
function replaceHost(value, fromUrl, toUrl) {
  const host = hostOf(fromUrl), to = originOf(toUrl);
  if (!host || !to || typeof value !== "string") return value;
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(new RegExp("(?:https?:)?//" + escaped + "(?::\\d+)?(?![\\w.-])", "gi"), to).replace(new RegExp("^" + escaped + "$", "i"), to.replace(/^https:\/\//, ""));
}

function accountsOf(user, dataKey) {
  return (user.renderAccounts || []).filter((e) => e.enc === "udk").map((e) => ({ id: String(e._id), ...User.publicEntry(e, dataKey) })).filter((a) => a.apiKey);
}

async function findUrlReferences(user, fromUrl, { strict = false, projectId = "" } = {}) {
  const host = hostOf(fromUrl);
  if (!host) throw Object.assign(new Error("Enter the old address."), { status: 400 });
  const dataKey = await user.getDataKey();
  const refs = [];
  for (const account of accountsOf(user, dataKey)) {
    let services = [];
    try { services = (await fetchAllPages((p) => renderRequest(account.apiKey, p), "/v1/services")).items.map((i) => i?.service || i).filter((s) => s?.id); }
    catch {
      if (strict) throw Object.assign(new Error("Could not scan one connected Render account for old URL references. Check its connection before continuing."), { status: 502 });
      continue;
    }
    const scanResults = await mapWithConcurrency(services, 3, async (s) => {
      try {
        const base = "/v1/services/" + encodeURIComponent(s.id);
        const varsResult = await fetchAllPages((p) => renderRequest(account.apiKey, p), base + "/env-vars");
        const filesResult = await fetchAllPages((p) => renderRequest(account.apiKey, p), base + "/secret-files");
        if (strict && (varsResult.truncated || filesResult.truncated)) throw new Error("A service config list was truncated.");
        const vars = varsResult.items.map((i) => i?.envVar || i);
        const files = filesResult.items.map((i) => i?.secretFile || i);
        for (const v of vars) if (v && typeof v.value === "string" && v.value.toLowerCase().includes(host)) refs.push({ accountId: account.id, accountName: account.name || "", serviceId: s.id, serviceName: s.name, type: s.type || "", key: v.key, secretFile: false, suspended: s.suspended === "suspended" });
        for (const file of files) if (file && typeof file.content === "string" && file.content.toLowerCase().includes(host)) refs.push({ accountId: account.id, accountName: account.name || "", serviceId: s.id, serviceName: s.name, type: s.type || "", key: file.name, secretFile: true, suspended: s.suspended === "suspended" });
        return { ok: true };
      } catch {
        return { ok: false };
      }
    });
    if (strict && scanResults.some((result) => result?.ok === false)) {
      throw Object.assign(new Error("Could not scan a connected service's environment variables safely. Retry after checking its Render access."), { status: 502 });
    }
  }
  // Render environment groups can be linked to many services; inventory their variables and secret files too.
  for (const account of accountsOf(user, dataKey)) {
    try {
      const groupResult = await fetchAllPages((p) => renderRequest(account.apiKey, p), "/v1/env-groups");
      if (strict && groupResult.truncated) throw new Error("Environment-group list was truncated.");
      for (const listed of groupResult.items.map((i) => i?.envGroup || i).filter((g) => g?.id)) {
        let raw;
        try { raw = await renderRequest(account.apiKey, "/v1/env-groups/" + encodeURIComponent(listed.id)); }
        catch { if (strict) throw new Error("Could not read an environment group."); else continue; }
        const group = raw?.envGroup || raw;
        if (!Array.isArray(group.envVars) || !Array.isArray(group.secretFiles)) {
          if (strict) throw new Error("Environment-group configuration was not returned.");
          continue;
        }
        for (const v of group.envVars) if (v && typeof v.value === "string" && v.value.toLowerCase().includes(host)) refs.push({
          accountId: account.id, accountName: account.name || "", envGroupId: String(group.id || listed.id),
          envGroupName: group.name || listed.name || listed.id, key: v.key, secretFile: false, type: "env_group",
          serviceName: (group.name || listed.name || "Environment group") + " (shared group)"
        });
        for (const file of group.secretFiles) if (file && typeof file.content === "string" && file.content.toLowerCase().includes(host)) refs.push({
          accountId: account.id, accountName: account.name || "", envGroupId: String(group.id || listed.id),
          envGroupName: group.name || listed.name || listed.id, key: file.name, secretFile: true, type: "env_group",
          serviceName: (group.name || listed.name || "Environment group") + " (shared group)"
        });
      }
    } catch {
      if (strict) throw Object.assign(new Error("Could not scan Render environment groups safely. Check the connected account permissions before continuing."), { status: 502 });
    }
  }
  // Linked Vercel, Netlify, Railway and Cloudflare Pages frontends also need their environment updated.
  if (projectId) {
    let linked = [];
    try { linked = await deploymentOps.listTargets(user, projectId); }
    catch {
      if (strict) throw Object.assign(new Error("Could not inspect the project's linked frontend providers safely."), { status: 502 });
    }
    for (const view of linked.filter((item) => String(item.ref || "").startsWith("host:"))) {
      try {
        const target = await deploymentOps.findTarget(user, projectId, view.ref);
        const read = await deploymentOps.readVars(target);
        if (!read.ok) throw new Error(read.error || "Environment variables could not be read.");
        for (const variable of read.vars || []) {
          const key = variable.key || variable.name;
          if (typeof key === "string" && typeof variable.value === "string" && variable.value.toLowerCase().includes(host)) {
            refs.push({
              ref: view.ref, provider: view.provider, accountId: view.accountId || "",
              accountName: view.accountName || "", serviceName: view.name || target.name || view.ref,
              key, type: view.provider || "host", suspended: false
            });
          }
        }
      } catch {
        if (strict) throw Object.assign(new Error("Could not scan a linked hosting provider's frontend variables safely. Reconnect that provider or check its access before continuing."), { status: 502 });
      }
    }
  }
  return refs.sort((a, b) => String(a.serviceName || "").localeCompare(String(b.serviceName || "")) || String(a.key || "").localeCompare(String(b.key || "")));
}

async function replaceUrlReferences(user, { projectId = "", fromUrl, toUrl, targets = [], deploy = false }) {
  if (!hostOf(fromUrl) || !originOf(toUrl)) throw Object.assign(new Error("Enter the old address and a new https address."), { status: 400 });
  const dataKey = await user.getDataKey();
  const accounts = new Map(accountsOf(user, dataKey).map((a) => [a.id, a]));
  const byService = new Map();
  const byGroup = new Map();
  const byHost = new Map();
  for (const t of targets.slice(0, 100)) {
    if (typeof t?.ref === "string" && t.ref.startsWith("host:") && typeof t.key === "string") {
      if (!byHost.has(t.ref)) byHost.set(t.ref, { ref: t.ref, keys: new Set() });
      byHost.get(t.ref).keys.add(t.key);
      continue;
    }
    if (typeof t?.envGroupId === "string" && t.envGroupId && typeof t.key === "string" && mongoose.isValidObjectId(t?.accountId)) {
      const k = t.accountId + ":" + t.envGroupId;
      if (!byGroup.has(k)) byGroup.set(k, { accountId: t.accountId, envGroupId: t.envGroupId, variables: new Set(), secretFiles: new Set() });
      byGroup.get(k)[t.secretFile ? "secretFiles" : "variables"].add(t.key);
      continue;
    }
    if (!mongoose.isValidObjectId(t?.accountId) || !/^[A-Za-z0-9_-]{1,160}$/.test(String(t?.serviceId || "")) || typeof t?.key !== "string") continue;
    const k = t.accountId + ":" + t.serviceId;
    if (!byService.has(k)) byService.set(k, { accountId: t.accountId, serviceId: t.serviceId, variables: new Set(), secretFiles: new Set() });
    byService.get(k)[t.secretFile ? "secretFiles" : "variables"].add(t.key);
  }
  const results = [];
  for (const svc of byService.values()) {
    const account = accounts.get(svc.accountId);
    if (!account) { results.push({ serviceId: svc.serviceId, ok: false, error: "Render account not connected." }); continue; }
    const base = "/v1/services/" + encodeURIComponent(svc.serviceId);
    let changed = 0;
    try {
      const varsResult = await fetchAllPages((p) => renderRequest(account.apiKey, p), base + "/env-vars");
      const filesResult = await fetchAllPages((p) => renderRequest(account.apiKey, p), base + "/secret-files");
      if (varsResult.truncated || filesResult.truncated) throw new Error("Render returned an incomplete service config list.");
      const vars = varsResult.items.map((i) => i?.envVar || i);
      const files = filesResult.items.map((i) => i?.secretFile || i);
      for (const v of vars) {
        if (!svc.variables.has(v.key)) continue;
        const next = replaceHost(v.value, fromUrl, toUrl);
        if (next === v.value) continue;
        await renderRequest(account.apiKey, base + "/env-vars/" + encodeURIComponent(v.key), { method: "PUT", body: { value: next } });
        changed += 1;
      }
      for (const file of files) {
        if (!svc.secretFiles.has(file.name)) continue;
        const next = replaceHost(file.content, fromUrl, toUrl);
        if (next === file.content) continue;
        await renderRequest(account.apiKey, base + "/secret-files/" + encodeURIComponent(file.name), { method: "PUT", body: { content: next } });
        changed += 1;
      }
      let deployed = false;
      let deployError = "";
      // Retry deploys even when selected values already match: a previous attempt may have saved them but failed to deploy.
      if (deploy && (svc.variables.size || svc.secretFiles.size)) {
        try { await renderRequest(account.apiKey, base + "/deploys", { method: "POST", body: { clearCache: "do_not_clear" } }); deployed = true; }
        catch { deployError = "Variables were saved, but the frontend redeploy failed. Retry this migration step before continuing."; }
      }
      results.push({ serviceId: svc.serviceId, ok: !deployError, changed, deployed, ...(deployError ? { error: deployError } : {}) });
    } catch (error) { results.push({ serviceId: svc.serviceId, ok: false, error: error?.message || "Render refused the change." }); }
  }
  for (const svc of byGroup.values()) {
    const account = accounts.get(svc.accountId);
    if (!account) { results.push({ envGroupId: svc.envGroupId, ok: false, error: "Render account not connected." }); continue; }
    let changed = 0, deployed = false, error = "", groupName = svc.envGroupId;
    try {
      const base = "/v1/env-groups/" + encodeURIComponent(svc.envGroupId);
      const raw = await renderRequest(account.apiKey, base);
      const group = raw?.envGroup || raw;
      groupName = group.name || groupName;
      for (const v of group.envVars || []) {
        if (!svc.variables.has(v.key)) continue;
        const next = replaceHost(v.value, fromUrl, toUrl);
        if (next === v.value) continue;
        await renderRequest(account.apiKey, base + "/env-vars/" + encodeURIComponent(v.key), { method: "PUT", body: { value: next } });
        changed += 1;
      }
      for (const file of group.secretFiles || []) {
        if (!svc.secretFiles.has(file.name)) continue;
        const next = replaceHost(file.content, fromUrl, toUrl);
        if (next === file.content) continue;
        await renderRequest(account.apiKey, base + "/secret-files/" + encodeURIComponent(file.name), { method: "PUT", body: { content: next } });
        changed += 1;
      }
      if (deploy && (svc.variables.size || svc.secretFiles.size)) {
        const serviceIds = (group.serviceLinks || []).map((link) => link?.id).filter((id) => typeof id === "string").slice(0, 50);
        for (const serviceId of serviceIds) {
          try { await renderRequest(account.apiKey, "/v1/services/" + encodeURIComponent(serviceId) + "/deploys", { method: "POST", body: { clearCache: "do_not_clear" } }); deployed = true; }
          catch { error = "The environment group was updated but at least one linked service could not be redeployed. Retry the migration step."; }
        }
      }
    } catch (e) { error = e?.message || "Could not update the environment group."; }
    results.push({ envGroupId: svc.envGroupId, serviceName: groupName + " (shared group)", ok: !error, changed, deployed, ...(error ? { error } : {}) });
  }
  for (const svc of byHost.values()) {
    let changed = 0, deployed = false, error = "", serviceName = svc.ref;
    try {
      if (!projectId) throw new Error("Project context is required for a linked hosting-provider frontend.");
      const target = await deploymentOps.findTarget(user, projectId, svc.ref);
      serviceName = target.name || svc.ref;
      const read = await deploymentOps.readVars(target);
      if (!read.ok) throw new Error(read.error || "Could not read the hosting provider's variables.");
      for (const variable of read.vars || []) {
        const key = variable.key || variable.name;
        if (!svc.keys.has(key)) continue;
        if (typeof variable.value !== "string") throw new Error("A selected variable is hidden by the provider and cannot be rewritten safely.");
        const next = replaceHost(variable.value, fromUrl, toUrl);
        if (next === variable.value) continue;
        const written = await deploymentOps.writeVar(target, key, next);
        if (!written.ok) throw new Error(written.error || "The hosting provider refused the variable update.");
        changed += 1;
      }
      if (deploy && svc.keys.size) {
        const redeploy = await deploymentOps.redeployTarget(target);
        deployed = Boolean(redeploy.ok);
        if (!redeploy.ok) error = redeploy.error || "The frontend redeploy failed. Retry this migration step.";
      }
    } catch (e) { error = e?.message || "Could not update the linked frontend."; }
    results.push({ ref: svc.ref, serviceName, ok: !error, changed, deployed, ...(error ? { error } : {}) });
  }
  return { results, changed: results.reduce((n, r) => n + (r.changed || 0), 0) };
}

module.exports = { replaceHost, findUrlReferences, replaceUrlReferences };
