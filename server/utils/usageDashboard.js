const crypto = require("crypto");
const { detectServices, publicService } = require("./usageCatalog");
const { projectMetric, seriesFor, monthPeriod } = require("./usageProjection");

/*
 * Live-services dashboard: for every Render service that is running right now, read its env var NAMES/values
 * from Render, work out which third-party services it uses, ask each provider (read-only) for current usage and
 * project when each limit runs out. Secrets never leave the server: only masked variables and numbers are returned.
 */
const PROVIDER_TTL_MS = 10 * 60 * 1000;
const HISTORY_MAX = 600;                   // snapshots kept per user
const SNAPSHOT_MIN_GAP_MS = 55 * 60 * 1000; // at most one snapshot an hour
const FREE_HOURS = 750;
const providerCache = new Map();

const fingerprint = (key, creds) => key + ":" + crypto.createHash("sha256").update(JSON.stringify(creds)).digest("hex").slice(0, 24);
const limitPeriod = (name) => (/(^|_)(RPD|DAILY|PER_DAY|DAY)(_|$)/i.test(name) ? "day" : /(^|_)(RPM|PER_MINUTE|MINUTE)(_|$)/i.test(name) ? "minute" : /MONTH/i.test(name) ? "month" : "");

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  }));
  return out;
}

/** Is the service live now? Not suspended, and its newest deploy is live (unknown deploy state counts as live). */
async function isLive(service, request) {
  if (service.suspended) return false;
  if (service.type === "static_site" || service.type === "cron_job") { /* still check deploys below */ }
  try {
    const deploys = await request("/v1/services/" + encodeURIComponent(service.id) + "/deploys?limit=5");
    const list = (Array.isArray(deploys) ? deploys : []).map((d) => d.deploy || d);
    if (!list.length) return true;
    return list.some((d) => d.status === "live");
  } catch { return true; }
}

async function readEnv(service, request) {
  const rows = await request("/v1/services/" + encodeURIComponent(service.id) + "/env-vars?limit=100");
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const v = row.envVar || row;
    if (v && v.key && typeof v.value === "string") map.set(v.key, v.value);
  }
  return map;
}

function runProvider(providers, svc, settings, nowMs) {
  const fp = fingerprint(svc.key, svc.credentials);
  const hit = providerCache.get(fp);
  if (hit && nowMs - hit.at < PROVIDER_TTL_MS) return hit.promise;
  const promise = providers[svc.key].run(svc.credentials, { settings }).catch(() => ({ ok: false, code: "unavailable", error: "Reading usage failed." }));
  providerCache.set(fp, { at: nowMs, promise });
  return promise;
}

/** Estimated free instance hours for a workspace: an upper bound, since idle free services spin down. */
function instanceHours(services, nowMs) {
  const period = monthPeriod(new Date(nowMs));
  const start = Date.parse(period.startsAt);
  let hours = 0, counted = 0;
  for (const s of services) {
    if (s.type !== "web_service" && s.type !== "private_service" && s.type !== "background_worker") continue;
    if (!/free/i.test(s.plan)) continue;
    const from = Math.max(start, Date.parse(s.createdAt) || start);
    hours += Math.max(0, (nowMs - from) / 3600000);
    counted += 1;
  }
  if (!counted) return null;
  const metric = { key: "instance-hours", label: "Free instance hours (upper bound)", used: Math.round(hours), limit: FREE_HOURS, unit: "hours", period, note: "Assumes services ran all month; idle free services spin down, so real usage is lower." };
  return { counted, metric };
}

async function buildLiveDashboard({ services, accounts, request, providers, settings = {}, history = [], now = Date.now(), refresh = false }) {
  if (refresh) providerCache.clear();
  const accountName = (id) => accounts.get(id)?.name || "";
  const candidates = services.filter((s) => !s.suspended);
  const liveFlags = await mapLimit(candidates, 4, async (s) => (await isLive(s, (path) => request(s.accountId, path))));
  const live = candidates.filter((_, i) => liveFlags[i]);

  const out = [];
  const values = {};
  await mapLimit(live, 3, async (service) => {
    let env = new Map();
    let envError = false;
    try { env = await readEnv(service, (path) => request(service.accountId, path)); } catch { envError = true; }
    const detected = detectServices(env);
    const items = [];
    for (const svc of detected.services) {
      const disabled = Boolean(settings.disabled?.[service.id + "|" + svc.key]);
      const entry = { ...publicService(svc), usage: null, reports: [], state: "no-credentials", error: null };
      entry.configuredLimits = svc.configuredLimits.map((l) => ({ ...l, period: limitPeriod(l.name) }));
      if (disabled) entry.state = "disabled";
      else if (svc.hasCredentials && providers[svc.key]) {
        const res = await runProvider(providers, svc, settings, now);
        if (res.ok) {
          entry.state = "ok";
          entry.reports = res.reports.map((report) => ({
            ...report,
            metrics: report.metrics.map((m) => {
              const hkey = [service.id, svc.key, report.label, m.key].join("|");
              const stored = typeof m.used === "number" ? m.used : m.remaining;
              if (typeof stored === "number") values[hkey] = stored;
              return { ...m, ...projectMetric(m, seriesFor(history, hkey), now) };
            })
          }));
        } else { entry.state = "error"; entry.error = { code: res.code, message: res.error }; }
      } else if (svc.hasCredentials) entry.state = "no-reader";
      items.push(entry);
    }
    out.push({
      id: service.id, name: service.name, type: service.type, plan: service.plan, url: service.url, dashboardUrl: service.dashboardUrl,
      accountId: service.accountId, accountName: accountName(service.accountId), repo: service.repo,
      envReadFailed: envError, services: items, internal: detected.internal.length, otherVars: detected.other
    });
  });
  out.sort((a, b) => a.name.localeCompare(b.name));

  const workspaces = [];
  for (const [id, account] of accounts) {
    const hours = instanceHours(live.filter((s) => s.accountId === id), now);
    if (!hours) continue;
    workspaces.push({ accountId: id, accountName: account.name, liveServices: hours.counted, metric: { ...hours.metric, ...projectMetric(hours.metric, [], now) } });
  }
  return { generatedAt: new Date(now).toISOString(), liveCount: live.length, totalCount: services.length, projects: out, workspaces, snapshotValues: values };
}

/** Adds the latest values to the bounded history, at most one snapshot per hour. */
function appendSnapshot(history, values, now = Date.now()) {
  const list = Array.isArray(history) ? history.slice() : [];
  if (!Object.keys(values).length) return list;
  const last = list[list.length - 1];
  if (last && now - last.t < SNAPSHOT_MIN_GAP_MS) return list;
  list.push({ t: now, values });
  return list.slice(-HISTORY_MAX);
}

module.exports = { buildLiveDashboard, appendSnapshot, instanceHours, limitPeriod, providerCache };
