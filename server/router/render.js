const express = require("express");
const mongoose = require("mongoose");
const renderOps = require("../utils/renderOps");
const { fetchAllPages } = require("../utils/renderPaging");
const { syncProjectEnv, runAllEnvSync } = require("../utils/renderEnvSync");
const { getProjectStatuses, runAllAutoLink, clearServicesCache } = require("../utils/projectStatus");
const { runUsage, runAllUsage, readSettings, saveSettings } = require("../utils/usageIO");
const { pushProjectEnv } = require("../utils/renderEnvPush");
const { provision } = require("../utils/provision");
const { groupKey, mergeProjects } = require("../utils/projectMerge");
const { syncAllProjects } = require("../utils/projectSyncAll");
const { autoSyncProjects } = require("../utils/projectAutoSync");
const { runTick, lastTick } = require("../utils/scheduler");
const { runUserPings, pingResults, scanHealthRoutes } = require("../utils/pings");
const { getProjectDeployments } = require("../utils/projectDeployments");
const { validateProvisionInput } = require("../utils/provisionInput");
const { githubSend, probeScopes, loadGithubAccounts } = require("../utils/githubClient");
const { buildRegistrySync, setAutoSync, runAllRegistrySync } = require("../utils/registrySyncIO");
const { isAdminUser } = require("./registry");
const { checkServiceDeletion, parseBulkTargets, mapWithConcurrency } = require("../utils/renderGuards");
const User = require("../models/schema");
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");

const router = express.Router();
const RENDER_API = "https://api.render.com";
const MAX_ACCOUNTS = 10;
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 90, message: "Too many Render dashboard requests. Please slow down." });
const text = (value, max = 200) => typeof value === "string" ? value.trim().slice(0, max) : "";

function publicAccount(entry, dataKey) {
  const fields = User.publicEntry(entry, dataKey);
  return {
    id: String(entry._id),
    name: fields.name || "Render account",
    connectedAt: fields.connectedAt || entry.createdAt,
    lastValidatedAt: fields.lastValidatedAt || null
  };
}

async function getAccount(req, res) {
  const id = String(req.params.accountId || "");
  if (!mongoose.isValidObjectId(id)) {
    res.status(404).json({ error: "Render account not found." });
    return null;
  }
  const entry = (req.rootUser.renderAccounts || []).find((item) => String(item._id) === id);
  if (!entry || entry.enc !== "udk") {
    res.status(404).json({ error: "Render account not found." });
    return null;
  }
  try {
    const dataKey = await req.rootUser.getDataKey();
    const account = User.publicEntry(entry, dataKey);
    if (!account || !account.apiKey) {
      res.status(422).json({ error: "Saved Render connection could not be decrypted. Reconnect this account." });
      return null;
    }
    return { entry, account, dataKey };
  } catch (error) {
    res.status(500).json({ error: "Could not open the saved Render connection." });
    return null;
  }
}

async function renderRequest(apiKey, path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const headers = new Headers({ Authorization: "Bearer " + apiKey, Accept: "application/json" });
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    const response = await fetch(RENDER_API + path, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal
    });
    const raw = await response.text();
    let payload = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch { payload = { message: "Render returned a non-JSON response." }; }
    if (!response.ok) {
      const message = typeof payload?.message === "string" ? payload.message.slice(0, 400) : "Render API request failed.";
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error.name === "AbortError") {
      const timeout = new Error("Render API request timed out. Try again.");
      timeout.status = 504;
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function sendUpstreamError(res, error) {
  if (error && Number.isInteger(error.status) && error.status >= 400 && error.status < 600) {
    return res.status(error.status).json({ error: error.message || "Render API request failed." });
  }
  return res.status(502).json({ error: "Could not reach Render API. Please retry in a moment." });
}

/** Every page of a Render list endpoint (bounded). `truncated` is true only if the page cap was hit. */
const listAll = (apiKey, path, options) => fetchAllPages((next) => renderRequest(apiKey, next), path, options);
const unwrap = (rows, kind) => rows.map((item) => item?.[kind] || item).filter(Boolean);
const TRUNCATED_MESSAGE = "This resource has more entries than Stashr can safely load at once, so the operation was cancelled.";

const safeId = (value) => /^[A-Za-z0-9_-]{1,160}$/.test(String(value || ""));
const servicePath = (serviceId, suffix = "") => "/v1/services/" + encodeURIComponent(serviceId) + suffix;

/* External scheduler endpoint. Set RENDER_MONITOR_CRON_SECRET and call this
   endpoint from a trusted scheduler every 5 minutes. No user credentials are
   accepted here; the shared secret is compared in constant time. */
router.post("/render/ops/tick", apiLimiter, async (req, res) => {
  const expected = process.env.RENDER_MONITOR_CRON_SECRET || "";
  const authorization = String(req.get("authorization") || "");
  const candidate = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!renderOps.verifySecret(candidate, expected)) return res.status(expected ? 401 : 503).json({ error: expected ? "Invalid scheduler credential." : "Persistent monitoring scheduler is not configured." });
  try {
    const summary = await runTick("external");
    res.set("Cache-Control", "no-store");
    return res.json(summary);
  } catch {
    return res.status(500).json({ error: "Monitoring tick failed. Check server logs without logging secrets." });
  }
});

/* All user-facing Render operations use Stashr's authenticated session. */
router.use("/render", authenticate, apiLimiter);

/* Anything that changes services (delete, suspend, resume, create, deploy) invalidates the cached service list,
   so every page shows the new state on its next refresh. */
router.use("/render", (req, res, next) => {
  if (req.method !== "GET") res.on("finish", () => { try { clearServicesCache(req.rootUser._id); } catch { /* cache only */ } });
  next();
});

router.get("/render/ops/config", async (req, res) => {
  try {
    const config = await renderOps.readConfig(req.rootUser);
    res.set("Cache-Control", "no-store");
    return res.json({ config: renderOps.publicConfig(config), schedulerConfigured: Boolean(process.env.RENDER_MONITOR_CRON_SECRET), aiDiagnosisAvailable: Boolean(process.env.GROQ_API_KEY) });
  } catch {
    return res.status(500).json({ error: "Could not load monitoring configuration." });
  }
});

router.put("/render/ops/config", async (req, res) => {
  try {
    const previous = await renderOps.readConfig(req.rootUser);
    const normalized = renderOps.normalizeConfig(req.body, previous);
    const allowedAccounts = new Set((req.rootUser.renderAccounts || []).filter((entry) => entry.enc === "udk").map((entry) => String(entry._id)));
    normalized.groups = normalized.groups.map((group) => {
      const serviceKeys = group.serviceKeys.filter((key) => allowedAccounts.has(key.slice(0, key.indexOf(":"))));
      return {
        ...group,
        serviceKeys,
        dependencies: (group.dependencies || []).filter((edge) => serviceKeys.includes(edge.from) && serviceKeys.includes(edge.to)),
        serviceCostEstimates: Object.fromEntries(Object.entries(group.serviceCostEstimates || {}).filter(([key]) => serviceKeys.includes(key)))
      };
    }).filter((group) => group.serviceKeys.length >= 2);
    const saved = await renderOps.saveConfig(req.rootUser, normalized);
    await recordAudit(req, "monitoring_config_updated", "", "", {
      groups: saved.groups.length, monitoringEnabled: saved.monitor.enabled,
      telegramConfigured: Boolean(saved.notifications.telegramBotToken && saved.notifications.telegramChatId)
    });
    res.set("Cache-Control", "no-store");
    return res.json({ config: renderOps.publicConfig(saved), schedulerConfigured: Boolean(process.env.RENDER_MONITOR_CRON_SECRET), aiDiagnosisAvailable: Boolean(process.env.GROQ_API_KEY) });
  } catch {
    return res.status(500).json({ error: "Could not save monitoring configuration." });
  }
});

/* When the background upkeep last ran (no user data), so the UI can say whether monitoring is alive. */
router.get("/render/ops/status", async (req, res) => {
  const t = lastTick();
  res.set("Cache-Control", "no-store");
  return res.json({ lastTick: t ? { source: t.source, startedAt: t.startedAt, completedAt: t.completedAt, usersChecked: t.usersChecked || 0, groupsChecked: t.groupsChecked || 0, incidentsOpened: t.incidentsOpened || 0 } : null, schedulerEnabled: String(process.env.INTERNAL_SCHEDULER).toLowerCase() !== "false", serverStartedAt: new Date(Date.now() - process.uptime() * 1000).toISOString() });
});

/* Ping jobs (Stashr's cron): latest result per job, run all now, and a one-off /health scan of every server. */
router.get("/render/ops/pings", async (req, res) => {
  res.set("Cache-Control", "no-store");
  return res.json({ results: pingResults(req.rootUser._id) });
});
router.post("/render/ops/pings/run", async (req, res) => {
  try { const r = await runUserPings(req.rootUser, { force: true }); res.set("Cache-Control", "no-store"); return res.json({ ...r, results: pingResults(req.rootUser._id) }); }
  catch { return res.status(500).json({ error: "Could not run the ping jobs." }); }
});
router.post("/render/ops/health-scan", async (req, res) => {
  try { res.set("Cache-Control", "no-store"); return res.json({ services: await scanHealthRoutes(req.rootUser) }); }
  catch { return res.status(500).json({ error: "Could not scan the servers." }); }
});

router.get("/render/ops/history", async (req, res) => {
  try {
    const dataKey = await req.rootUser.getDataKey();
    const limit = Math.max(1, Math.min(200, Number.parseInt(req.query.limit, 10) || 100));
    const history = renderOps.encryptedList(req.rootUser, "renderMetricHistory", dataKey, limit);
    res.set("Cache-Control", "no-store");
    return res.json({ history });
  } catch {
    return res.status(500).json({ error: "Could not load monitoring history." });
  }
});

router.get("/render/ops/incidents", async (req, res) => {
  try {
    const dataKey = await req.rootUser.getDataKey();
    const limit = Math.max(1, Math.min(200, Number.parseInt(req.query.limit, 10) || 100));
    const incidents = renderOps.encryptedList(req.rootUser, "renderIncidents", dataKey, limit).reverse();
    res.set("Cache-Control", "no-store");
    return res.json({ incidents });
  } catch {
    return res.status(500).json({ error: "Could not load incident history." });
  }
});

/* Close open incidents by hand (ids, or all) and clear closed history. Neither touches Render. */
router.post("/render/ops/incidents/resolve", async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((v) => typeof v === "string" && v.length <= 80).slice(0, 200) : null;
  if (!ids && req.body?.all !== true) return res.status(400).json({ error: "Choose incidents to resolve." });
  try {
    const verified = req.body?.verified === true;
    const reason = verified && typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 200) : undefined;
    const result = await renderOps.resolveIncidents(req.rootUser, { ids, ...(reason ? { reason } : {}), by: verified ? "check" : "manual" });
    await recordAudit(req, "incidents_resolved", "", "", { count: result.resolved });
    res.set("Cache-Control", "no-store");
    return res.json(result);
  } catch { return res.status(500).json({ error: "Could not resolve incidents." }); }
});

router.post("/render/ops/incidents/clear", async (req, res) => {
  try {
    const result = await renderOps.clearClosedIncidents(req.rootUser);
    await recordAudit(req, "incidents_cleared", "", "", { count: result.removed });
    res.set("Cache-Control", "no-store");
    return res.json(result);
  } catch { return res.status(500).json({ error: "Could not clear incident history." }); }
});

router.post("/render/ops/run", async (req, res) => {
  try {
    const result = await renderOps.runUserMonitoring(req.rootUser, { force: true });
    await recordAudit(req, "monitoring_run_manual", "", "", {
      groupsChecked: result.groupsChecked || 0, incidentsOpened: result.incidentsOpened || 0
    });
    res.set("Cache-Control", "no-store");
    return res.json(result);
  } catch {
    return res.status(502).json({ error: "Could not run a monitoring sample. Check connected Render credentials and service availability." });
  }
});

router.post("/render/ops/diagnose", async (req, res) => {
  if (req.body?.allowExternalProcessing !== true) {
    return res.status(400).json({ error: "Explicit consent is required before sending redacted logs to the optional AI provider." });
  }
  const apiKey = process.env.GROQ_API_KEY || "";
  if (!apiKey) return res.status(503).json({ error: "AI diagnosis is not configured. Set GROQ_API_KEY on the server, or use the built-in rule-based diagnosis." });
  const rawLogs = Array.isArray(req.body?.logs) ? req.body.logs.join("\n") : String(req.body?.logs || "");
  if (!rawLogs.trim() || rawLogs.length > 20000) return res.status(400).json({ error: "Provide 1–20,000 characters of logs." });
  const serviceName = String(req.body?.serviceName || "Render service").replace(/[\r\n]/g, " ").slice(0, 120);
  const redacted = rawLogs
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:rnd_[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9_]+|xox[baprs]-[A-Za-z0-9-]+)\b/g, "[REDACTED_SECRET]")
    .replace(/\b(password|token|secret|api[_-]?key|authorization)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1=[REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .slice(0, 16000);
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
        temperature: 0.2,
        max_tokens: 700,
        messages: [
          { role: "system", content: "You are a cautious SRE assistant. Diagnose only from the supplied redacted logs. Separate evidence from hypotheses, give the 3 most likely causes, safe verification steps, and rollback/mitigation advice. Never ask for secrets. State uncertainty and do not claim to have inspected infrastructure outside these logs." },
          { role: "user", content: "Service: " + serviceName + "\nAnalyze these redacted Render logs. They may still contain sensitive operational context; do not repeat identifiers unnecessarily.\n\n" + redacted }
        ]
      }),
      signal: AbortSignal.timeout(20000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(502).json({ error: "The AI provider rejected the request. Check provider quota/model configuration." });
    const diagnosis = payload?.choices?.[0]?.message?.content;
    if (typeof diagnosis !== "string" || !diagnosis.trim()) return res.status(502).json({ error: "The AI provider returned no diagnosis." });
    await recordAudit(req, "ai_log_diagnosis", "", "", { serviceName, provider: "groq", redactedCharacters: redacted.length });
    res.set("Cache-Control", "no-store");
    return res.json({ diagnosis: diagnosis.slice(0, 12000), provider: "groq", model: process.env.GROQ_MODEL || "openai/gpt-oss-120b", redactedCharacters: redacted.length });
  } catch {
    return res.status(502).json({ error: "Could not reach the optional AI provider. Rule-based diagnosis remains available." });
  }
});

router.post("/render/ops/notify/test", async (req, res) => {
  try {
    const config = await renderOps.readConfig(req.rootUser);
    if (!config.notifications?.telegramBotToken || !config.notifications?.telegramChatId) {
      return res.status(400).json({ error: "Configure a Telegram bot token and chat ID first." });
    }
    const result = await renderOps.sendTelegram(config, "Stashr Render monitoring test\nYour Telegram alert channel is configured.\nAt: " + new Date().toISOString());
    if (!result.sent) return res.status(502).json({ error: "Telegram did not accept the test message. Check the bot token and chat ID." });
    await recordAudit(req, "monitoring_notification_test", "", "", { channel: "telegram" });
    return res.json({ ok: true, message: "Test notification sent." });
  } catch {
    return res.status(502).json({ error: "Could not send a Telegram test notification." });
  }
});

router.get("/render/ops/report", async (req, res) => {
  try {
    const dataKey = await req.rootUser.getDataKey();
    const history = renderOps.encryptedList(req.rootUser, "renderMetricHistory", dataKey, 200);
    const incidents = renderOps.encryptedList(req.rootUser, "renderIncidents", dataKey, 200);
    const config = await renderOps.readConfig(req.rootUser);
    const report = {
      generatedAt: new Date().toISOString(),
      monitoringEnabled: Boolean(config.monitor?.enabled),
      groups: (config.groups || []).map((group) => ({ id: group.id, name: group.name, serviceCount: group.serviceKeys.length, dependencies: group.dependencies || [], serviceCostEstimates: group.serviceCostEstimates || {}, estimatedMonthlyCostUsd: Object.values(group.serviceCostEstimates || {}).reduce((sum, value) => sum + Number(value || 0), 0), monthlyBudgetUsd: group.monthlyBudgetUsd || 0 })),
      history: history.map((item) => ({
        sampledAt: item.sampledAt, groupId: item.groupId, groupName: item.groupName,
        combined: item.combined || {}, estimatedMonthlyCostUsd: item.estimatedMonthlyCostUsd || 0, monthlyBudgetUsd: item.monthlyBudgetUsd || 0, costCoverageCount: item.costCoverageCount || 0, costCoverageComplete: Boolean(item.costCoverageComplete), services: (item.services || []).map((service) => ({
          name: service.name, serviceId: service.serviceId, type: service.type || "unknown", health: service.health?.state || "unknown",
          metrics: service.metrics || {}, suspended: Boolean(service.suspended), latestDeploy: service.latestDeploy || null, latestManualExport: service.latestManualExport || null
        }))
      })),
      incidents: incidents.map((item) => ({
        at: item.at, openedAt: item.openedAt, groupName: item.groupName, serviceName: item.serviceName,
        type: item.type, severity: item.severity, state: item.state, message: item.message
      }))
    };
    res.set("Cache-Control", "no-store");
    if (String(req.query.format || "").toLowerCase() === "csv") {
      const rows = [["record_type","timestamp","group","service","metric","value","unit","severity","state","message"]];
      report.groups.forEach((group) => rows.push(["cost_estimate", report.generatedAt, group.name, "", "monthly_estimate", group.estimatedMonthlyCostUsd, "USD", "", "", "budget=" + group.monthlyBudgetUsd + "; manual estimate"]));
      report.history.forEach((sample) => (sample.services || []).forEach((service) => {
        Object.entries(service.metrics || {}).forEach(([metric, value]) => rows.push([
          "metric", sample.sampledAt, sample.groupName, service.name, metric,
          value.current == null ? "" : value.current, value.unit || "", "", "", ""
        ]));
        rows.push(["health", sample.sampledAt, sample.groupName, service.name, "", "", "", "", service.health, ""]);
        if (service.latestManualExport) rows.push(["database_export", service.latestManualExport.createdAt || sample.sampledAt, sample.groupName, service.name, "manual_export", "", "", "", service.latestManualExport.status || "unknown", service.latestManualExport.id || ""]);
      }));
      report.incidents.forEach((incident) => rows.push(["incident", incident.at, incident.groupName, incident.serviceName, incident.type, "", "", incident.severity, incident.state, incident.message]));
      const csv = rows.map((row) => row.map((value) => {
        let valueText = String(value ?? "");
        // Prevent spreadsheet formula injection when exported names/log text are opened in Excel.
        if (/^\s*[=+@-]/.test(valueText)) valueText = "'" + valueText;
        return /[",\r\n]/.test(valueText) ? '"' + valueText.replace(/"/g, '""') + '"' : valueText;
      }).join(",")).join("\r\n");
      res.set("Content-Type", "text/csv; charset=utf-8");
      res.set("Content-Disposition", 'attachment; filename="stashr-render-ops-report.csv"');
      return res.send(csv);
    }
    return res.json(report);
  } catch {
    return res.status(500).json({ error: "Could not generate the monitoring report." });
  }
});

router.get("/render/accounts", async (req, res) => {
  try {
    const dataKey = await req.rootUser.getDataKey();
    const accounts = (req.rootUser.renderAccounts || []).filter((entry) => entry.enc === "udk").map((entry) => publicAccount(entry, dataKey));
    res.set("Cache-Control", "no-store");
    return res.json({ accounts });
  } catch (error) {
    return res.status(500).json({ error: "Could not load Render connections." });
  }
});

router.post("/render/accounts", async (req, res) => {
  const name = text(req.body.name, 80) || "Render account";
  const apiKey = typeof req.body.apiKey === "string" ? req.body.apiKey.trim() : "";
  if (!apiKey || apiKey.length > 4096 || /[\r\n]/.test(apiKey)) {
    return res.status(400).json({ error: "Enter a valid Render API key." });
  }
  if ((req.rootUser.renderAccounts || []).length >= MAX_ACCOUNTS) {
    return res.status(400).json({ error: "You can connect up to 10 Render accounts." });
  }
  try {
    // Validate the credential before saving it. The key is never returned in this response.
    const listing = await listAll(apiKey, "/v1/services");
    const dataKey = await req.rootUser.getDataKey();
    const now = new Date();
    const entry = {
      _id: new mongoose.Types.ObjectId(),
      enc: "udk",
      data: User.sealEntry(dataKey, { name, apiKey, connectedAt: now.toISOString(), lastValidatedAt: now.toISOString() }),
      createdAt: now,
      updatedAt: now
    };
    await User.updateOne({ _id: req.rootUser._id }, { $push: { renderAccounts: entry } });
    return res.status(201).json({
      account: publicAccount(entry, dataKey),
      services: unwrap(listing.items, "service"),
      truncated: listing.truncated
    });
  } catch (error) {
    return sendUpstreamError(res, error);
  }
});

router.delete("/render/accounts/:accountId", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.accountId)) return res.status(404).json({ error: "Render account not found." });
  try {
    const result = await User.updateOne(
      { _id: req.rootUser._id, "renderAccounts._id": req.params.accountId },
      { $pull: { renderAccounts: { _id: req.params.accountId } } }
    );
    if (!result.matchedCount) return res.status(404).json({ error: "Render account not found." });
    return res.json({ message: "Render connection removed." });
  } catch (error) {
    return res.status(500).json({ error: "Could not remove Render connection." });
  }
});

router.get("/render/accounts/:accountId/services", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  try {
    const listing = await listAll(saved.account.apiKey, "/v1/services");
    await User.updateOne(
      { _id: req.rootUser._id, "renderAccounts._id": saved.entry._id },
      { $set: { "renderAccounts.$.updatedAt": new Date() } }
    );
    return res.json({ services: unwrap(listing.items, "service"), truncated: listing.truncated });
  } catch (error) { return sendUpstreamError(res, error); }
});

router.get("/render/accounts/:accountId/logs", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  const ownerId = text(req.query.ownerId, 160);
  const resource = text(req.query.resource, 160);
  const startTime = text(req.query.startTime, 50);
  const endTime = text(req.query.endTime, 50);
  if (!ownerId || !resource || !Number.isFinite(Date.parse(startTime)) || !Number.isFinite(Date.parse(endTime))) {
    return res.status(400).json({ error: "ownerId, resource, startTime and endTime are required." });
  }
  const params = new URLSearchParams({
    ownerId, resource, startTime, endTime,
    direction: req.query.direction === "forward" ? "forward" : "backward",
    limit: String(Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 100))),
    type: ["app", "request", "build"].includes(String(req.query.type)) ? String(req.query.type) : "app"
  });
  try { res.set("Cache-Control", "no-store"); return res.json(await renderRequest(saved.account.apiKey, "/v1/logs?" + params.toString())); }
  catch (error) { return sendUpstreamError(res, error); }
});

router.get("/render/accounts/:accountId/services/:serviceId/env-vars", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  if (!safeId(req.params.serviceId)) return res.status(400).json({ error: "Invalid service ID." });
  try {
    const listing = await listAll(saved.account.apiKey, servicePath(req.params.serviceId, "/env-vars"));
    res.set("Cache-Control", "no-store");
    return res.json({ envVars: unwrap(listing.items, "envVar"), truncated: listing.truncated });
  } catch (error) { return sendUpstreamError(res, error); }
});

router.put("/render/accounts/:accountId/services/:serviceId/env-vars/:key", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  const { serviceId, key } = req.params;
  if (!safeId(serviceId) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof req.body.value !== "string" || req.body.value.length > 20000) {
    return res.status(400).json({ error: "Invalid environment variable key or value." });
  }
  try {
    const result = await renderRequest(saved.account.apiKey, servicePath(serviceId, "/env-vars/" + encodeURIComponent(key)), {
      method: "PUT", body: { value: req.body.value }
    });
    await recordAudit(req, "env_var_updated", saved.entry._id, serviceId, { key });
    return res.json(result);
  } catch (error) { return sendUpstreamError(res, error); }
});

router.delete("/render/accounts/:accountId/services/:serviceId/env-vars/:key", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  const { serviceId, key } = req.params;
  if (!safeId(serviceId) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return res.status(400).json({ error: "Invalid environment variable key." });
  try {
    const result = await renderRequest(saved.account.apiKey, servicePath(serviceId, "/env-vars/" + encodeURIComponent(key)), { method: "DELETE" });
    await recordAudit(req, "env_var_deleted", saved.entry._id, serviceId, { key });
    return res.json(result);
  } catch (error) { return sendUpstreamError(res, error); }
});

/* Render's own event log for a service: crashes (server_failed), restarts, deploys, suspend / resume. */
router.get("/render/accounts/:accountId/services/:serviceId/events", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  if (!safeId(req.params.serviceId)) return res.status(400).json({ error: "Invalid service ID." });
  try {
    const params = new URLSearchParams({ limit: "100" });
    if (typeof req.query.startTime === "string" && !Number.isNaN(Date.parse(req.query.startTime))) params.set("startTime", new Date(req.query.startTime).toISOString());
    const rows = await renderRequest(saved.account.apiKey, servicePath(req.params.serviceId, "/events?" + params.toString()));
    const events = (Array.isArray(rows) ? rows : []).map((r) => r?.event || r).filter((e) => e && e.type).map((e) => ({
      id: String(e.id || ""), type: String(e.type), at: e.timestamp || e.createdAt || null,
      details: { status: e.details?.status ?? null, reason: typeof e.details?.reason === "object" ? JSON.stringify(e.details.reason).slice(0, 200) : String(e.details?.reason || "").slice(0, 200), deployId: e.details?.deployId || "", trigger: typeof e.details?.trigger === "object" ? Object.keys(e.details.trigger)[0] || "" : String(e.details?.trigger || "") }
    }));
    res.set("Cache-Control", "no-store");
    return res.json({ events });
  } catch (error) { return sendUpstreamError(res, error); }
});

router.get("/render/accounts/:accountId/services/:serviceId/deploys", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  if (!safeId(req.params.serviceId)) return res.status(400).json({ error: "Invalid service ID." });
  try {
    return res.json(await renderRequest(saved.account.apiKey, servicePath(req.params.serviceId, "/deploys?limit=20")));
  } catch (error) { return sendUpstreamError(res, error); }
});

router.post("/render/accounts/:accountId/services/:serviceId/deploys", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  if (!safeId(req.params.serviceId)) return res.status(400).json({ error: "Invalid service ID." });
  const clearCache = req.body.clearCache === true;
  try {
    const result = await renderRequest(saved.account.apiKey, servicePath(req.params.serviceId, "/deploys"), {
      method: "POST",
      body: { clearCache: clearCache ? "clear" : "do_not_clear", deployMode: "build_and_deploy" }
    });
    await recordAudit(req, "deploy_triggered", saved.entry._id, req.params.serviceId, { clearCache });
    return res.status(201).json(result);
  } catch (error) { return sendUpstreamError(res, error); }
});

router.post("/render/accounts/:accountId/services/:serviceId/restart", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  if (!safeId(req.params.serviceId)) return res.status(400).json({ error: "Invalid service ID." });
  try {
    const result = await renderRequest(saved.account.apiKey, servicePath(req.params.serviceId, "/restart"), { method: "POST" });
    await recordAudit(req, "service_restart", saved.entry._id, req.params.serviceId);
    return res.json(result);
  } catch (error) { return sendUpstreamError(res, error); }
});


async function recordAudit(req, action, accountId, serviceId, details = {}) {
  try {
    const dataKey = await req.rootUser.getDataKey();
    const now = new Date();
    const entry = {
      _id: new mongoose.Types.ObjectId(),
      enc: "udk",
      data: User.sealEntry(dataKey, {
        action, accountId: String(accountId || ""), serviceId: String(serviceId || ""),
        details, at: now.toISOString()
      }),
      createdAt: now, updatedAt: now
    };
    await User.updateOne(
      { _id: req.rootUser._id },
      { $push: { renderAudit: { $each: [entry], $slice: -200 } } }
    );
  } catch (error) {
    // Audit failure must not expose secrets or turn a successful upstream action into a false failure.
  }
}

router.get("/render/audit", async (req, res) => {
  try {
    const dataKey = await req.rootUser.getDataKey();
    const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 50));
    const events = (req.rootUser.renderAudit || []).slice(-limit).reverse().map((entry) => {
      if (entry.enc !== "udk") return null;
      const fields = User.publicEntry(entry, dataKey);
      if (!fields || fields.broken) return null;
      return { id: String(entry._id), ...fields };
    }).filter(Boolean);
    res.set("Cache-Control", "no-store");
    return res.json({ events });
  } catch (error) {
    return res.status(500).json({ error: "Could not load the Render audit history." });
  }
});

router.get("/render/accounts/:accountId/postgres/:postgresId/exports", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  if (!safeId(req.params.postgresId) || !String(req.params.postgresId).startsWith("dpg-")) return res.status(400).json({ error: "A valid Render Postgres ID is required." });
  try {
    const exports = await renderRequest(saved.account.apiKey, "/v1/postgres/" + encodeURIComponent(req.params.postgresId) + "/export");
    res.set("Cache-Control", "no-store");
    return res.json({ exports: Array.isArray(exports) ? exports : [] });
  } catch (error) { return sendUpstreamError(res, error); }
});

router.post("/render/accounts/:accountId/postgres/:postgresId/exports", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  if (!safeId(req.params.postgresId) || !String(req.params.postgresId).startsWith("dpg-")) return res.status(400).json({ error: "A valid Render Postgres ID is required." });
  try {
    const result = await renderRequest(saved.account.apiKey, "/v1/postgres/" + encodeURIComponent(req.params.postgresId) + "/export", { method: "POST" });
    await recordAudit(req, "postgres_export_started", saved.entry._id, req.params.postgresId);
    return res.status(202).json(result);
  } catch (error) { return sendUpstreamError(res, error); }
});

router.get("/render/accounts/:accountId/services/:serviceId/metrics", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  const serviceId = req.params.serviceId;
  if (!safeId(serviceId)) return res.status(400).json({ error: "Invalid service ID." });
  const metrics = {
    cpu: "cpu", memory: "memory", "cpu-limit": "cpu-limit", "memory-limit": "memory-limit",
    "http-latency": "http-latency", "http-requests": "http-requests", bandwidth: "bandwidth",
    "instance-count": "instance-count"
  };
  const metric = String(req.query.metric || "cpu");
  if (!Object.prototype.hasOwnProperty.call(metrics, metric)) return res.status(400).json({ error: "Unsupported metric." });
  const end = Date.now();
  const requestedStart = Date.parse(String(req.query.startTime || ""));
  const start = Number.isFinite(requestedStart) ? Math.max(end - 24 * 60 * 60 * 1000, requestedStart) : end - 60 * 60 * 1000;
  const resolution = Math.max(30, Math.min(3600, Number.parseInt(req.query.resolutionSeconds, 10) || 60));
  const params = new URLSearchParams({
    resource: serviceId,
    startTime: new Date(start).toISOString(),
    endTime: new Date(end).toISOString(),
    resolutionSeconds: String(resolution)
  });
  try {
    const data = await renderRequest(saved.account.apiKey, "/v1/metrics/" + metrics[metric] + "?" + params.toString());
    res.set("Cache-Control", "no-store");
    return res.json({ metric, startTime: new Date(start).toISOString(), endTime: new Date(end).toISOString(), data });
  } catch (error) { return sendUpstreamError(res, error); }
});

router.get("/render/accounts/:accountId/env-groups", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  try {
    const listing = await listAll(saved.account.apiKey, "/v1/env-groups");
    return res.json({ envGroups: unwrap(listing.items, "envGroup"), truncated: listing.truncated });
  } catch (error) { return sendUpstreamError(res, error); }
});

router.get("/render/accounts/:accountId/services/:serviceId/health", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  if (!safeId(req.params.serviceId)) return res.status(400).json({ error: "Invalid service ID." });
  try {
    const payload = await renderRequest(saved.account.apiKey, servicePath(req.params.serviceId));
    const service = payload?.service || payload;
    const rawUrl = service?.serviceDetails?.url;
    if (!rawUrl) return res.status(200).json({ state: service?.suspended === "suspended" ? "suspended" : "unknown", checkedAt: new Date().toISOString(), message: "Render did not provide a public URL for this service." });
    let target;
    try { target = new URL(rawUrl); } catch { return res.status(200).json({ state: "unknown", checkedAt: new Date().toISOString(), message: "The service URL is invalid." }); }
    if (target.protocol !== "https:" || target.username || target.password || !target.hostname.toLowerCase().endsWith(".onrender.com")) {
      return res.status(200).json({ state: "unsupported", checkedAt: new Date().toISOString(), message: "Only Render-provided HTTPS service URLs on *.onrender.com can be probed." });
    }
    const controller = new AbortController();
    const started = Date.now();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(target.toString(), { method: "GET", redirect: "manual", signal: controller.signal, headers: { "User-Agent": "Stashr-Render-Healthcheck/1.0", "Cache-Control": "no-cache" } });
      const status = response.status;
      await response.body?.cancel();
      const healthy = status >= 200 && status < 400;
      const result = { state: healthy ? "healthy" : "unhealthy", status, latencyMs: Date.now() - started, checkedAt: new Date().toISOString(), url: target.origin + target.pathname, message: healthy ? "Endpoint responded successfully." : "Endpoint returned HTTP " + status + "." };
      await recordAudit(req, "health_check", saved.entry._id, req.params.serviceId, { state: result.state, status, latencyMs: result.latencyMs });
      res.set("Cache-Control", "no-store");
      return res.json(result);
    } finally { clearTimeout(timer); }
  } catch (error) {
    if (error.name === "AbortError") return res.json({ state: "timeout", checkedAt: new Date().toISOString(), message: "Health check timed out after 8 seconds." });
    return sendUpstreamError(res, error);
  }
});

router.post("/render/accounts/:accountId/services/:serviceId/rollback", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  const { serviceId } = req.params;
  const deployId = text(req.body.deployId, 160);
  if (!safeId(serviceId) || !safeId(deployId)) return res.status(400).json({ error: "A valid service ID and deployment ID are required." });
  try {
    const result = await renderRequest(saved.account.apiKey, servicePath(serviceId, "/rollback"), { method: "POST", body: { deployId } });
    await recordAudit(req, "rollback", saved.entry._id, serviceId, { deployId });
    return res.status(201).json(result);
  } catch (error) { return sendUpstreamError(res, error); }
});

router.post("/render/accounts/:accountId/services/:serviceId/deploys/:deployId/cancel", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  const { serviceId, deployId } = req.params;
  if (!safeId(serviceId) || !safeId(deployId)) return res.status(400).json({ error: "Invalid service or deployment ID." });
  try {
    const result = await renderRequest(saved.account.apiKey, servicePath(serviceId, "/deploys/" + encodeURIComponent(deployId) + "/cancel"), { method: "POST" });
    await recordAudit(req, "cancel_deploy", saved.entry._id, serviceId, { deployId });
    return res.json(result);
  } catch (error) { return sendUpstreamError(res, error); }
});

/* Bulk delete: one request, many services (possibly across accounts). Every service is re-read from
   Render and skipped unless it is currently suspended, so active services can never be removed here. */
/* One-way sync of a linked Render service's env vars into a project (preview with apply=false). Names only in the response. */
/* Live status for every project (or one): auto-links to Render, then deploy drift, CI and a health score. */
router.get("/render/projects/status", async (req, res) => {
  const only = typeof req.query.id === "string" && mongoose.isValidObjectId(req.query.id) ? req.query.id : "";
  try {
    const data = await getProjectStatuses(req.rootUser, { only, refresh: req.query.refresh === "1" });
    res.set("Cache-Control", "no-store");
    return res.json(data);
  } catch { return res.status(500).json({ error: "Could not compute project status." }); }
});

/* Where a project is deployed: every linked Render service with its URL, status and an env comparison (no values). */
router.get("/render/projects/:projectId/deployments", async (req, res) => {
  try {
    const data = await getProjectDeployments(req.rootUser, req.params.projectId);
    res.set("Cache-Control", "no-store");
    return res.json(data);
  } catch (error) {
    return res.status(Number.isInteger(error.status) ? error.status : 500).json({ error: Number.isInteger(error.status) ? error.message : "Could not read this project's deployments." });
  }
});

/* Live-services usage dashboard: only running Render services, with provider usage, limits and projections. */
router.get("/render/live-dashboard", async (req, res) => {
  try {
    const dataKey = await req.rootUser.getDataKey();
    const data = await runUsage(req.rootUser, dataKey, { refresh: req.query.refresh === "1" });
    res.set("Cache-Control", "no-store");
    return res.json(data);
  } catch { return res.status(500).json({ error: "Could not build the services dashboard." }); }
});

router.get("/render/usage-settings", async (req, res) => {
  try { return res.json(readSettings(req.rootUser, await req.rootUser.getDataKey())); }
  catch { return res.status(500).json({ error: "Could not read settings." }); }
});

router.put("/render/usage-settings", async (req, res) => {
  try { return res.json(await saveSettings(req.rootUser, await req.rootUser.getDataKey(), req.body || {})); }
  catch { return res.status(500).json({ error: "Could not save settings." }); }
});

/* Servers tab sync (admin only): each registry URL matched to its Render service, plus suggestions. */
router.get("/render/registry-sync", async (req, res) => {
  if (!isAdminUser(req.rootUser)) return res.status(403).json({ error: "Not allowed." });
  try { res.set("Cache-Control", "no-store"); return res.json(await buildRegistrySync(req.rootUser)); }
  catch { return res.status(500).json({ error: "Could not load Render sync for the server list." }); }
});

router.put("/render/registry-sync/:app", async (req, res) => {
  if (!isAdminUser(req.rootUser)) return res.status(403).json({ error: "Not allowed." });
  if (typeof req.body?.autoSync !== "boolean") return res.status(400).json({ error: "autoSync must be true or false." });
  try {
    const doc = await setAutoSync(String(req.params.app || "").toLowerCase(), req.body.autoSync, req.rootUser.email);
    if (!doc) return res.status(404).json({ error: "Unknown app." });
    return res.json({ app: doc.app, autoSync: doc.autoSync !== false });
  } catch { return res.status(500).json({ error: "Could not change auto-sync." }); }
});

/* Push a project's variables to its linked Render service. Names you approve only; never deletes. */
router.post("/render/project-push/:projectId", async (req, res) => {
  const list = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === "string").slice(0, 200) : []);
  try {
    const result = await pushProjectEnv(req.rootUser, req.params.projectId, { apply: req.body?.apply === true, names: list(req.body?.names), overwrite: list(req.body?.overwrite), deploy: req.body?.deploy === true });
    if (result.applied) await recordAudit(req, "project_env_push", "", "", { projectId: String(req.params.projectId), pushed: result.pushed.length, failed: result.failed.length, deployed: result.deployed });
    res.set("Cache-Control", "no-store");
    return res.json(result);
  } catch (error) {
    return res.status(Number.isInteger(error.status) ? error.status : 500).json({ error: Number.isInteger(error.status) ? error.message : "Could not push environment variables." });
  }
});

/* Render workspaces of one connected account (for the create & deploy wizard). */
router.get("/render/accounts/:accountId/owners", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  try {
    const rows = await renderRequest(saved.account.apiKey, "/v1/owners?limit=20");
    const owners = (Array.isArray(rows) ? rows : []).map((o) => o?.owner || o).filter((o) => o?.id).map((o) => ({ id: o.id, name: String(o.name || o.id), type: o.type || "" }));
    return res.json({ owners });
  } catch (error) { return sendUpstreamError(res, error); }
});

/* One-click create & deploy: GitHub repo + starter files + FREE Render service + env vars + linked Stashr project. */
const provisionLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 10, message: "Too many create requests. Please wait a few minutes." });
router.post("/render/provision", provisionLimiter, async (req, res) => {
  const parsed = validateProvisionInput(req.body);
  if (!parsed.value) return res.status(400).json({ ok: false, error: parsed.error });
  const input = parsed.value;
  try {
    const dataKey = await req.rootUser.getDataKey();
    const accountEntry = mongoose.isValidObjectId(input.renderAccountId) ? (req.rootUser.renderAccounts || []).find((item) => String(item._id) === input.renderAccountId && item.enc === "udk") : null;
    const renderAccount = accountEntry ? User.publicEntry(accountEntry, dataKey) : null;
    if (!renderAccount?.apiKey) return res.status(400).json({ ok: false, error: "Choose a connected Render account." });
    const githubAccount = loadGithubAccounts(req.rootUser, dataKey).find((a) => a.id === input.githubAccountId);
    if (!githubAccount) return res.status(400).json({ ok: false, error: "Choose a connected GitHub account." });
    const caps = await probeScopes(githubAccount.token);
    if (!caps.valid) return res.status(400).json({ ok: false, error: "This GitHub token is no longer valid. Reconnect it in Projects → GitHub." });
    if (!caps.write) return res.status(400).json({ ok: false, error: "This GitHub connection is read-only. Add a classic token with the “repo” scope to create repositories." });

    const result = await provision({
      input,
      github: { login: githubAccount.login, send: (method, path, body) => githubSend(githubAccount.token, method, path, body) },
      render: { request: (path, options = {}) => renderRequest(renderAccount.apiKey, path, options) },
      ownerId: input.ownerId || undefined,
      saveProject: async (fields) => {
        const now = new Date();
        // Deploying a repo that already has a project adds the new service to that project instead of a duplicate.
        const key = groupKey(fields);
        const existing = (req.rootUser.projects || []).find((e) => e.enc === "udk" && groupKey(User.publicEntry(e, dataKey)) === key);
        if (existing && key && !key.startsWith("name:")) {
          const { fields: merged } = mergeProjects(User.publicEntry(existing, dataKey), [fields]);
          for (const k of ["renderAccountId", "renderServiceId", "renderServiceName", "hostingServiceName", "liveUrl"]) if (fields[k]) merged[k] = fields[k];
          await User.updateOne({ _id: req.rootUser._id, "projects._id": existing._id }, { $set: { "projects.$.data": User.sealEntry(dataKey, merged), "projects.$.updatedAt": now } });
          return String(existing._id);
        }
        const item = { _id: new mongoose.Types.ObjectId(), enc: "udk", data: User.sealEntry(dataKey, fields), createdAt: now, updatedAt: now };
        await User.updateOne({ _id: req.rootUser._id }, { $push: { projects: item } });
        return String(item._id);
      },
      audit: (details) => recordAudit(req, "project_created", input.renderAccountId, "", details)
    });
    res.set("Cache-Control", "no-store");
    return res.status(result.ok ? 201 : 422).json(result);
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Could not create the project. Nothing was deleted; check GitHub and Render for anything already created." });
  }
});

router.post("/render/projects/auto-sync", async (req, res) => {
  try {
    const summary = await autoSyncProjects(req.rootUser, { force: req.body?.force === true });
    res.set("Cache-Control", "no-store");
    return res.json({ ok: true, ...summary });
  } catch (error) {
    return res.status(500).json({ error: "Could not sync projects." });
  }
});

const syncAllLimiter = rateLimit({ windowMs: 60 * 1000, max: 6, message: "Please wait a moment before syncing again." });
router.post("/render/projects/sync-all", syncAllLimiter, async (req, res) => {
  try {
    const summary = await syncAllProjects(req.rootUser);
    await recordAudit(req, "projects_sync_all", "", "", { merged: summary.merged, created: summary.created.length, refreshed: summary.refreshed });
    res.set("Cache-Control", "no-store");
    return res.json({ ok: true, ...summary });
  } catch (error) {
    return res.status(Number.isInteger(error.status) ? error.status : 500).json({ error: Number.isInteger(error.status) ? error.message : "Could not sync projects with Render." });
  }
});

router.post("/render/project-sync/:projectId", async (req, res) => {
  try {
    const result = await syncProjectEnv(req.rootUser, req.params.projectId, { apply: req.body?.apply === true, resolveConflicts: req.body?.resolveConflicts === true });
    if (result.applied) await recordAudit(req, "project_env_sync", "", "", { projectId: String(req.params.projectId), added: result.added.length, updated: result.updated.length, removed: result.removed.length, conflicts: result.conflicts.length });
    res.set("Cache-Control", "no-store");
    return res.json(result);
  } catch (error) {
    return res.status(Number.isInteger(error.status) ? error.status : 500).json({ error: Number.isInteger(error.status) ? error.message : "Could not sync environment variables." });
  }
});

router.post("/render/services/bulk-delete", async (req, res) => {
  const parsed = parseBulkTargets(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  let dataKey;
  try { dataKey = await req.rootUser.getDataKey(); }
  catch { return res.status(500).json({ error: "Could not open the saved Render connections." }); }
  const accounts = new Map();
  const accountFor = (id) => {
    if (!accounts.has(id)) {
      const entry = mongoose.isValidObjectId(id) ? (req.rootUser.renderAccounts || []).find((item) => String(item._id) === id && item.enc === "udk") : null;
      const fields = entry ? User.publicEntry(entry, dataKey) : null;
      accounts.set(id, fields?.apiKey ? { entry, apiKey: fields.apiKey } : null);
    }
    return accounts.get(id);
  };
  const allowActive = req.body?.allowActive === true;
  const results = await mapWithConcurrency(parsed.targets, 4, async ({ accountId, serviceId, confirmName }) => {
    const account = accountFor(accountId);
    if (!account) return { accountId, serviceId, ok: false, error: "Render account not found." };
    try {
      const payload = await renderRequest(account.apiKey, servicePath(serviceId));
      const service = payload?.service || payload;
      const verdict = checkServiceDeletion(service, confirmName, { requireName: false, allowActive });
      if (!verdict.ok) return { accountId, serviceId, name: service?.name, ok: false, skipped: verdict.status === 409, error: verdict.error };
      await renderRequest(account.apiKey, servicePath(serviceId), { method: "DELETE" });
      await recordAudit(req, "delete_service", account.entry._id, serviceId, { serviceName: String(service.name || "").slice(0, 120), bulk: true, wasLive: service.suspended !== "suspended" });
      return { accountId, serviceId, name: service.name, ok: true };
    } catch (error) {
      return { accountId, serviceId, ok: false, error: error?.status === 404 ? "Service no longer exists." : (error?.message || "Render API request failed.") };
    }
  });
  const deleted = results.filter((item) => item.ok).length;
  return res.json({ deleted, failed: results.length - deleted, results });
});

router.delete("/render/accounts/:accountId/services/:serviceId", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  const serviceId = req.params.serviceId;
  if (!safeId(serviceId)) return res.status(400).json({ error: "Invalid service ID." });
  try {
    // Re-read the live state from Render; never trust the client's idea of "suspended".
    const payload = await renderRequest(saved.account.apiKey, servicePath(serviceId));
    const service = payload?.service || payload;
    const verdict = checkServiceDeletion(service, req.body?.confirmName, { allowActive: req.body?.allowActive === true });
    if (!verdict.ok) return res.status(verdict.status).json({ error: verdict.error });
    await renderRequest(saved.account.apiKey, servicePath(serviceId), { method: "DELETE" });
    await recordAudit(req, "delete_service", saved.entry._id, serviceId, { serviceName: String(service.name || "").slice(0, 120), wasLive: service.suspended !== "suspended" });
    return res.json({ message: "Service deleted." });
  } catch (error) { return sendUpstreamError(res, error); }
});

router.post("/render/accounts/:accountId/services/:serviceId/suspend", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  if (!safeId(req.params.serviceId)) return res.status(400).json({ error: "Invalid service ID." });
  try {
    const result = await renderRequest(saved.account.apiKey, servicePath(req.params.serviceId, "/suspend"), { method: "POST" });
    await recordAudit(req, "suspend_service", saved.entry._id, req.params.serviceId);
    return res.json({ result, message: "Suspend requested." });
  } catch (error) { return sendUpstreamError(res, error); }
});

router.post("/render/accounts/:accountId/services/:serviceId/resume", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  if (!safeId(req.params.serviceId)) return res.status(400).json({ error: "Invalid service ID." });
  try {
    const result = await renderRequest(saved.account.apiKey, servicePath(req.params.serviceId, "/resume"), { method: "POST" });
    await recordAudit(req, "resume_service", saved.entry._id, req.params.serviceId);
    return res.json({ result, message: "Resume requested." });
  } catch (error) { return sendUpstreamError(res, error); }
});

router.get("/render/accounts/:accountId/services/:serviceId/snapshots", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  const snapshots = Array.isArray(saved.account.snapshots) ? saved.account.snapshots : [];
  return res.json({ snapshots: snapshots.map((s) => ({ id: s.id, serviceId: s.serviceId, serviceName: s.serviceName, createdAt: s.createdAt, count: Array.isArray(s.variables) ? s.variables.length : 0 })) });
});

router.post("/render/accounts/:accountId/services/:serviceId/snapshots", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  const serviceId = req.params.serviceId;
  if (!safeId(serviceId)) return res.status(400).json({ error: "Invalid service ID." });
  try {
    const [servicePayload, listing] = await Promise.all([
      renderRequest(saved.account.apiKey, servicePath(serviceId)),
      listAll(saved.account.apiKey, servicePath(serviceId, "/env-vars"))
    ]);
    if (listing.truncated) return res.status(422).json({ error: TRUNCATED_MESSAGE });
    const service = servicePayload?.service || servicePayload;
    const variables = unwrap(listing.items, "envVar").filter((item) => typeof item.key === "string")
      .map((item) => ({ key: item.key, value: typeof item.value === "string" ? item.value : "" }));
    const snapshots = Array.isArray(saved.account.snapshots) ? saved.account.snapshots.slice(-19) : [];
    const snapshot = { id: new mongoose.Types.ObjectId().toString(), serviceId, serviceName: service?.name || serviceId, createdAt: new Date().toISOString(), variables };
    const nextAccount = { ...saved.account, snapshots: [...snapshots, snapshot] };
    await User.updateOne(
      { _id: req.rootUser._id, "renderAccounts._id": saved.entry._id },
      { $set: { "renderAccounts.$.data": User.sealEntry(saved.dataKey, nextAccount), "renderAccounts.$.updatedAt": new Date() } }
    );
    await recordAudit(req, "env_snapshot_created", saved.entry._id, serviceId, { count: variables.length, snapshotId: snapshot.id });
    return res.status(201).json({ snapshot: { id: snapshot.id, serviceId, serviceName: snapshot.serviceName, createdAt: snapshot.createdAt, count: variables.length } });
  } catch (error) { return sendUpstreamError(res, error); }
});

router.post("/render/accounts/:accountId/services/:serviceId/snapshots/:snapshotId/restore", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  const { serviceId, snapshotId } = req.params;
  if (!safeId(serviceId) || !mongoose.isValidObjectId(snapshotId)) return res.status(400).json({ error: "Invalid service or snapshot ID." });
  const snapshot = (saved.account.snapshots || []).find((s) => s.id === snapshotId && s.serviceId === serviceId);
  if (!snapshot) return res.status(404).json({ error: "Environment snapshot not found." });
  try {
    const listing = await listAll(saved.account.apiKey, servicePath(serviceId, "/env-vars"));
    // Restore deletes variables missing from the snapshot, so never act on a partial listing.
    if (listing.truncated) return res.status(422).json({ error: TRUNCATED_MESSAGE });
    const current = unwrap(listing.items, "envVar").filter((item) => typeof item.key === "string");
    const wanted = new Map(snapshot.variables.map((item) => [item.key, item.value]));
    const existing = new Set(current.map((item) => item.key));
    for (const variable of snapshot.variables) {
      await renderRequest(saved.account.apiKey, servicePath(serviceId, "/env-vars/" + encodeURIComponent(variable.key)), { method: "PUT", body: { value: variable.value } });
    }
    for (const variable of current) {
      if (!wanted.has(variable.key) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(variable.key)) {
        await renderRequest(saved.account.apiKey, servicePath(serviceId, "/env-vars/" + encodeURIComponent(variable.key)), { method: "DELETE" });
      }
    }
    await recordAudit(req, "env_snapshot_restored", saved.entry._id, serviceId, { snapshotId, restoredCount: snapshot.variables.length, removedCount: [...existing].filter((key) => !wanted.has(key)).length });
    return res.json({ message: "Environment snapshot restored. A deploy may be required.", restoredCount: snapshot.variables.length });
  } catch (error) { return sendUpstreamError(res, error); }
});

module.exports = router;
