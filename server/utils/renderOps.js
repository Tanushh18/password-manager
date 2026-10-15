const crypto = require("crypto");
const mongoose = require("mongoose");
const User = require("../models/schema");
const { resourceChecks } = require("./renderMetrics");
const { probeService, controlReachable } = require("./healthProbe");
const rules = require("./healthRules");
const { applyHealthRoute } = require("./healthRouteApply");
const { loadGithubAccounts } = require("./githubClient");

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

const { openEvents, orphanedOpen, closingEvent } = require("./incidentFold");
const { fetchAllPages } = require("./renderPaging");
const { buildAutoGroups, isAutoGroup } = require("./monitorGroups");
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

const PING_EVERY = [5, 10, 15, 30, 60];
const DEFAULT_PING_MINUTES = 10;
const MAX_PINGS = 60;
/* Ping jobs ("cron"): GET <service url><path> every N minutes. Only Render-provided https *.onrender.com URLs. */
function normalizePings(list) {
  const out = [];
  for (const p of list.slice(0, MAX_PINGS)) {
    const key = String(p?.serviceKey || "");
    if (!/^[A-Za-z0-9_-]{1,64}:[A-Za-z0-9_-]{1,160}$/.test(key) || out.some((x) => x.serviceKey === key)) continue;
    let url;
    try { url = new URL(String(p?.url || "")); } catch { continue; }
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname.toLowerCase().endsWith(".onrender.com")) continue;
    const path = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{0,120}$/.test(String(p?.path || "")) ? String(p.path) : "/health";
    out.push({ serviceKey: key, name: String(p?.name || "").slice(0, 120), url: url.origin, path, everyMinutes: PING_EVERY.includes(Number(p?.everyMinutes)) ? Number(p.everyMinutes) : 10, enabled: p?.enabled !== false });
  }
  return out;
}

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
      // Add GET /health to a repository that answers but has no health route, instead of raising an incident. On by default.
      autoHealthRoute: sourceMonitor.autoHealthRoute === undefined ? priorMonitor.autoHealthRoute !== false : sourceMonitor.autoHealthRoute === true,
      // Watch every running service automatically (grouped by app), not only the groups you made. On by default.
      autoAll: sourceMonitor.autoAll === undefined ? priorMonitor.autoAll !== false : sourceMonitor.autoAll === true,
      thresholds: {
        cpu: boundedNumber(thresholds.cpu, 1, 100, Number(priorMonitor.thresholds?.cpu) || 85),
        memory: boundedNumber(thresholds.memory, 1, 100, Number(priorMonitor.thresholds?.memory) || 90),
        latencyMs: boundedNumber(thresholds.latencyMs, 100, 60000, Number(priorMonitor.thresholds?.latencyMs) || 1500)
      }
    },
    notifications: { telegramBotToken, telegramChatId },
    pings: Array.isArray(source.pings) ? normalizePings(source.pings) : prior.pings || [],
    // Every running web service is pinged every 10 minutes unless it has its own job (paused or another interval).
    pingAll: source.pingAll === undefined ? prior.pingAll !== false : source.pingAll === true,
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

/** Manually closes open incidents (by event id, or all of them). Appends resolved events; history is kept. */
async function resolveIncidents(user, { ids = null, reason = "Marked resolved manually.", by = "manual" } = {}) {
  const dataKey = await user.getDataKey();
  const open = openEvents(encryptedList(user, "renderIncidents", dataKey, INCIDENT_LIMIT));
  const wanted = ids ? new Set(ids.map(String)) : null;
  const targets = open.filter((e) => !wanted || wanted.has(String(e.id)));
  if (!targets.length) return { resolved: 0 };
  const at = nowIso();
  const docs = targets.map((e) => ({
    _id: new mongoose.Types.ObjectId(), enc: "udk",
    data: User.sealEntry(dataKey, closingEvent(e, { id: crypto.randomUUID(), message: reason, by, at })),
    createdAt: new Date(), updatedAt: new Date()
  }));
  await saveEncryptedList(user._id, "renderIncidents", docs, INCIDENT_LIMIT);
  return { resolved: targets.length };
}

/** Deletes closed history; incidents that are still open are kept. */
async function clearClosedIncidents(user) {
  const dataKey = await user.getDataKey();
  const rows = (user.renderIncidents || []).map((entry) => ({ entry, fields: asEntry(entry, dataKey) }));
  const keep = new Set(openEvents(rows.map((r) => r.fields).filter(Boolean)).map((e) => e.id));
  const drop = rows.filter((r) => !r.fields || !keep.has(r.fields.id)).map((r) => r.entry._id);
  if (!drop.length) return { removed: 0 };
  await User.updateOne({ _id: user._id }, { $pull: { renderIncidents: { _id: { $in: drop } } } });
  return { removed: drop.length };
}

/** Inline buttons under an incident alert: Check, Restart (only where a restart can help), Resolve. */
function incidentButtons(incident) {
  const row = [{ text: "🔍 Check", callback_data: "i:c:" + incident.id }];
  if (["health", "cpu", "memory", "latency"].includes(incident.type)) row.push({ text: "🔄 Restart", callback_data: "i:x:" + incident.id });
  row.push({ text: "✓ Resolve", callback_data: "i:r:" + incident.id });
  return [row];
}

async function sendTelegram(config, message, { silent = false, buttons = null } = {}) {
  const token = config?.notifications?.telegramBotToken;
  const chatId = config?.notifications?.telegramChatId;
  if (!token || !chatId) return { sent: false, reason: "not_configured" };
  try {
    const response = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: String(message).slice(0, 3500), disable_web_page_preview: true, disable_notification: silent, ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}) }),
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

/** The Render API key of one connected account (or null). */
function accountApiKey(user, dataKey, accountId) {
  const entry = (user.renderAccounts || []).find((item) => String(item._id) === String(accountId) && item.enc === "udk");
  return asEntry(entry, dataKey)?.apiKey || null;
}

function encryptedList(user, field, dataKey, limit = 100) {
  return (user[field] || []).slice(-limit).map((entry) => asEntry(entry, dataKey)).filter(Boolean);
}

/** Every service in every connected account (for the automatic groups). `complete` is false if any account failed. */
async function listEveryService(user, dataKey) {
  const services = [];
  let complete = true;
  for (const entry of user.renderAccounts || []) {
    const account = asEntry(entry, dataKey);
    if (!account?.apiKey) { complete = false; continue; }
    try {
      const listing = await fetchAllPages((path) => renderRequest(account.apiKey, path), "/v1/services");
      if (listing.truncated) complete = false;
      for (const item of listing.items) {
        const s = item?.service || item;
        if (s?.id) services.push({ id: s.id, name: s.name, repo: s.repo || "", suspended: s.suspended === "suspended", accountId: String(entry._id), url: s.serviceDetails?.url || "", rootDir: s.rootDir || "", type: s.type || "" });
      }
    } catch { complete = false; }
  }
  return { services, complete };
}

/*
 * A service that answers but has no health route is healthy, not broken. Instead of raising an incident, Stashr adds
 * GET /health to its repository (pull request, merged, so Render redeploys) once a day at most. Unsupported setups
 * are reported on the server card as "needs a /health route" with the reason, never as an incident.
 */
const healthRouteTried = new Map();
const HEALTH_ROUTE_RETRY_MS = 24 * 60 * 60 * 1000;
const HEALTH_ROUTE_PR_RETRY_MS = 7 * 24 * 60 * 60 * 1000; // an open pull request is waiting for a human: do not nag
async function ensureHealthRoute({ user, dataKey, key, result }) {
  const prior = healthRouteTried.get(key);
  if (prior && Date.now() - prior.at < (prior.outcome?.status === "pr_open" ? HEALTH_ROUTE_PR_RETRY_MS : HEALTH_ROUTE_RETRY_MS)) return prior.outcome;
  let outcome;
  try {
    const accounts = loadGithubAccounts(user, dataKey);
    if (!result.repo) outcome = { status: "manual", message: "This service has no GitHub repository, so Stashr cannot add a /health route. Add GET /health by hand." };
    else if (!accounts.length) outcome = { status: "manual", message: "Connect a GitHub token (Projects → GitHub) and Stashr will add the /health route for you." };
    else {
      const applied = await applyHealthRoute({ accounts, repoUrl: result.repo, rootDir: result.rootDir, merge: true });
      const body = applied.body || {};
      if (applied.status === 200 && body.pending) outcome = { status: "pr_open", file: body.file, prUrl: body.prUrl, message: "A pull request adding GET /health is already open and waiting to be merged: " + body.prUrl };
      else if (applied.status === 200 && body.ok && !body.already) outcome = { status: body.merged ? "added" : "pr_open", file: body.file, prUrl: body.prUrl, message: body.merged ? "Added GET /health to " + body.file + " (merged). Render is redeploying." : "Opened a pull request adding GET /health: " + body.prUrl, notify: "➕ " + result.name + ": added GET /health (" + body.file + ")" + (body.merged ? " and merged it, so Render redeploys." : ".") + "\n" + (body.prUrl || "") };
      else if (body.already) outcome = { status: "already", message: "The repository already has a /health route; the running app will pick it up after its next deploy." };
      else outcome = { status: "manual", message: String(body.error || "Could not add the /health route.").slice(0, 240) };
    }
  } catch { outcome = { status: "manual", message: "Could not add the /health route automatically." }; }
  if (healthRouteTried.size > 500) healthRouteTried.clear();
  healthRouteTried.set(key, { at: Date.now(), outcome });
  return outcome;
}

/*
 * The incident log keeps the newest INCIDENT_LIMIT events, so on a busy account an old incident that is still open
 * could be pushed off the end and vanish. Before that can happen, finished incidents (resolved for over 3 days) are
 * removed whole; open incidents and recent history are never touched.
 */
const COMPACT_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
async function compactIncidents(user, dataKey, now = Date.now()) {
  const rows = (user.renderIncidents || []).map((entry) => ({ entry, fields: asEntry(entry, dataKey) })).filter((r) => r.fields);
  const keyOf = (e) => [e.groupId, e.serviceKey, e.type].join(":");
  const latest = new Map();
  [...rows].sort((a, b) => (Date.parse(a.fields.at || a.fields.openedAt || 0) || 0) - (Date.parse(b.fields.at || b.fields.openedAt || 0) || 0)).forEach((r) => latest.set(keyOf(r.fields), r.fields));
  const finished = new Set([...latest].filter(([, e]) => e.state === "resolved" && now - (Date.parse(e.at) || now) > COMPACT_AFTER_MS).map(([key]) => key));
  const drop = rows.filter((r) => finished.has(keyOf(r.fields))).map((r) => r.entry._id);
  if (!drop.length) return { removed: 0 };
  await User.updateOne({ _id: user._id }, { $pull: { renderIncidents: { _id: { $in: drop } } } });
  return { removed: drop.length };
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
  // Recent samples per service (oldest first): decide "failed twice in a row", show the trend, find the last healthy time.
  const trendOf = new Map();
  for (const sample of encryptedList(user, "renderMetricHistory", dataKey, 40).sort((a, b) => Date.parse(a.sampledAt) - Date.parse(b.sampledAt))) {
    for (const r of sample.services || []) {
      if (!r?.key) continue;
      const load = rules.loadOf(r.metrics);
      if (!trendOf.has(r.key)) trendOf.set(r.key, []);
      trendOf.get(r.key).push({ at: sample.sampledAt, state: r.health?.state, verdict: r.verdict, cpuPct: load.cpuPct, memoryPct: load.memoryPct, latencyMs: load.latencyMs });
    }
  }
  const healthRouteNotices = [];
  let controlProbe = null; // is Stashr's own network up? asked at most once per run, only when something looks down
  const controlOk = async () => (controlProbe ??= controlReachable());
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
  // Automatic groups: every running service in every connected account that is not in one of your own groups.
  let autoGroups = [];
  let autoComplete = true;
  if (config.monitor?.autoAll !== false) {
    const listed = await listEveryService(user, dataKey);
    autoComplete = listed.complete;
    autoGroups = buildAutoGroups(listed.services, configuredGroups);
  }
  const allGroups = [...configuredGroups, ...autoGroups];
  const rotationInterval = (Number(config.monitor?.intervalMinutes) || 5) * 60 * 1000;
  const rotation = allGroups.length ? Math.floor(now / rotationInterval) % allGroups.length : 0;
  const groupsToSample = [...allGroups.slice(rotation), ...allGroups.slice(0, rotation)];
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
        result.plan = String(service?.serviceDetails?.plan || "");
        result.repo = String(service?.repo || "");
        result.rootDir = String(service?.rootDir || "");
        if (config.monitor?.checkHealth && service && service.suspended !== "suspended") result.health = await probeService(service);
      } catch (error) {
        result.name = member.serviceId;
        result.error = "Could not retrieve service status from Render.";
        result.gone = error?.status === 404;
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
      // ---- one verdict per service, then one decision per incident type ----
      const trend = trendOf.get(member.key) || []; // this service's recent samples, oldest first
      const thresholds = config.monitor.thresholds;
      const manual = Boolean(options.force);
      let verdict = rules.verdictFor({ result, checkHealth: config.monitor?.checkHealth !== false });
      if (verdict === "down" && result.health.cause === "no_response" && !(await controlOk())) verdict = "unknown"; // Stashr's own network is down
      result.verdict = verdict;

      const load = rules.loadOf(result.metrics);
      const deploy = rules.deployContext(result.latestDeploy, now);
      const confirmedDown = manual || rules.previousBad(trend, now);
      if (verdict === "down" && !openFor("health") && !confirmedDown) result.verdict = "suspect"; // failed once: confirm on the next round
      const failureStart = rules.firstFailureAt(trend, now, endTime);
      const consecutive = verdict === "down" ? 1 + rules.consecutiveBad(trend) : 0;
      const sample = { at: endTime, state: result.health?.state, verdict: result.verdict, cpuPct: load.cpuPct, memoryPct: load.memoryPct, latencyMs: load.latencyMs };
      const tail = [...trend, sample].slice(-12);

      // A server that answers but has no /health route is NOT an incident: add the route to its repository instead.
      if (verdict === "up" && result.health?.cause === "no_health_route" && config.monitor?.autoHealthRoute !== false) {
        result.healthRoute = await ensureHealthRoute({ user, dataKey, key: member.key, result });
        if (result.healthRoute?.notify) healthRouteNotices.push(result.healthRoute.notify);
      }

      const resource = Object.fromEntries(resourceChecks(result, thresholds).map((check) => [check.type, check]));
      const failingNow = {
        health: verdict === "down",
        deploy_failure: rules.FAILED_DEPLOY.has(String(result.latestDeploy?.status || "").toLowerCase()),
        cpu: Boolean(resource.cpu), memory: Boolean(resource.memory), latency: Boolean(resource.latency)
      };
      for (const type of ["health", "deploy_failure", "cpu", "memory", "latency"]) {
        const open = openFor(type);
        if (result.gone) {
          if (open) pendingIncidents.push({
            id: crypto.randomUUID(), groupId: group.id, groupName: group.name, serviceKey: member.key, serviceName: result.name, type,
            severity: open.severity || "warning", state: "resolved", message: "Closed automatically: " + (open.serviceName || result.name) + " no longer exists on Render.",
            openedAt: open.openedAt || open.at, at: endTime, resolvedBy: "auto"
          });
          continue;
        }
        if (open) {
          // Only a definite "fine" resolves. Unknown, deploying, suspended or missing metrics freeze the incident.
          if (!failingNow[type] && rules.canJudge(type, result)) {
            const minutes = Math.max(1, Math.round((now - Date.parse(open.openedAt || open.at)) / 60000));
            pendingIncidents.push({
              id: crypto.randomUUID(), groupId: group.id, groupName: group.name, serviceKey: member.key, serviceName: result.name, type,
              severity: open.severity || "warning", state: "resolved", message: type === "health"
                ? result.name + " is healthy again" + (result.health.status ? " (HTTP " + result.health.status + ")" : "") + " after " + minutes + " min."
                : result.name + " " + type.replace("_", " ") + " is back to normal after " + minutes + " min.",
              openedAt: open.openedAt || open.at, at: endTime, cause: open.cause, causeLabel: open.causeLabel, labels: open.labels,
              details: { probe: result.health ? { state: result.health.state, status: result.health.status, path: result.health.path, latencyMs: result.health.latencyMs } : undefined, load, trend: tail, durationMinutes: minutes }
            });
          }
          continue;
        }
        if (!failingNow[type]) continue;
        // Confirmation: health needs two failed rounds in a row; a resource alert needs two over-threshold rounds (a manual check counts at once).
        if (type === "health" ? !confirmedDown : !(manual || rules.sustained(trend, type, thresholds)) && type !== "deploy_failure") continue;
        const classified = rules.classify({ type, health: result.health, load, deploy, firstFailure: failureStart, plan: result.plan, now });
        const flaps = rules.flapCount(priorIncidents, [group.id, member.key, type].join(":"), now);
        const labels = flaps ? [...classified.labels, "flapping"] : classified.labels;
        const incident = {
          id: crypto.randomUUID(), groupId: group.id, groupName: group.name, serviceKey: member.key,
          serviceName: result.name, type, severity: type === "health" || type === "deploy_failure" ? "critical" : "warning", state: "open",
          message: rules.describe({ type, name: result.name, health: result.health, cause: classified.cause, consecutive, lastHealthy: rules.lastHealthyAt(trend), deploy, load, thresholds }),
          openedAt: endTime, at: endTime,
          cause: classified.cause, causeLabel: classified.causeLabel, labels,
          details: {
            hints: classified.hints, plan: result.plan || "", flapsLastHour: flaps,
            timeline: { firstFailureAt: type === "health" ? failureStart : endTime, openedAt: endTime, lastHealthyAt: rules.lastHealthyAt(trend), peakAt: load.peakAt },
            probe: type === "health" ? { state: result.health.state, status: result.health.status, path: result.health.path, cause: result.health.cause, message: result.health.message, latencyMs: result.health.latencyMs } : undefined,
            load, deploy, trend: tail
          }
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

  // Incidents that can never resolve by themselves (group removed, service left the group, account disconnected).
  const accountIds = new Set((user.renderAccounts || []).map((a) => String(a._id)));
  const orphans = orphanedOpen([...priorIncidents, ...pendingIncidents], [...(config.groups || []), ...autoGroups], accountIds)
    // If an account could not be listed, its automatic groups are unknown this run: never close those by guesswork.
    .filter((open) => autoComplete || !isAutoGroup(open.groupId));
  for (const open of orphans) {
    pendingIncidents.push(closingEvent(open, { id: crypto.randomUUID(), message: "Closed automatically: monitoring for " + (open.serviceName || "this service") + " was removed.", by: "auto", at: endTime }));
  }

  const sealMany = (items) => items.map((fields) => ({
    _id: new mongoose.Types.ObjectId(), enc: "udk", data: User.sealEntry(dataKey, fields),
    createdAt: new Date(), updatedAt: new Date()
  }));
  await saveEncryptedList(user._id, "renderMetricHistory", sealMany(pendingHistory), HISTORY_LIMIT);
  if ((user.renderIncidents || []).length + pendingIncidents.length > INCIDENT_LIMIT * 0.8) { try { await compactIncidents(user, dataKey, now); } catch { /* housekeeping only */ } }
  await saveEncryptedList(user._id, "renderIncidents", sealMany(pendingIncidents), INCIDENT_LIMIT);

  const notifications = [];
  // Down -> alert with sound; recovered -> a quiet follow-up. Automatic clean-ups (deleted services) stay silent.
  for (const incident of pendingIncidents.filter((item) => item.state === "open" || (item.state === "resolved" && item.resolvedBy !== "auto"))) {
    const minutes = incident.state === "resolved" ? Math.max(1, Math.round((Date.parse(incident.at) - Date.parse(incident.openedAt || incident.at)) / 60000)) : 0;
    const d = incident.details || {};
    const text = incident.state === "open"
      ? "🚨 " + incident.serviceName + " — " + (incident.severity === "critical" ? "DOWN" : "warning") + (incident.causeLabel ? " · " + incident.causeLabel : "") + "\n" + incident.message
        + (d.load && (d.load.cpuPct != null || d.load.memoryPct != null) ? "\nLoad: CPU " + (d.load.cpuPct ?? "–") + "% · memory " + (d.load.memoryPct ?? "–") + "%" + (d.load.latencyMs != null ? " · " + d.load.latencyMs + " ms" : "") + (d.load.peakAt ? " (peak " + new Date(d.load.peakAt).toISOString().slice(11, 16) + " UTC)" : "") : "")
        + (d.deploy ? "\nLast deploy: " + d.deploy.status + (d.deploy.ageMinutes != null ? ", " + d.deploy.ageMinutes + " min ago" : "") : "")
        + (d.hints && d.hints[0] ? "\n💡 " + d.hints[0] : "")
        + "\nApp: " + incident.groupName + "\nAt: " + new Date(incident.at).toUTCString()
      : "✅ " + incident.serviceName + " recovered after " + minutes + " min\nApp: " + incident.groupName;
    const result = await sendTelegram(config, text, { silent: incident.state === "resolved", buttons: incident.state === "open" ? incidentButtons(incident) : null });
    notifications.push({ incidentId: incident.id, ...result });
  }
  for (const notice of healthRouteNotices) await sendTelegram(config, notice, { silent: true });
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
    pings: config.pings || [],
    pingAll: config.pingAll !== false,
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
  runUserMonitoring, runAllEnabledMonitoring, listEveryService, normalizePings, DEFAULT_PING_MINUTES, resolveIncidents, clearClosedIncidents, sendTelegram, encryptedList, verifySecret, renderRequest, accountApiKey, incidentButtons,
  HISTORY_LIMIT, INCIDENT_LIMIT, probeService, compactIncidents
};
