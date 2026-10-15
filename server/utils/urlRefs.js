const mongoose = require("mongoose");
const User = require("../models/schema");
const { renderRequest } = require("./renderOps");
const { fetchAllPages } = require("./renderPaging");
const { mapWithConcurrency } = require("./renderGuards");

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

async function findUrlReferences(user, fromUrl) {
  const host = hostOf(fromUrl);
  if (!host) throw Object.assign(new Error("Enter the old address."), { status: 400 });
  const dataKey = await user.getDataKey();
  const refs = [];
  for (const account of accountsOf(user, dataKey)) {
    let services = [];
    try { services = (await fetchAllPages((p) => renderRequest(account.apiKey, p), "/v1/services")).items.map((i) => i?.service || i).filter((s) => s?.id); } catch { continue; }
    await mapWithConcurrency(services, 3, async (s) => {
      try {
        const vars = (await fetchAllPages((p) => renderRequest(account.apiKey, p), "/v1/services/" + encodeURIComponent(s.id) + "/env-vars")).items.map((i) => i?.envVar || i);
        for (const v of vars) if (v && typeof v.value === "string" && v.value.toLowerCase().includes(host)) refs.push({ accountId: account.id, accountName: account.name || "", serviceId: s.id, serviceName: s.name, type: s.type || "", key: v.key, suspended: s.suspended === "suspended" });
      } catch { /* unreadable service: skipped */ }
    });
  }
  return refs.sort((a, b) => a.serviceName.localeCompare(b.serviceName) || a.key.localeCompare(b.key));
}

async function replaceUrlReferences(user, { fromUrl, toUrl, targets = [], deploy = false }) {
  if (!hostOf(fromUrl) || !originOf(toUrl)) throw Object.assign(new Error("Enter the old address and a new https address."), { status: 400 });
  const dataKey = await user.getDataKey();
  const accounts = new Map(accountsOf(user, dataKey).map((a) => [a.id, a]));
  const byService = new Map();
  for (const t of targets.slice(0, 100)) {
    if (!mongoose.isValidObjectId(t?.accountId) || !/^[A-Za-z0-9_-]{1,160}$/.test(String(t?.serviceId || "")) || typeof t?.key !== "string") continue;
    const k = t.accountId + ":" + t.serviceId;
    if (!byService.has(k)) byService.set(k, { accountId: t.accountId, serviceId: t.serviceId, keys: new Set() });
    byService.get(k).keys.add(t.key);
  }
  const results = [];
  for (const svc of byService.values()) {
    const account = accounts.get(svc.accountId);
    if (!account) { results.push({ serviceId: svc.serviceId, ok: false, error: "Render account not connected." }); continue; }
    const base = "/v1/services/" + encodeURIComponent(svc.serviceId);
    let changed = 0;
    try {
      const vars = (await fetchAllPages((p) => renderRequest(account.apiKey, p), base + "/env-vars")).items.map((i) => i?.envVar || i);
      for (const v of vars) {
        if (!svc.keys.has(v.key)) continue;
        const next = replaceHost(v.value, fromUrl, toUrl);
        if (next === v.value) continue;
        await renderRequest(account.apiKey, base + "/env-vars/" + encodeURIComponent(v.key), { method: "PUT", body: { value: next } });
        changed += 1;
      }
      let deployed = false;
      if (deploy && changed) { try { await renderRequest(account.apiKey, base + "/deploys", { method: "POST", body: { clearCache: "do_not_clear" } }); deployed = true; } catch { /* variables are saved */ } }
      results.push({ serviceId: svc.serviceId, ok: true, changed, deployed });
    } catch (error) { results.push({ serviceId: svc.serviceId, ok: false, error: error?.message || "Render refused the change." }); }
  }
  return { results, changed: results.reduce((n, r) => n + (r.changed || 0), 0) };
}

module.exports = { replaceHost, findUrlReferences, replaceUrlReferences };
