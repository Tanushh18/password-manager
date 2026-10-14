const crypto = require("crypto");
const mongoose = require("mongoose");
const User = require("../models/schema");
const { resourceChecks } = require("./renderMetrics");

const METRICS = {
  cpu: "cpu",
  memory: "memory",
  "cpu-limit": "cpu-limit",
  "memory-limit": "memory-limit",
  "http-latency": "http-latency"
};

const MAX_GROUPS = 10;
const MAX_SERVICES_PER_GROUP = 10;
const MAX_MONITORED_SERVICES_PER_USER = 15;
const HISTORY_LIMIT = 200;
const INCIDENT_LIMIT = 200;
const TICK_WINDOW_MS = 10 * 60 * 1000;

const asEntry = (entry, dataKey) => {
  if (!entry || entry.enc !== "udk") return null;
  const value = User.publicEntry(entry, dataKey);
  return value && !value.broken ? value : null;
};
const nowIso = () => new Date().toISOString();
const safeId = (value) => /^[A-Za-z0-9_-]{1,160}$/.test(String(value || ""));
const boundedNumber = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
};
const defaultConfig = () => ({
  version: 1,
  groups: [],
  monitor: {
    enabled: false,
    intervalMinutes: 5,
    checkHealth: true,
    thresholds: { cpu: 85, memory: 90, latencyMs: 1500 }
  },
  notifications: { telegramBotToken: "", telegramChatId: "" },
  updatedAt: nowIso()
});

function normalizeConfig(input, previous = defaultConfig()) {
  const source = input && typeof input === "object" ? input : {};
  const prior = previous && typeof previous === "object" ? previous : defaultConfig();
  const groups = Array.isArray(source.groups) ? source.groups.slice(0, MAX_GROUPS).map((group, index) => {
    const serviceKeys = [...new Set((Array.isArray(group?.serviceKeys) ? group.serviceKeys : [])
      .filter((key) => typeof key === "string" && key.length <= 220 && /^[A-Za-z0-9_-]{1,64}:[A-Za-z0-9_-]{1,160}$/.test(key)))]
      .slice(0, MAX_SERVICES_PER_GROUP);
    const dependencies = Array.isArray(group?.dependencies) ? group.dependencies.slice(0, 100)
      .filter((edge) => serviceKeys.includes(edge?.from) && serviceKeys.includes(edge?.to) && edge.from !== edge.to)
      .map((edge) => ({ from: edge.from, to: edge.to })) : [];
    const estimates = {};
    const rawEstimates = group?.serviceCostEstimates && typeof group.serviceCostEstimates === "object" ? group.serviceCostEstimates : {};
    Object.entries(rawEstimates).forEach(([key, amount]) => {
      const value = Number(amount);
      if (serviceKeys.includes(key) && Number.isFinite(value) && value >= 0 && value <= 100000) estimates[key] = Math.round(value * 100) / 100;
    });
    return {
      id: typeof group?.id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(group.id) ? group.id : "group-" + (index + 1),
      name: String(group?.name || "Server group " + (index + 1)).trim().slice(0, 60) || "Server group " + (index + 1),
      serviceKeys,
      dependencies: [...new Map(dependencies.map((edge) => [edge.from + ">" + edge.to, edge])).values()],
      serviceCostEstimates: estimates,
      monthlyBudgetUsd: boundedNumber(group?.monthlyBudgetUsd, 0, 1000000, 0)
    };
  }).filter((group) => group.serviceKeys.length >= 2) : prior.groups || [];

  const sourceMonitor = source.monitor && typeof source.monitor === "object" ? source.monitor : {};
  const priorMonitor = prior.monitor || {};
  const thresholds = sourceMonitor.thresholds && typeof sourceMonitor.thresholds === "object" ? sourceMonitor.thresholds : {};
  const sourceNotifications = source.notifications && typeof source.notifications === "object" ? source.notifications : {};
  const priorNotifications = prior.notifications || {};
  const telegramBotToken = sourceNotifications.clearTelegramToken === true
    ? ""
    : (typeof sourceNotifications.telegramBotToken === "string" && sourceNotifications.telegramBotToken.trim()
      ? sourceNotifications.telegramBotToken.trim().slice(0, 512)
      : priorNotifications.telegramBotToken || "");
  const telegramChatId = sourceNotifications.clearTelegramChatId === true
    ? ""
    : (typeof sourceNotifications.telegramChatId === "string" && sourceNotifications.telegramChatId.trim()
      ? sourceNotifications.telegramChatId.trim().slice(0, 120)
      : priorNotifications.telegramChatId || "");

  return {
    version: 1,
    groups,
    monitor: {
      enabled: sourceMonitor.enabled === undefined ? Boolean(priorMonitor.enabled) : sourceMonitor.enabled === true,
      intervalMinutes: [5, 10, 15].includes(Number(sourceMonitor.intervalMinutes)) ? Number(sourceMonitor.intervalMinutes) : Number(priorMonitor.intervalMinutes) || 5,
      checkHealth: sourceMonitor.checkHealth === undefined ? priorMonitor.checkHealth !== false : sourceMonitor.checkHealth === true,
      thresholds: {
        cpu: boundedNumber(thresholds.cpu, 1, 100, Number(priorMonitor.thresholds?.cpu) || 85),
        memory: boundedNumber(thresholds.memory, 1, 100, Number(priorMonitor.thresholds?.memory) || 90),
        latencyMs: boundedNumber(thresholds.latencyMs, 100, 60000, Number(priorMonitor.thresholds?.latencyMs) || 1500)
      }
    },
    notifications: { telegramBotToken, telegramChatId },
    updatedAt: nowIso()
  };
}

async function readConfig(user) {
  const entry = (user.renderOps || [])[0];
  if (!entry) return defaultConfig();
  const key = await user.getDataKey();
  return asEntry(entry, key) || defaultConfig();
}

async function saveConfig(user, config) {
  const key = await user.getDataKey();
  const sealed = {
    enc: "udk",
    data: User.sealEntry(key, config),
    createdAt: new Date(),
    updatedAt: new Date()
  };
  if (user.renderOps && user.renderOps.length) {
    user.renderOps[0].enc = sealed.enc;
    user.renderOps[0].data = sealed.data;
    user.renderOps[0].updatedAt = sealed.updatedAt;
    user.markModified("renderOps");
  } else {
    user.renderOps = [sealed];
  }
  await user.save();
  return config;
}

async function saveEncryptedList(userId, field, entries, limit) {
  if (!["renderMetricHistory", "renderIncidents"].includes(field)) throw new Error("Unsupported Render operations collection.");
  if (!entries.length) return;
  const bounded = entries.slice(-limit);
  await User.updateOne({ _id: userId }, { $push: { [field]: { $each: bounded, $slice: -limit } } });
}

async function sendTelegram(config, message) {
  const token = config?.notifications?.telegramBotToken;
  const chatId = config?.notifications?.telegramChatId;
  if (!token || !chatId) return { sent: false, reason: "not_configured" };
  try {
    const response = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: String(message).slice(0, 3500), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000)
    });
    const result = await response.json().catch(() => ({}));
    return response.ok && result.ok ? { sent: true } : { sent: false, reason: "provider_rejected" };
  } catch {
    return { sent: false, reason: "provider_unavailable" };
  }
}

async function renderRequest(apiKey, path, options = {}) {
  const headers = { Authorization: "Bearer " + apiKey, Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch("https://api.render.com" + path, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(options.timeoutMs || 12000)
  });
  const raw = await response.text();
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch { payload = null; }
  if (!response.ok) {
    const detail = typeof payload?.message === "string" ? payload.message.slice(0, 300) : "";
    const error = new Error(detail || "Render API request failed (" + response.status + ").");
    error.status = response.status;
    throw error;
  }
  return payload;
}

function extractPoints(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  return data.flatMap((series) => Array.isArray(series?.values) ? series.values : [])
    .map((point) => ({ timestamp: point.timestamp, value: Number(point.value), unit: String(point.unit || "") }))
    .filter((point) => Number.isFinite(point.value) && Number.isFinite(Date.parse(point.timestamp)))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

async function probeService(service) {
  if (service?.suspended === "suspended") return { state: "suspended", checkedAt: nowIso() };
  const rawUrl = service?.serviceDetails?.url;
  if (!rawUrl) return { state: "unknown", checkedAt: nowIso(), message: "No Render-provided public URL." };
  let target;
  try { target = new URL(rawUrl); } catch { return { state: "unknown", checkedAt: nowIso(), message: "Invalid service URL." }; }
  if (target.protocol !== "https:" || target.username || target.password || !target.hostname.toLowerCase().endsWith(".onrender.com")) {
    return { state: "unsupported", checkedAt: nowIso(), message: "Only Render-provided HTTPS *.onrender.com URLs are probed." };
  }
  const started = Date.now();
  try {
    const response = await fetch(target.toString(), {
      method: "GET", redirect: "manual", signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": "Stashr-Render-Monitor/1.0", "Cache-Control": "no-cache" }
    });
    await response.body?.cancel();
    return { state: response.status >= 200 && response.status < 400 ? "healthy" : "unhealthy", status: response.status, latencyMs: Date.now() - started, checkedAt: nowIso() };
  } catch (error) {
    return { state: error.name === "TimeoutError" || error.name === "AbortError" ? "timeout" : "unhealthy", latencyMs: Date.now() - started, checkedAt: nowIso() };
  }
}

function encryptedList(user, field, dataKey, limit = 100) {
  return (user[field] || []).slice(-limit).map((entry) => asEntry(entry, dataKey)).filter(Boolean);
}

async function runUserMonitoring(user, options = {}) {
  const config = await readConfig(user);
  if (!options.force && !config.monitor?.enabled) return { skipped: true, groupsChecked: 0, samplesSaved: 0, incidentsOpened: 0 };
  const dataKey = await user.getDataKey();
  if (!options.force) {
    const lastSample = encryptedList(user, "renderMetricHistory", dataKey, 1)[0];
    const lastAt = Date.parse(lastSample?.sampledAt || "");
    const intervalMs = (Number(config.monitor?.intervalMinutes) || 5) * 60 * 1000;
    if (Number.isFinite(lastAt) && Date.now() - lastAt < intervalMs) {
      return { skipped: true, reason: "interval_not_elapsed", groupsChecked: 0, samplesSaved: 0, incidentsOpened: 0 };
    }
  }
  const priorIncidents = encryptedList(user, "renderIncidents", dataKey, INCIDENT_LIMIT);
  const pendingHistory = [];
  const pendingIncidents = [];
  let groupsChecked = 0;
  let incidentsOpened = 0;
  const now = Date.now();
  const startTime = new Date(now - TICK_WINDOW_MS).toISOString();
  const endTime = new Date(now).toISOString();

  const accountCache = new Map();
  const serviceCache = new Map();
  const observedServices = new Map();
  let remainingServiceBudget = MAX_MONITORED_SERVICES_PER_USER;
  const configuredGroups = (config.groups || []).slice(0, MAX_GROUPS);
  const rotationInterval = (Number(config.monitor?.intervalMinutes) || 5) * 60 * 1000;
  const rotation = configuredGroups.length ? Math.floor(now / rotationInterval) % configuredGroups.length : 0;
  const groupsToSample = [...configuredGroups.slice(rotation), ...configuredGroups.slice(0, rotation)];
  async function resolveService(key) {
    if (serviceCache.has(key)) return serviceCache.get(key);
    const split = key.indexOf(":");
    const accountId = key.slice(0, split);
    const serviceId = key.slice(split + 1);
    const entry = (user.renderAccounts || []).find((item) => String(item._id) === accountId && item.enc === "udk");
    if (!entry || !safeId(serviceId)) return null;
    let account = accountCache.get(accountId);
    if (!account) {
      const fields = asEntry(entry, dataKey);
      if (!fields?.apiKey) return null;
      account = fields;
      accountCache.set(accountId, account);
    }
    return { key, accountId, serviceId, apiKey: account.apiKey, accountName: account.name || "Render account" };
  }

  for (const group of groupsToSample) {
    const members = [];
    for (const key of (group.serviceKeys || []).slice(0, MAX_SERVICES_PER_GROUP)) {
      if (remainingServiceBudget <= 0 && !observedServices.has(key)) continue;
      const member = await resolveService(key);
      if (member) {
        members.push(member);
        if (!observedServices.has(key)) remainingServiceBudget -= 1;
      }
    }
    if (!members.length) continue;
    groupsChecked += 1;
    const groupResults = [];
    for (const member of members) {
      let result = observedServices.get(member.key);
      if (result) {
        groupResults.push(result);
        continue;
      }
      let service = null;
      result = {
        key: member.key, serviceId: member.serviceId, accountId: member.accountId,
        accountName: member.accountName, sampledAt: endTime, health: { state: "unknown" }, metrics: {}
      };
      try {
        const rawService = await renderRequest(member.apiKey, "/v1/services/" + encodeURIComponent(member.serviceId));
        service = rawService?.service || rawService;
        result.name = String(service?.name || member.serviceId).slice(0, 120);
        result.type = String(service?.type || "unknown");
        result.suspended = service?.suspended === "suspended";
        result.status = String(service?.serviceDetails?.runtime || service?.status || "");
        if (config.monitor?.checkHealth && service && service.suspended !== "suspended") result.health = await probeService(service);
      } catch {
        result.name = member.serviceId;
        result.error = "Could not retrieve service status from Render.";
      }
      try {
        const deployPayload = await renderRequest(member.apiKey, "/v1/services/" + encodeURIComponent(member.serviceId) + "/deploys?limit=5");
        const deployList = Array.isArray(deployPayload) ? deployPayload : Array.isArray(deployPayload?.deploys) ? deployPayload.deploys : [];
        const latest = deployList.map((item) => item?.deploy || item).filter(Boolean)
          .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))[0];
        result.latestDeploy = latest ? {
          id: String(latest.id || "").slice(0, 160),
          status: String(latest.status || "unknown").slice(0, 60),
          createdAt: latest.createdAt || null,
          commitMessage: String(latest.commit?.message || "").slice(0, 240)
        } : null;
      } catch {
        result.latestDeploy = { status: "unavailable", createdAt: null };
      }
      if (String(result.type || "").toLowerCase().includes("postgres") || member.serviceId.startsWith("dpg-")) {
        try {
          const exportPayload = await renderRequest(member.apiKey, "/v1/postgres/" + encodeURIComponent(member.serviceId) + "/export");
          const exportList = Array.isArray(exportPayload) ? exportPayload : Array.isArray(exportPayload?.exports) ? exportPayload.exports : [];
          const latestExport = exportList.map((item) => item?.export || item).filter(Boolean)
            .sort((a, b) => Date.parse(b.createdAt || b.created_at || 0) - Date.parse(a.createdAt || a.created_at || 0))[0];
          result.latestManualExport = latestExport ? {
            id: String(latestExport.id || "").slice(0, 160),
            status: String(latestExport.status || "unknown").slice(0, 60),
            createdAt: latestExport.createdAt || latestExport.created_at || null
          } : null;
        } catch {
          result.latestManualExport = { status: "unavailable", createdAt: null };
        }
      }

      const metricsToFetch = Object.keys(METRICS);
      for (const metric of metricsToFetch) {
        try {
          const params = new URLSearchParams({ resource: member.serviceId, startTime, endTime, resolutionSeconds: "60" });
          const payload = await renderRequest(member.apiKey, "/v1/metrics/" + METRICS[metric] + "?" + params.toString());
          const points = extractPoints(payload);
          const latest = points[points.length - 1] || null;
          const peak = points.reduce((best, point) => !best || point.value > best.value ? point : best, null);
          result.metrics[metric] = latest ? {
            current: latest.value, unit: latest.unit, timestamp: latest.timestamp,
            peak: peak.value, peakAt: peak.timestamp
          } : { current: null, unit: "", timestamp: null, peak: null, peakAt: null };
        } catch {
          result.metrics[metric] = { current: null, unit: "", timestamp: null, peak: null, peakAt: null, unavailable: true };
        }
      }
      groupResults.push(result);
      observedServices.set(member.key, result);

      const latestIncidentFor = (type) => priorIncidents
        .filter((incident) => incident.groupId === group.id && incident.serviceKey === member.key && incident.type === type)
        .reduce((latest, incident) => !latest || Date.parse(incident.at || incident.openedAt || 0) >= Date.parse(latest.at || latest.openedAt || 0) ? incident : latest, null);
      const openFor = (type) => {
        const latest = latestIncidentFor(type);
        return latest?.state === "open" ? latest : null;
      };
      const checks = [];
      if (result.health?.state === "unhealthy" || result.health?.state === "timeout") {
        checks.push({ type: "health", severity: "critical", message: result.name + " health check " + result.health.state + (result.health.status ? " (HTTP " + result.health.status + ")" : "") });
      }
      const deployStatus = String(result.latestDeploy?.status || "").toLowerCase();
      if (["build_failed", "update_failed", "pre_deploy_failed"].includes(deployStatus)) {
        checks.push({ type: "deploy_failure", severity: "critical", message: result.name + " latest deployment failed (" + deployStatus + ")." });
      }
      checks.push(...resourceChecks(result, config.monitor.thresholds));

      const activeTypes = new Set(checks.map((item) => item.type));
      const priorTypes = new Set(priorIncidents.filter((item) => item.groupId === group.id && item.serviceKey === member.key).map((item) => item.type));
      for (const type of priorTypes) {
        const latest = latestIncidentFor(type);
        if (latest?.state !== "open" || activeTypes.has(type)) continue;
        pendingIncidents.push({
          id: crypto.randomUUID(), groupId: group.id, groupName: group.name, serviceKey: member.key,
          serviceName: result.name, type, severity: latest.severity || "warning",
          state: "resolved", message: result.name + " " + type + " condition recovered.",
          openedAt: latest.openedAt || latest.at, at: endTime
        });
      }
      for (const check of checks) {
        if (openFor(check.type)) continue;
        const incident = {
          id: crypto.randomUUID(), groupId: group.id, groupName: group.name, serviceKey: member.key,
          serviceName: result.name, type: check.type, severity: check.severity, state: "open",
          message: check.message, openedAt: endTime, at: endTime
        };
        pendingIncidents.push(incident);
        incidentsOpened += 1;
      }
    }

    const metricTotals = {};
    for (const metric of Object.keys(METRICS)) {
      const available = groupResults.map((service) => service.metrics[metric]).filter((value) => value && value.current != null);
      metricTotals[metric] = {
        availableServices: available.length,
        currentSum: available.length ? available.reduce((sum, value) => sum + value.current, 0) : null,
        peakSum: available.length ? available.reduce((sum, value) => sum + (value.peak ?? value.current), 0) : null,
        unit: available[0]?.unit || ""
      };
    }
    const estimateEntries = Object.entries(group.serviceCostEstimates || {});
    const estimatedMonthlyCostUsd = estimateEntries.reduce((sum, [, value]) => sum + Number(value || 0), 0);
    const costCoverageCount = group.serviceKeys.filter((key) => Object.prototype.hasOwnProperty.call(group.serviceCostEstimates || {}, key)).length;
    const costCoverageComplete = costCoverageCount === group.serviceKeys.length;
    const monthlyBudgetUsd = Number(group.monthlyBudgetUsd || 0);
    const latestBudgetIncident = priorIncidents
      .filter((incident) => incident.groupId === group.id && incident.serviceKey === "group-budget" && incident.type === "budget")
      .reduce((latest, incident) => !latest || Date.parse(incident.at || incident.openedAt || 0) >= Date.parse(latest.at || latest.openedAt || 0) ? incident : latest, null);
    if (monthlyBudgetUsd > 0 && costCoverageComplete && estimatedMonthlyCostUsd > monthlyBudgetUsd && latestBudgetIncident?.state !== "open") {
      pendingIncidents.push({
        id: crypto.randomUUID(), groupId: group.id, groupName: group.name, serviceKey: "group-budget",
        serviceName: group.name, type: "budget", severity: "warning", state: "open",
        message: "Manual monthly cost estimate ($" + estimatedMonthlyCostUsd.toFixed(2) + ") exceeds the group budget ($" + monthlyBudgetUsd.toFixed(2) + ").",
        openedAt: endTime, at: endTime
      });
      incidentsOpened += 1;
    } else if ((!costCoverageComplete || monthlyBudgetUsd <= 0 || estimatedMonthlyCostUsd <= monthlyBudgetUsd) && latestBudgetIncident?.state === "open") {
      pendingIncidents.push({
        id: crypto.randomUUID(), groupId: group.id, groupName: group.name, serviceKey: "group-budget",
        serviceName: group.name, type: "budget", severity: "warning", state: "resolved",
        message: !costCoverageComplete ? "Budget alert paused because not every service has a cost estimate." : "Manual monthly cost estimate is within the configured budget again.",
        openedAt: latestBudgetIncident.openedAt || latestBudgetIncident.at, at: endTime
      });
    }
    pendingHistory.push({
      id: crypto.randomUUID(), groupId: group.id, groupName: group.name, sampledAt: endTime,
      services: groupResults, combined: metricTotals,
      estimatedMonthlyCostUsd, monthlyBudgetUsd, costCoverageCount, costCoverageComplete,
      source: options.force ? "manual" : "scheduled"
    });
  }

  const sealMany = (items) => items.map((fields) => ({
    _id: new mongoose.Types.ObjectId(), enc: "udk", data: User.sealEntry(dataKey, fields),
    createdAt: new Date(), updatedAt: new Date()
  }));
  await saveEncryptedList(user._id, "renderMetricHistory", sealMany(pendingHistory), HISTORY_LIMIT);
  await saveEncryptedList(user._id, "renderIncidents", sealMany(pendingIncidents), INCIDENT_LIMIT);

  const notifications = [];
  for (const incident of pendingIncidents.filter((item) => item.state === "open")) {
    const result = await sendTelegram(config, "🚨 Stashr Render alert\nProject: " + incident.groupName + "\nService: " + incident.serviceName + "\nSeverity: " + incident.severity.toUpperCase() + "\n" + incident.message + "\nAt: " + incident.at);
    notifications.push({ incidentId: incident.id, ...result });
  }
  return {
    skipped: false, groupsChecked, samplesSaved: pendingHistory.length,
    incidentsOpened, incidentsRecorded: pendingIncidents.length, notifications
  };
}

async function runAllEnabledMonitoring() {
  const users = await User.find({ "renderOps.0": { $exists: true }, "renderAccounts.0": { $exists: true } }).limit(1000);
  const summary = { usersChecked: 0, groupsChecked: 0, samplesSaved: 0, incidentsOpened: 0, errors: 0 };
  for (const user of users) {
    try {
      const result = await runUserMonitoring(user);
      if (result.skipped) continue;
      summary.usersChecked += 1;
      summary.groupsChecked += result.groupsChecked || 0;
      summary.samplesSaved += result.samplesSaved || 0;
      summary.incidentsOpened += result.incidentsOpened || 0;
    } catch {
      summary.errors += 1;
    }
  }
  return summary;
}

function publicConfig(config) {
  return {
    version: config.version || 1,
    groups: config.groups || [],
    monitor: config.monitor || defaultConfig().monitor,
    notifications: {
      telegramConfigured: Boolean(config.notifications?.telegramBotToken && config.notifications?.telegramChatId),
      telegramChatId: config.notifications?.telegramChatId || ""
    },
    updatedAt: config.updatedAt || null
  };
}

function verifySecret(candidate, expected) {
  if (typeof candidate !== "string" || typeof expected !== "string" || !candidate || !expected) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  defaultConfig, normalizeConfig, readConfig, saveConfig, publicConfig,
  runUserMonitoring, runAllEnabledMonitoring, sendTelegram, encryptedList, verifySecret, renderRequest,
  HISTORY_LIMIT, INCIDENT_LIMIT
};
