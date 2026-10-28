/* Scans the env vars of every running Render service the user connected, once, for two things:
   - secrets that are published to the browser or app by their name (REACT_APP_, VITE_, ...)
   - backend addresses that point at a Render service which no longer runs (registry drift)
   Values are read from Render only in memory. The result has names, hosts and masked previews, never values. */
const renderOps = require("./renderOps");
const { findExposedSecrets } = require("./secretExposure");
const { findStaleAddresses } = require("./envDrift");

/** GET /v1/services/{id}/env-vars returns [{ envVar: { key, value } }]. */
function varsFromPayload(payload) {
  const list = Array.isArray(payload) ? payload : [];
  return list.map((item) => item?.envVar || item).filter((v) => v && typeof v.key === "string")
    .map((v) => ({ key: v.key, value: v.value }));
}

async function scanUser(user) {
  const dataKey = await user.getDataKey();
  const { services, complete } = await renderOps.listEveryService(user, dataKey);
  const running = services.filter((s) => !s.suspended);
  const secrets = [];
  const stale = [];
  let scanned = 0;
  for (const service of running) {
    const apiKey = renderOps.accountApiKey(user, dataKey, service.accountId);
    if (!apiKey) continue;
    try {
      const payload = await renderOps.renderRequest(apiKey, "/v1/services/" + encodeURIComponent(service.id) + "/env-vars");
      scanned += 1;
      const vars = varsFromPayload(payload);
      for (const item of findExposedSecrets(vars)) secrets.push({ service: service.name, serviceId: service.id, ...item });
      for (const item of findStaleAddresses(vars, services)) stale.push({ service: service.name, serviceId: service.id, ...item });
    } catch { /* one service failing must not hide the others; it is simply not counted as scanned */ }
  }
  return { scanned, total: running.length, complete, findings: secrets, staleAddresses: stale };
}

module.exports = { scanUser, varsFromPayload };
