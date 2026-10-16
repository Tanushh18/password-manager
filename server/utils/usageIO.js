const User = require("../models/schema");
const { without } = require("./projection");
const renderOps = require("./renderOps");
const { loadRenderServices } = require("./projectStatus");
const { buildLiveDashboard, appendSnapshot, clearServiceCaches } = require("./usageDashboard");
const { makeProviders } = require("./usageProviders");
const { PROVIDERS, PROVIDER_ROLES } = require("./usageCatalog");
const { hintsFor, scanState, validFolder } = require("./codeScan");
const { recordNeedsReader } = require("./unsupportedServices");
const { loadGithubAccounts } = require("./githubClient");

/* Plan limits (MB) you tell Stashr about, because most providers do not report the limit of your plan. */
const LIMIT_KEYS = ["mongodb", "postgres", "mysql", "redis", "turso", "elasticsearch", "aws"];
const DEFAULTS = { enabled: false, mongoLimitMb: 512, limitsMb: {}, disabled: {}, mapping: {}, customServices: {}, serverFolders: {} };
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

/* What the user told Stashr about their own variables (kept in the same sealed settings entry, so it follows them
   to every device):
     customServices: { slug: { label, category } }          services Stashr has no catalog entry for
     mapping:        { "<scope>|<VARIABLE>": { key, role?, group? } }
   scope is "*" (every project) or a project id; key is a catalog key, "custom:<slug>" or "ignore"; role says which
   part of the credentials the variable is (see PROVIDER_ROLES); group tells several accounts of one provider apart. */
const CATEGORIES = ["Database", "Media", "SMS / Voice", "Voice / speech", "Email", "Messaging", "AI", "Realtime", "Auth", "APIs", "Monitoring", "DevOps", "Other"];
const PROVIDER_KEYS = new Set([...PROVIDERS.map((p) => p.key), "database"]);
const MAX_MAPPINGS = 600;
const MAX_CUSTOM = 40;

function normalizeCustom(input, prev) {
  const src = input && typeof input === "object" ? input : prev || {};
  const out = {};
  for (const [slug, def] of Object.entries(src)) {
    if (Object.keys(out).length >= MAX_CUSTOM) break;
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug) || !def || typeof def !== "object") continue;
    const label = String(def.label || "").replace(/[\r\n]/g, " ").trim().slice(0, 60);
    if (!label) continue;
    out[slug] = { label, category: CATEGORIES.includes(def.category) ? def.category : "Other" };
  }
  return out;
}

/* The folder of each project's repository that is its server ("server", "apps/api", "." for the repo root). Variables
   read only outside it are treated as frontend variables and left out of the mapping page. */
function normalizeServerFolders(input, prev) {
  const src = input && typeof input === "object" ? input : prev || {};
  const out = {};
  for (const [projectId, folder] of Object.entries(src)) {
    if (Object.keys(out).length >= 200) break;
    if (/^[A-Za-z0-9_-]{1,64}$/.test(projectId) && validFolder(folder)) out[projectId] = folder;
  }
  return out;
}

function normalizeMapping(input, prev, custom) {
  const src = input && typeof input === "object" ? input : prev || {};
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    if (Object.keys(out).length >= MAX_MAPPINGS) break;
    const m = /^(\*|[A-Za-z0-9_-]{1,64})\|([A-Za-z_][A-Za-z0-9_.-]{0,100})$/.exec(k);
    if (!m || !v || typeof v !== "object") continue;
    const key = String(v.key || "");
    const known = key === "ignore" || PROVIDER_KEYS.has(key) || /^auto-[a-z0-9]{1,24}$/.test(key) || (key.startsWith("custom:") && custom[key.slice(7)]);
    if (!known) continue;
    const entry = { key };
    const roles = PROVIDER_ROLES[key];
    if (roles && roles.some(([r]) => r === v.role)) entry.role = v.role;
    if (entry.role && /^[a-z0-9_-]{1,30}$/.test(String(v.group || ""))) entry.group = String(v.group);
    out[k] = entry;
  }
  return out;
}

const normalizeSettings = (input = {}, prev = DEFAULTS) => {
  const mb = Number(input.mongoLimitMb);
  const custom = normalizeCustom(input.customServices, prev.customServices);
  const disabled = {};
  const src = input.disabled && typeof input.disabled === "object" ? input.disabled : prev.disabled || {};
  for (const [k, v] of Object.entries(src)) if (v === true && /^[A-Za-z0-9_|:-]{1,200}$/.test(k)) disabled[k] = true;
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
    disabled,
    customServices: custom,
    mapping: normalizeMapping(input.mapping, prev.mapping, custom),
    serverFolders: normalizeServerFolders(input.serverFolders, prev.serverFolders)
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
    codeScan: githubAccounts.length ? (service, serverFolder) => {
      const k = service.repo + "@" + (serverFolder || "");
      const force = rescan && !rescanned.has(k);
      rescanned.add(k);
      return hintsFor(githubAccounts, service.repo, { wait: refresh || force, force, serverFolder });
    } : null, scanState });
  if (record) {
    const next = appendSnapshot(history, data.snapshotValues);
    if (next.length !== history.length) await writeEntry(user, "usageHistory", dataKey, { snapshots: next });
  }
  // Remember (anonymously) which services still need a usage reader, for the admin's list.
  if (data.needsReader?.length) void recordNeedsReader(user._id, data.needsReader);
  const { snapshotValues, needsReader, ...publicData } = data;
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
  const recognizedServices = PROVIDERS.map(({ key, label, category }) => ({ key, label, category, liveUsageSupported: readers.has(key), roles: PROVIDER_ROLES[key] || [] }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
  return { usageReaders, recognizedServices };
}

function hasReader(key) { return Boolean(getProviders()[key]); }

module.exports = { hasReader, runUsage, runAllUsage, readSettings, saveSettings, normalizeSettings, getUsageCapabilityCatalog };
