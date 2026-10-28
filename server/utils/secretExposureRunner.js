/* Scans the env vars of every running Render service the user connected, and reports the ones that look like secrets
   but are published to the browser or app by their name. Reads values from Render only in memory; the result has names
   and masked previews, never values. */
const renderOps = require("./renderOps");
const { findExposedSecrets } = require("./secretExposure");

/** GET /v1/services/{id}/env-vars returns [{ envVar: { key, value } }]. */
function varsFromPayload(payload) {
  const list = Array.isArray(payload) ? payload : [];
  return list.map((item) => item?.envVar || item).filter((v) => v && typeof v.key === "string")
    .map((v) => ({ key: v.key, value: v.value }));
}

async function scanUser(user) {
  const dataKey = await user.getDataKey();
  const { services, complete } = await renderOps.listEveryService(user, dataKey);
  const findings = [];
  let scanned = 0;
  for (const service of services.filter((s) => !s.suspended)) {
    const apiKey = renderOps.accountApiKey(user, dataKey, service.accountId);
    if (!apiKey) continue;
    try {
      const payload = await renderOps.renderRequest(apiKey, "/v1/services/" + encodeURIComponent(service.id) + "/env-vars");
      scanned += 1;
      const exposed = findExposedSecrets(varsFromPayload(payload));
      for (const item of exposed) findings.push({ service: service.name, serviceId: service.id, ...item });
    } catch { /* one service failing must not hide the others; it is counted as not scanned */ }
  }
  return { scanned, total: services.filter((s) => !s.suspended).length, complete, findings };
}

module.exports = { scanUser, varsFromPayload };
