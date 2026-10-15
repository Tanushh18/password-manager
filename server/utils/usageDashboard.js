const crypto = require("crypto");
const { detectServices, publicService } = require("./usageCatalog");
const { projectMetric, seriesFor } = require("./usageProjection");
const { repoKey } = require("./projectLink");
const { parseGithubRepo } = require("./github");

/*
 * Live-services dashboard: for every Render service that is running right now, read its env var NAMES/values
 * from Render, work out which third-party services it uses, ask each provider (read-only) for current usage and
 * project when each limit runs out. Secrets never leave the server: only masked variables and numbers are returned.
 */
const PROVIDER_TTL_MS = 10 * 60 * 1000;
const HISTORY_MAX = 600;                   // snapshots kept per user
const SNAPSHOT_MIN_GAP_MS = 55 * 60 * 1000; // at most one snapshot an hour
const providerCache = new Map();

/* Where to see usage for providers that have no usage API Stashr can call with an app key. */
const USAGE_HINT = {
  groq: "Groq has no usage API. Requests, tokens and rate limits per model are in the Groq console under Settings → Limits / Usage.",
  firebase: "Firebase usage (reads, writes, FCM sends) is in the Firebase console → Usage and billing.",
  redis: "Add a redis:// / rediss:// URL, or the Upstash REST URL and token, as environment variables to read memory use.",
  livekit: "LiveKit Cloud shows participant minutes and bandwidth in the project dashboard → Usage.",
  cartesia: "Cartesia shows credits used in its dashboard → Usage.",
  sms: "Check the SMS gateway’s own dashboard for remaining balance and daily sends.",
  openai: "OpenAI usage needs an admin key; see platform.openai.com/usage.",
  anthropic: "See console.anthropic.com → Usage.",
  gemini: "See Google AI Studio → API keys → usage, or Google Cloud console quotas.",
  telegram: "Telegram bots have no usage quota to track.",
  email: "Check your mail provider’s dashboard for sending limits.",
  payments: "Payment providers don’t have usage limits to track.",
  github: "GitHub token rate limits reset hourly; nothing to track here.",
  render: "Render platform keys — see the Render page.",
  google: "See Google Cloud console → APIs & Services → Quotas.",
  sentry: "See Sentry → Settings → Subscription → Usage.",
  mongodb: "Add a connection string (mongodb:// or mongodb+srv://) as an environment variable to read storage.",
  postgres: "Usage can’t be read from this service (no connection string found).",
  mysql: "Usage can’t be read from this service (no connection string found).",
  turso: "Turso needs both the database URL (libsql://…) and its auth token set as environment variables.",
  elasticsearch: "Elasticsearch needs an https URL plus an API key (or username and password) set as environment variables.",
  aws: "Storage usage needs the access key, secret, bucket name (and region or endpoint) as environment variables, with permission to list the bucket.",
  imagekit: "ImageKit shows bandwidth and storage in its dashboard → Usage.",
  uploadthing: "UploadThing shows storage used in its dashboard → Usage.",
  vercelblob: "Vercel Blob usage is in the Vercel dashboard → Storage.",
  b2: "Check the bucket’s usage in your Backblaze / DigitalOcean / Wasabi console.",
  algolia: "Algolia shows search requests and records in its dashboard → Usage.",
  search: "Check the Meilisearch / Typesense cloud dashboard for usage.",
  queue: "Check the queue provider’s dashboard (CloudAMQP, Upstash Kafka, SQS) for message counts and limits.",
  clerk: "Clerk shows monthly active users in its dashboard → Usage.",
  auth0: "Auth0 shows active users in the dashboard → Monitoring.",
  cloudflare: "See the Cloudflare dashboard for requests and R2 / KV usage.",
  whatsapp: "Check the WhatsApp provider’s dashboard for conversation counts.",
  maps: "Google Maps / Mapbox usage is in their consoles (billing → usage).",
  analytics: "Analytics events and limits are in the analytics provider’s dashboard.",
  elevenlabs: "Add the ElevenLabs API key as an environment variable to read your character quota.",
  sendgrid: "Add the SendGrid API key as an environment variable to read your credits."
};

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
  promise.then((r) => { if (!r.ok) providerCache.delete(fp); });
  providerCache.set(fp, { at: nowMs, promise });
  return promise;
}

async function buildLiveDashboard({ services, accounts, request, providers, settings = {}, history = [], now = Date.now(), refresh = false }) {
  if (refresh) providerCache.clear();
  const accountName = (id) => accounts.get(id)?.name || "";
  const candidates = services.filter((s) => !s.suspended);
  const liveFlags = await mapLimit(candidates, 4, async (s) => (await isLive(s, (path) => request(s.accountId, path))));
  const live = candidates.filter((_, i) => liveFlags[i]);
  // Services deployed from the same GitHub repo are one project; its id is the smallest service id (stable).
  const groupKey = (s) => repoKey(s.repo) || "id:" + s.id;
  const groupIds = new Map();
  for (const s of live) {
    const k = groupKey(s);
    if (!groupIds.has(k) || s.id < groupIds.get(k)) groupIds.set(k, s.id);
  }

  const out = [];
  const values = {};
  await mapLimit(live, 3, async (service) => {
    let env = new Map();
    let envError = false;
    try { env = await readEnv(service, (path) => request(service.accountId, path)); } catch { envError = true; }
    const detected = detectServices(env);
    const items = [];
    for (const svc of detected.services) {
      const groupId = groupIds.get(groupKey(service));
      const disabled = Boolean(settings.disabled?.[groupId + "|" + svc.key] || settings.disabled?.[service.id + "|" + svc.key]);
      const entry = { ...publicService(svc), fp: fingerprint(svc.key, svc.credentials), usage: null, reports: [], state: "no-credentials", error: null, usageHint: USAGE_HINT[svc.key] || "" };
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
        } else { entry.state = "error"; entry.error = { code: res.code, message: res.error, detail: res.detail || "", hint: res.hint || "" }; }
      } else if (!providers[svc.key]) entry.state = "no-reader";
      items.push(entry);
    }
    out.push({
      id: service.id, name: service.name, type: service.type, plan: service.plan, url: service.url, dashboardUrl: service.dashboardUrl,
      accountId: service.accountId, accountName: accountName(service.accountId), repo: service.repo,
      envReadFailed: envError, services: items, internalVars: detected.internal, otherVars: detected.other
    });
  });
  out.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const projects = mergeByRepo(out, (p) => groupIds.get(groupKey(p)));

  return { generatedAt: new Date(now).toISOString(), liveCount: live.length, projectCount: projects.length, totalCount: services.length, projects, snapshotValues: values };
}

const repoName = (url) => parseGithubRepo(url)?.repo || "";
const unionVars = (a, b) => [...a, ...b.filter((v) => !a.some((x) => x.name === v.name))];

/**
 * One project per GitHub repo: services deployed from the same repo are merged. Each deployment is kept in
 * `deployments`; detected providers are de-duplicated (same provider + same credentials = one entry).
 */
function mergeByRepo(entries, idOf) {
  const groups = new Map();
  for (const e of entries) {
    const id = idOf(e);
    const deployment = { id: e.id, name: e.name, type: e.type, plan: e.plan, url: e.url, dashboardUrl: e.dashboardUrl, accountId: e.accountId, accountName: e.accountName };
    const g = groups.get(id);
    if (!g) {
      groups.set(id, { ...e, id, services: e.services.map((s) => ({ ...s })), deployments: [deployment] });
      continue;
    }
    g.deployments.push(deployment);
    g.envReadFailed = g.envReadFailed || e.envReadFailed;
    g.internalVars = unionVars(g.internalVars, e.internalVars);
    g.otherVars = unionVars(g.otherVars, e.otherVars);
    for (const svc of e.services) {
      const same = g.services.find((x) => x.key === svc.key);
      if (!same) { g.services.push({ ...svc }); continue; }
      if (same.fp === svc.fp) continue;
      // Same provider, different credentials: keep every account's numbers under the one provider row.
      same.vars = unionVars(same.vars || [], svc.vars || []);
      same.reports = [...same.reports, ...svc.reports];
      if (same.state !== "ok" && svc.state === "ok") { same.state = "ok"; same.error = null; }
    }
  }
  return [...groups.values()].map((g) => {
    if (g.deployments.length > 1) g.name = repoName(g.repo) || g.name;
    g.services = g.services.map(({ fp, ...rest }) => rest);
    return g;
  }).sort((a, b) => a.name.localeCompare(b.name));
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

module.exports = { buildLiveDashboard, mergeByRepo, appendSnapshot, limitPeriod, providerCache };
