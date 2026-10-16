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
const HISTORY_MAX = 336;                   // snapshots kept per user: two weeks of hourly points
const SNAPSHOT_MIN_GAP_MS = 55 * 60 * 1000; // at most one snapshot an hour
const providerCache = new Map();

/* Per-service lookups that rarely change. The page re-syncs every minute; without these every sync made two Render API
   calls per service. They are only used when the caller passes `cache: true` (the live page), never in unit tests. */
const LIVE_TTL_MS = 3 * 60 * 1000;
const ENV_TTL_MS = 5 * 60 * 1000;
const liveCache = new Map();
const envCache = new Map();
const cached = (store, key, ttl, now, load) => {
  const hit = store.get(key);
  if (hit && now - hit.at < ttl) return hit.promise;
  const promise = Promise.resolve().then(load);
  store.set(key, { at: now, promise });
  promise.catch(() => store.delete(key));
  return promise;
};
/* Variables almost every app reads that say nothing about a missing setting. */
const COMMON_ENV = /^(NODE_ENV|PORT|HOST|HOSTNAME|PWD|HOME|PATH|USER|SHELL|CI|DEBUG|TZ|LANG|TERM|NODE_OPTIONS|PYTHONPATH|FLASK_[A-Z_]+|DJANGO_[A-Z_]+|npm_[a-z_]+|RENDER(_[A-Z_]+)?|VERCEL(_[A-Z_]+)?|PUBLIC_URL|BASE_URL|MODE|DEV|PROD|SSR)$/i;
const clearServiceCaches = () => { providerCache.clear(); liveCache.clear(); envCache.clear(); };

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

async function buildLiveDashboard({ services, accounts, request, providers, settings = {}, history = [], now = Date.now(), refresh = false, cache = false, codeScan = null, scanState = () => "no-repo" }) {
  if (refresh) clearServiceCaches();
  const key = (s) => s.accountId + "|" + s.id;
  const isLiveCached = (s) => (cache ? cached(liveCache, key(s), LIVE_TTL_MS, now, () => isLive(s, (path) => request(s.accountId, path))) : isLive(s, (path) => request(s.accountId, path)));
  const readEnvCached = (s) => (cache ? cached(envCache, key(s), ENV_TTL_MS, now, () => readEnv(s, (path) => request(s.accountId, path))) : readEnv(s, (path) => request(s.accountId, path)));
  const accountName = (id) => accounts.get(id)?.name || "";
  const candidates = services.filter((s) => !s.suspended);
  const liveFlags = await mapLimit(candidates, 6, async (s) => (await isLiveCached(s)));
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
  await mapLimit(live, 5, async (service) => {
    let env = new Map();
    let envError = false;
    try { env = await readEnvCached(service); } catch { envError = true; }
    // What the app's own code says (SDKs it depends on, variables it reads); null until the repo has been scanned.
    let hints = null;
    if (codeScan && service.repo) { try { hints = await codeScan(service); } catch { hints = null; } }
    // The user's own mapping of variables to services (project scope, then this service) beats every automatic guess.
    const groupId = groupIds.get(groupKey(service));
    const overrides = new Map();
    for (const scope of ["*", groupId, service.id]) {
      const prefix = scope + "|";
      for (const [k, v] of Object.entries(settings.mapping || {})) if (k.startsWith(prefix)) overrides.set(k.slice(prefix.length), v);
    }
    const detected = detectServices(env, { hints, overrides, customLabels: settings.customServices });
    const code = codeScan && service.repo ? {
      state: scanState(service.repo), files: hints?.files || 0, truncated: Boolean(hints?.truncated),
      // Variables the code reads that this deployment does not define: a missing or misspelled setting.
      missingEnv: hints ? (hints.envNames || []).filter((n) => !env.has(n) && !COMMON_ENV.test(n) && !/^(NEXT_PUBLIC|NUXT_PUBLIC|EXPO_PUBLIC|REACT_APP|VITE|PUBLIC|GATSBY)_/i.test(n)).slice(0, 40) : []
    } : null;
    const items = [];
    for (const svc of detected.services) {
      const disabled = Boolean(settings.disabled?.[groupId + "|" + svc.key] || settings.disabled?.[service.id + "|" + svc.key]);
      const entry = { ...publicService(svc), fp: fingerprint(svc.key, svc.credentials), usage: null, reports: [], state: "no-credentials", error: null, usageHint: USAGE_HINT[svc.key] || (providers[svc.key] ? "" : "Stashr found this service from the app’s environment variables. It has no usage API that works with an app key, so check the provider’s own dashboard for usage and limits.") };
      entry.configuredLimits = svc.configuredLimits.map((l) => ({ ...l, period: limitPeriod(l.name) }));
      if (svc.inCodeOnly) entry.state = "in-code";
      else if (disabled) entry.state = "disabled";
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
      if (entry.state === "in-code") {
        entry.diagnosis = "The app's code uses " + (svc.packages || []).join(", ") + ", but no credentials for it were found in this service's environment variables, so nothing can be tracked yet. It may be configured in another place, or only used in some environments.";
      } else if (entry.state === "ok") {
        entry.diagnosis = "Live usage was read successfully using this service’s configured credentials." + (svc.incompleteAccounts?.length ? " Not tracked (incomplete variables): " + svc.incompleteAccounts.map((a) => (a.label || "default") + " is missing " + a.missing.join(", ")).join("; ") + "." : "");
      } else if (entry.state === "disabled") {
        entry.diagnosis = "Usage tracking is switched off for this provider in Services & Usage settings.";
      } else if (entry.state === "no-reader" && svc.key === "supabase") {
        entry.diagnosis = "Supabase variables such as SUPABASE_URL and SUPABASE_ANON_KEY let the app use Supabase, but they do not grant access to platform billing or quota metrics. Stashr cannot measure those platform metrics from deployment variables alone. If a PostgreSQL connection string (for example DATABASE_URL or SUPABASE_DB_URL) is also configured, database size and connections can be measured separately under PostgreSQL; otherwise use the Supabase dashboard for API, bandwidth and billing usage.";
      } else if (entry.state === "no-reader") {
        entry.diagnosis = "Stashr recognizes this provider, but its deployment credentials do not expose a supported usage endpoint. The provider console link shows the authoritative usage.";
      } else if (entry.state === "no-credentials" && svc.key === "cloudinary") {
        entry.diagnosis = "Cloudinary was detected, but live usage needs CLOUDINARY_URL or a complete Cloud Name + API Key + API Secret set." + (svc.incompleteAccounts?.length ? " Incomplete account(s): " + svc.incompleteAccounts.map((a) => (a.label || "default") + " is missing " + a.missing.join(", ")).join("; ") + "." : "") + " Detected variable names: " + svc.vars.map((v) => v.name).join(", ") + ". Values remain hidden.";
      } else if (entry.state === "no-credentials") {
        entry.diagnosis = "The provider variables were detected, but Stashr could not build a complete read-only usage connection from them. Check the required connection string or credential pair for this provider; no values are shown here.";
      } else if (entry.state === "error") {
        entry.diagnosis = [entry.error?.message, entry.error?.hint].filter(Boolean).join(" ");
      }
      items.push(entry);
    }
    out.push({
      id: service.id, name: service.name, type: service.type, plan: service.plan, url: service.url, dashboardUrl: service.dashboardUrl,
      accountId: service.accountId, accountName: accountName(service.accountId), repo: service.repo,
      envReadFailed: envError, code, services: items, internalVars: detected.internal, otherVars: detected.other
    });
  });
  out.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const projects = mergeByRepo(out, (p) => groupIds.get(groupKey(p)));

  return { generatedAt: new Date(now).toISOString(), liveCount: live.length, projectCount: projects.length, totalCount: services.length, projects, snapshotValues: values, needsReader: needsReaderOf(projects, providers) };
}

/* Services with nothing to track (no usage or quota exists), so nobody needs to write a reader for them. */
const NO_USAGE = new Set(["telegram", "github", "render", "payments", "expo", "platform", "bot", "authlib", "database"]);

/**
 * Services this user has (found automatically or mapped by hand) whose usage Stashr cannot read because no reader
 * exists yet. Names and variable NAMES only: this is what an admin needs to write the missing reader.
 */
function needsReaderOf(projects, providers) {
  const byKey = new Map();
  for (const p of projects) for (const svc of p.services || []) {
    if (providers[svc.key] || NO_USAGE.has(svc.key) || svc.inCodeOnly || !(svc.vars || []).length) continue;
    const cur = byKey.get(svc.key) || { key: svc.key, label: svc.label, category: svc.category, vars: [], packages: [], projects: 0 };
    cur.projects += 1;
    for (const v of svc.vars) if (!cur.vars.includes(v.name) && cur.vars.length < 12) cur.vars.push(v.name);
    for (const pkg of svc.packages || []) if (!cur.packages.includes(pkg) && cur.packages.length < 6) cur.packages.push(pkg);
    byKey.set(svc.key, cur);
  }
  return [...byKey.values()];
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
    if (!g.code && e.code) g.code = e.code;
    g.internalVars = unionVars(g.internalVars, e.internalVars);
    g.otherVars = unionVars(g.otherVars, e.otherVars);
    for (const svc of e.services) {
      const same = g.services.find((x) => x.key === svc.key);
      if (!same) { g.services.push({ ...svc }); continue; }
      if (same.fp === svc.fp) continue;
      // Same provider, different credentials: keep every account's numbers under the one provider row.
      same.vars = unionVars(same.vars || [], svc.vars || []);
      same.reports = [...same.reports, ...svc.reports];
      if (same.state !== "ok" && svc.state === "ok") { same.state = "ok"; same.error = null; same.diagnosis = svc.diagnosis; }
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

module.exports = { needsReaderOf, buildLiveDashboard, mergeByRepo, appendSnapshot, limitPeriod, providerCache, clearServiceCaches };
