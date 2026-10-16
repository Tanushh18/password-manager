const User = require("../models/schema");
const { without } = require("./projection");
const renderOps = require("./renderOps");
const { loadRenderServices } = require("./projectStatus");
const { buildLiveDashboard, appendSnapshot, clearServiceCaches } = require("./usageDashboard");
const { makeProviders } = require("./usageProviders");
const { PROVIDERS } = require("./usageCatalog");
const { hintsFor, scanState } = require("./codeScan");
const { loadGithubAccounts } = require("./githubClient");

/* Plan limits (MB) you tell Stashr about, because most providers do not report the limit of your plan. */
const LIMIT_KEYS = ["mongodb", "postgres", "mysql", "redis", "turso", "elasticsearch", "aws"];
const DEFAULTS = { enabled: false, mongoLimitMb: 512, limitsMb: {}, disabled: {} };
let providers = null;
const getProviders = () => {
  if (!providers) {
    let MongoClient = null, Pg = null, mysqlCreate = null;
    try { ({ MongoClient } = require("mongodb")); } catch { /* driver unavailable: Mongo usage is skipped */ }
    try { ({ Client: Pg } = require("pg")); } catch { /* PostgreSQL usage is skipped */ }
    try { mysqlCreate = require("mysql2/promise").createConnection; } catch { /* MySQL usage is skipped */ }
    providers = makeProviders({ MongoClient, Pg, mysqlCreate });
  }
  return providers;
};

function readEntry(user, field, dataKey, fallback) {
  const entry = (user[field] || [])[0];
  if (!entry || entry.enc !== "udk") return fallback;
  try { return User.publicEntry(entry, dataKey) || fallback; } catch { return fallback; }
}

async function writeEntry(user, field, dataKey, value) {
  const data = User.sealEntry(dataKey, value);
  if ((user[field] || []).length) {
    await User.updateOne({ _id: user._id }, { $set: { [field + ".0.enc"]: "udk", [field + ".0.data"]: data, [field + ".0.updatedAt"]: new Date() } });
  } else {
    await User.updateOne({ _id: user._id }, { $push: { [field]: { enc: "udk", data, createdAt: new Date(), updatedAt: new Date() } } });
  }
}

const normalizeSettings = (input = {}, prev = DEFAULTS) => {
  const mb = Number(input.mongoLimitMb);
  const disabled = {};
  const src = input.disabled && typeof input.disabled === "object" ? input.disabled : prev.disabled || {};
  for (const [k, v] of Object.entries(src)) if (v === true && /^[A-Za-z0-9_|-]{1,200}$/.test(k)) disabled[k] = true;
  const limitsMb = { ...(prev.limitsMb || {}) };
  if (input.limitsMb && typeof input.limitsMb === "object") {
    for (const key of LIMIT_KEYS) {
      if (!(key in input.limitsMb)) continue;
      const value = Number(input.limitsMb[key]);
      if (input.limitsMb[key] === "" || input.limitsMb[key] === null) delete limitsMb[key];
      else if (Number.isFinite(value) && value >= 1 && value <= 1048576) limitsMb[key] = Math.round(value);
    }
  }
  const mongoLimitMb = Number.isFinite(mb) && mb >= 1 && mb <= 1048576 ? Math.round(mb) : prev.mongoLimitMb || 512;
  limitsMb.mongodb = input.limitsMb && "mongodb" in input.limitsMb && limitsMb.mongodb ? limitsMb.mongodb : mongoLimitMb;
  return {
    enabled: input.enabled === undefined ? Boolean(prev.enabled) : input.enabled === true,
    mongoLimitMb: limitsMb.mongodb, limitsMb,
    disabled
  };
};

const readSettings = (user, dataKey) => normalizeSettings(readEntry(user, "usageSettings", dataKey, DEFAULTS), DEFAULTS);
async function saveSettings(user, dataKey, input) {
  const next = normalizeSettings(input, readSettings(user, dataKey));
  await writeEntry(user, "usageSettings", dataKey, next);
  pageCache.delete(String(user._id));
  return next;
}

/* The page asks again every minute (and from several tabs). A finished answer is reused for a short while and
   concurrent asks share one run; "Refresh" always recomputes. */
const PAGE_TTL_MS = 45 * 1000;
const pageCache = new Map();

/** Computes the dashboard for one user and records a history snapshot. Returns { enabled:false } until the user consents. */
function runUsage(user, dataKey, { refresh = false, rescan = false, record = true, background = false } = {}) {
  if (background) return computeUsage(user, dataKey, { refresh, rescan, record, cache: false });
  if (rescan) refresh = true;
  const id = String(user._id);
  const hit = pageCache.get(id);
  if (hit && !refresh && Date.now() - hit.at < PAGE_TTL_MS) return hit.promise;
  const promise = computeUsage(user, dataKey, { refresh, rescan, record, cache: true });
  pageCache.set(id, { at: Date.now(), promise });
  promise.catch(() => pageCache.delete(id));
  return promise;
}

async function computeUsage(user, dataKey, { refresh, rescan, record, cache }) {
  const settings = readSettings(user, dataKey);
  if (!settings.enabled) return { enabled: false, settings };
  const githubAccounts = loadGithubAccounts(user, dataKey);
  const rescanned = new Set(); // a repo is re-read once per run, however many services use it
  // The service list is always read live (one cheap call per account); only provider usage is cached.
  const { services, accounts } = await loadRenderServices(user, dataKey, { refresh });
  const request = (accountId, path) => renderOps.renderRequest(accounts.get(accountId).apiKey, path);
  const history = readEntry(user, "usageHistory", dataKey, { snapshots: [] }).snapshots || [];
  const data = await buildLiveDashboard({ services, accounts, request, providers: getProviders(), settings, history, refresh, cache,
    codeScan: githubAccounts.length ? (service) => {
      const force = rescan && !rescanned.has(service.repo);
      rescanned.add(service.repo);
      return hintsFor(githubAccounts, service.repo, { wait: refresh, force });
    } : null, scanState });
  if (record) {
    const next = appendSnapshot(history, data.snapshotValues);
    if (next.length !== history.length) await writeEntry(user, "usageHistory", dataKey, { snapshots: next });
  }
  const { snapshotValues, ...publicData } = data;
  return { enabled: true, settings, historyPoints: history.length, ...publicData };
}

/** Scheduler hook: keeps history growing so projections work without anyone opening the page. */
async function runAllUsage() {
  const users = await User.find({ "usageSettings.0": { $exists: true }, "renderAccounts.0": { $exists: true } }, without("passwords", "renderMetricHistory", "renderIncidents", "renderAudit")).limit(1000);
  let users_ = 0;
  for (const user of users) {
    try {
      const dataKey = await user.getDataKey();
      if (!readSettings(user, dataKey).enabled) continue;
      await runUsage(user, dataKey, { background: true });
      users_ += 1;
    } catch { /* one user failing must not stop the others */ }
  }
  return { users: users_ };
}

function getUsageCapabilityCatalog() {
  const readers = new Set(Object.keys(getProviders()));
  const labels = new Map(PROVIDERS.map((p) => [p.key, p]));
  const usageReaders = [...readers].map((key) => {
    const def = labels.get(key);
    return { key, label: def?.label || (key === "database" ? "Database (generic URL)" : key), category: def?.category || "Database" };
  }).sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
  const recognizedServices = PROVIDERS.map(({ key, label, category }) => ({ key, label, category, liveUsageSupported: readers.has(key) }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
  return { usageReaders, recognizedServices };
}

module.exports = { runUsage, runAllUsage, readSettings, saveSettings, normalizeSettings, getUsageCapabilityCatalog };
