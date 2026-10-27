const Registry = require("../models/registry");
const { renderRequest } = require("./renderOps");
const { fetchAllPages } = require("./renderPaging");
const { mapWithConcurrency } = require("./renderGuards");
const { planRegistrySync } = require("./registrySync");
const { loadRenderServices } = require("./projectStatus");
const { planEnvAlign } = require("./registryEnvDiff");
const { DEFAULTS, urlsFor } = require("./registryDefaults");

/*
 * Servers tab: align the environment variables of every Render server of one app. Adds missing names only
 * (never overwrites, never deletes) and, on request, redeploys the servers that changed and are active.
 * Values are never returned; only names.
 */
const fail = (status, message) => Object.assign(new Error(message), { status });
const servicePath = (id) => "/v1/services/" + encodeURIComponent(id);

async function alignRegistryEnv(user, app, { apply = false, deploy = false } = {}) {
  if (!DEFAULTS[app]) throw fail(404, "Unknown app.");
  const dataKey = await user.getDataKey();
  const { services, accounts } = await loadRenderServices(user, dataKey, {});
  const doc = await Registry.findOne({ app }).lean();
  const urls = urlsFor(doc, app);
  const seen = new Set();
  const servers = planRegistrySync(urls, services).items.map((i) => i.service).filter((s) => s && accounts.has(s.accountId) && !seen.has(s.id) && seen.add(s.id));
  if (servers.length < 2) throw fail(400, "This app needs at least two servers found on Render to compare.");

  const members = await mapWithConcurrency(servers, 3, async (s) => {
    const account = accounts.get(s.accountId);
    try {
      const listing = await fetchAllPages((path) => renderRequest(account.apiKey, path), servicePath(s.id) + "/env-vars");
      if (listing.truncated) throw fail(422, s.name + " has more variables than Stashr can safely load at once.");
      return { id: s.id, name: s.name, vars: listing.items.map((x) => x?.envVar || x).filter((x) => x && typeof x.key === "string") };
    } catch (error) { throw fail(error.status === 404 ? 404 : error.status || 502, error.status === 422 ? error.message : "Could not read variables from " + s.name + "."); }
  });

  const plan = planEnvAlign(members);
  const view = {
    app, applied: false, inSync: plan.inSync, total: plan.total, noValue: plan.noValue,
    servers: plan.perServer.map((p) => {
      const s = servers.find((x) => x.id === p.id);
      return { id: p.id, name: p.name, state: s.suspended ? "suspended" : "active", missing: p.missing, differs: p.differs };
    })
  };
  if (!apply) return view;

  const byServer = new Map();
  for (const a of plan.additions) { if (!byServer.has(a.serverId)) byServer.set(a.serverId, []); byServer.get(a.serverId).push(a); }
  const results = await mapWithConcurrency(servers.filter((s) => byServer.has(s.id)), 2, async (s) => {
    const account = accounts.get(s.accountId);
    const done = []; const failed = [];
    for (const a of byServer.get(s.id)) {
      try { await renderRequest(account.apiKey, servicePath(s.id) + "/env-vars/" + encodeURIComponent(a.key), { method: "PUT", body: { value: a.value } }); done.push(a.key); }
      catch (error) { failed.push({ name: a.key, error: error.message || "Render refused this variable." }); if (error.status === 404) break; }
    }
    let deployed = false; let deploySkipped = "";
    if (deploy && done.length) {
      if (s.suspended) deploySkipped = "Server is suspended";
      else {
        try { await renderRequest(account.apiKey, servicePath(s.id) + "/deploys", { method: "POST", body: { clearCache: "do_not_clear", deployMode: "build_and_deploy" } }); deployed = true; }
        catch (error) { deploySkipped = error.message || "Could not start a deploy"; }
      }
    }
    return { id: s.id, name: s.name, added: done, failed, deployed, deploySkipped };
  });
  return { ...view, applied: true, results };
}

module.exports = { alignRegistryEnv };
