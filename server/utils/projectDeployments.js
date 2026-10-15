const mongoose = require("mongoose");
const User = require("../models/schema");
const { renderRequest } = require("./renderOps");
const { fetchAllPages } = require("./renderPaging");
const { mapWithConcurrency } = require("./renderGuards");
const { linkedServices } = require("./projectMerge");
const { compareEnv } = require("./envCompare");

/*
 * "Where is this project deployed?": every Render service linked to a project (all accounts), read live:
 * URL, status, plan, last deploy, plus an environment comparison across the servers and the Stashr copy.
 * Reads Render only. Variable VALUES are never returned, only names and same/different markers.
 */
const safeId = (value) => /^[A-Za-z0-9_-]{1,160}$/.test(String(value || ""));
const fail = (status, message) => Object.assign(new Error(message), { status });

async function getProjectDeployments(user, projectId) {
  if (!mongoose.isValidObjectId(projectId)) throw fail(404, "Could not find that project.");
  const dataKey = await user.getDataKey();
  const entry = (user.projects || []).find((item) => String(item._id) === String(projectId));
  if (!entry) throw fail(404, "Could not find that project.");
  const fields = User.publicEntry(entry, dataKey);
  if (fields.broken) throw fail(422, "This project could not be decrypted.");

  const linked = linkedServices([fields]).filter((l) => safeId(l.serviceId));
  const accounts = new Map();
  const accountFor = (id) => {
    if (!accounts.has(id)) {
      const e = mongoose.isValidObjectId(id) ? (user.renderAccounts || []).find((item) => String(item._id) === String(id) && item.enc === "udk") : null;
      const f = e ? User.publicEntry(e, dataKey) : null;
      accounts.set(id, f?.apiKey ? { name: f.name || "Render account", apiKey: f.apiKey } : null);
    }
    return accounts.get(id);
  };

  const read = await mapWithConcurrency(linked, 3, async (link) => {
    const base = { id: link.serviceId, accountId: link.accountId, name: link.name || link.serviceId, isMain: link.serviceId === fields.renderServiceId, vars: null };
    const account = accountFor(link.accountId);
    if (!account) return { ...base, accountName: "", error: "Its Render account is no longer connected." };
    const path = "/v1/services/" + encodeURIComponent(link.serviceId);
    try {
      const raw = await renderRequest(account.apiKey, path);
      const service = raw?.service || raw;
      const out = {
        ...base, accountName: account.name, name: String(service?.name || base.name), type: service?.type || "",
        url: /^https:\/\//i.test(String(service?.serviceDetails?.url || "")) ? service.serviceDetails.url : "",
        dashboardUrl: service?.dashboardUrl || "", suspended: service?.suspended === "suspended",
        region: service?.serviceDetails?.region || "", plan: service?.serviceDetails?.plan || service?.serviceDetails?.buildPlan || "",
        branch: service?.branch || "", updatedAt: service?.updatedAt || "", latestDeploy: null, envCount: null, envPartial: false
      };
      try {
        const rows = await renderRequest(account.apiKey, path + "/deploys?limit=1");
        const d = (Array.isArray(rows) ? rows : []).map((r) => r?.deploy || r)[0];
        if (d) out.latestDeploy = { status: String(d.status || "unknown"), at: d.finishedAt || d.createdAt || null, commit: String(d.commit?.message || "").split("\n")[0].slice(0, 100), sha: String(d.commit?.id || "").slice(0, 7) };
      } catch { /* deploy info is optional */ }
      try {
        const listing = await fetchAllPages((p) => renderRequest(account.apiKey, p), path + "/env-vars");
        const vars = listing.items.map((item) => item?.envVar || item).filter((item) => item && typeof item.key === "string").map((item) => ({ key: item.key, value: item.value }));
        out.envCount = vars.length;
        if (listing.truncated) out.envPartial = true; else out.vars = vars;
      } catch { out.error = "Could not read this service's variables."; }
      return out;
    } catch (error) {
      return { ...base, accountName: account.name, gone: error?.status === 404, error: error?.status === 404 ? "This service no longer exists on Render." : "Could not read this service from Render." };
    }
  });

  const rank = (s) => (s.isMain ? 0 : s.gone ? 3 : s.suspended ? 2 : 1);
  const servers = read.filter(Boolean).sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name)));
  const stashr = { id: "stashr", vars: (fields.envVars || []).filter((v) => v && v.name).map((v) => ({ key: v.name, value: v.value })) };
  const env = compareEnv([...servers.map((s) => ({ id: s.id, vars: s.vars })), stashr], { informational: ["stashr"] });
  return {
    project: { id: String(entry._id), name: fields.name },
    servers: servers.map(({ vars, ...rest }) => rest),
    stashr: { id: "stashr", name: "Stashr (saved)", envCount: stashr.vars.length },
    env, checkedAt: new Date().toISOString()
  };
}

module.exports = { getProjectDeployments };
