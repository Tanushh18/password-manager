const User = require("../models/schema");
const { without } = require("./projection");
const renderOps = require("./renderOps");
const { loadRenderServices } = require("./projectStatus");
const { domainsForServices } = require("./renderDomains");

/*
 * Ping jobs: Stashr's own cron. Each enabled job GETs <url><path> every N minutes from the server scheduler.
 * Keeps free Render services awake and shows, per service, whether its health route answers. Results live in
 * memory (the newest per job), so a restart simply starts fresh.
 */
const results = new Map(); // userId -> Map(serviceKey -> { at, status, ms, ok, error })

const SECRET_KEY = /pass|secret|token|key|auth|cookie|session|credential|url|uri|dsn|host|email|user/i;
const ALT_PATHS = ["/healthz", "/api/health", "/api/healthz", "/ping", "/status", "/api/status", "/health/", "/api/ping", "/up", "/ready", "/_health"];

/** Small, safe summary of a health route's JSON body: primitives only, two levels deep, secret-looking keys dropped. Pure. */
function safeDetails(body) {
  let data;
  try { data = JSON.parse(body); } catch { return null; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const out = {};
  const take = (obj, prefix, depth) => {
    for (const [k, v] of Object.entries(obj)) {
      if (Object.keys(out).length >= 16) return;
      if (SECRET_KEY.test(k) && !/^(uptime|timestamp)$/i.test(k)) continue;
      const name = prefix + k;
      if (v === null || ["string", "number", "boolean"].includes(typeof v)) out[name] = typeof v === "string" ? v.slice(0, 80) : v;
      else if (depth < 1 && v && typeof v === "object" && !Array.isArray(v)) take(v, name + ".", depth + 1);
    }
  };
  take(data, "", 0);
  return Object.keys(out).length ? out : null;
}

async function readBody(res) {
  try {
    const reader = res.body?.getReader?.();
    if (!reader) return "";
    let text = "";
    while (text.length < 4096) {
      const { done, value } = await reader.read();
      if (done) break;
      text += Buffer.from(value).toString("utf8");
    }
    await reader.cancel().catch(() => {});
    return text.slice(0, 4096);
  } catch { return ""; }
}

async function pingOnce(url, path) {
  const started = Date.now();
  const target = url + path;
  try {
    const res = await fetch(target, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(20000), headers: { "User-Agent": "Stashr-Ping/1.0", "Cache-Control": "no-cache" } });
    const details = res.status >= 200 && res.status < 300 && /json/i.test(res.headers.get("content-type") || "") ? safeDetails(await readBody(res)) : (await res.body?.cancel(), null);
    return { at: new Date().toISOString(), target, status: res.status, ms: Date.now() - started, ok: (res.status >= 200 && res.status < 400) || res.status === 429, missingRoute: res.status === 404, ...(details ? { details } : {}) };
  } catch (error) {
    return { at: new Date().toISOString(), target, status: null, ms: Date.now() - started, ok: false, error: error?.name === "TimeoutError" ? "timeout" : "unreachable" };
  }
}

const dueFor = (job, last, now) => !last || now - Date.parse(last.at) >= job.everyMinutes * 60000 - 30000;

/** Default jobs: every running web service with a Render URL that has no job of its own, every 10 minutes. Static sites are clients and never sleep, so they are not pinged. Pure. */
function defaultJobs(services, explicit) {
  const own = new Set((explicit || []).map((j) => j.serviceKey));
  return (services || [])
    .filter((s) => !s.suspended && /^https:\/\/[^/]+\.onrender\.com\/?$/i.test(s.url || "") && !/cron|worker|private|static/i.test(s.type || ""))
    .map((s) => ({ serviceKey: s.accountId + ":" + s.id, name: s.name, url: s.url.replace(/\/$/, ""), path: "/health", everyMinutes: renderOps.DEFAULT_PING_MINUTES, enabled: true, auto: true }))
    .filter((j) => !own.has(j.serviceKey));
}

const STATIC_HOST = /\.(vercel\.app|netlify\.app|pages\.dev|github\.io)$/i;
const originOf = (url) => { try { return new URL(String(url || "")).origin.toLowerCase(); } catch { return ""; } };

/**
 * Brings the Server URLs lists into the cron without ever pinging one server twice.
 *   - a URL that belongs to a Render web service (its onrender.com address or one of its custom domains) is that
 *     service's job: the job stays a single one, and points at the custom domain when the list has one (that is the
 *     address the clients really use, and it keeps the same service awake);
 *   - any other switched-on https server gets its own job (/health, every 10 minutes);
 *   - clients are left out: Render static sites and Vercel / Netlify / Pages / GitHub Pages hosts.
 * `lists` = [{ name, urls }], `domains` = Map(serviceId -> [custom domain names]). Pure; returns the new job list.
 */
function withServerUrls(base, lists, services, domains = new Map()) {
  const webs = (services || []).filter((s) => !/static|cron|worker|private/i.test(s.type || "") && s.url);
  const clients = new Set((services || []).filter((s) => /static/i.test(s.type || "")).map((s) => originOf(s.url)).filter(Boolean));
  const owner = new Map(); // origin -> { service, domain }
  for (const s of webs) {
    owner.set(originOf(s.url), { service: s, domain: false });
    for (const d of domains.get(String(s.id)) || []) owner.set("https://" + d, { service: s, domain: true });
  }
  const jobs = (base || []).map((j) => ({ ...j }));
  const byKey = new Map(jobs.map((j) => [j.serviceKey, j]));
  const covered = new Set(jobs.map((j) => originOf(j.url)).filter(Boolean));
  for (const list of lists || []) {
    for (const url of list.urls || []) {
      const origin = originOf(url);
      if (!/^https:\/\//.test(origin) || clients.has(origin) || STATIC_HOST.test(new URL(origin).hostname)) continue;
      const hit = owner.get(origin);
      if (hit) {
        const job = byKey.get(hit.service.accountId + ":" + hit.service.id);
        // Only the automatic job moves to the domain; a job the person configured keeps its own address.
        if (job && job.auto && hit.domain && !job.viaDomain) { covered.delete(originOf(job.url)); job.url = origin; job.viaDomain = true; covered.add(origin); }
        continue;
      }
      if (covered.has(origin)) continue;
      covered.add(origin);
      jobs.push({ serviceKey: "url:" + origin, name: list.name || origin, url: origin, path: "/health", everyMinutes: renderOps.DEFAULT_PING_MINUTES, enabled: true, auto: true, fromServerUrls: true });
    }
  }
  return jobs;
}

/** Switched-on Server URLs of every project of the user. */
async function serverUrlLists(user) {
  const dataKey = await user.getDataKey();
  return (user.projects || []).filter((e) => e.enc === "udk").map((e) => {
    const f = User.publicEntry(e, dataKey);
    return f && !f.broken ? { name: f.name || "", urls: (f.serverUrls || []).filter((r) => r && r.enabled !== false).map((r) => r.url) } : null;
  }).filter((l) => l && l.urls.length);
}

async function jobsFor(user, config) {
  const explicit = config.pings || [];
  if (config.pingAll === false) return explicit;
  const dataKey = await user.getDataKey();
  const { services } = await renderOps.listEveryService(user, dataKey);
  const base = [...explicit, ...defaultJobs(services, explicit)];
  // Custom domains come from Render (cached 10 minutes); without them every URL still gets its job.
  let domains = new Map();
  try {
    const loaded = await loadRenderServices(user, dataKey);
    domains = await domainsForServices(loaded.services.filter((s) => s.type === "web_service" && !s.suspended), loaded.accounts);
  } catch { /* domains are optional */ }
  return withServerUrls(base, await serverUrlLists(user), services, domains);
}

/** Runs one user's jobs; `force` ignores the schedule (the "Run now" button). */
async function runUserPings(user, { force = false } = {}) {
  const config = await renderOps.readConfig(user);
  const jobs = (await jobsFor(user, config)).filter((j) => j.enabled);
  const mine = results.get(String(user._id)) || new Map();
  const now = Date.now();
  let ran = 0;
  for (const job of jobs) {
    if (!force && !dueFor(job, mine.get(job.serviceKey), now)) continue;
    mine.set(job.serviceKey, { ...(await pingOnce(job.url, job.path)), name: job.name, ...(job.fromServerUrls ? { fromServerUrls: true } : {}) });
    ran += 1;
  }
  results.set(String(user._id), mine);
  return { ran };
}

async function runAllPings() {
  const users = await User.find({ "renderAccounts.0": { $exists: true } }, without("passwords", "renderMetricHistory", "renderIncidents", "renderAudit", "usageHistory")).limit(500);
  let ran = 0, errors = 0;
  for (const user of users) { try { ran += (await runUserPings(user)).ran; } catch { errors += 1; } }
  return { ran, errors };
}

const pingResults = (userId) => Object.fromEntries(results.get(String(userId)) || []);

async function probeHealth(base) {
  const r = await pingOnce(base, "/health");
  return r.missingRoute ? { ...r, alt: await findAlternative(base) } : r;
}

/** For a server with no /health: another route that does answer (2xx), or "". */
async function findAlternative(url) {
  for (const path of ALT_PATHS) {
    const r = await pingOnce(url, path);
    if (r.status >= 200 && r.status < 300) return path;
  }
  return "";
}

/** One-off: does every running web service answer on /health? */
async function scanHealthRoutes(user) {
  const dataKey = await user.getDataKey();
  const { services } = await renderOps.listEveryService(user, dataKey);
  const targets = services.filter((s) => !s.suspended && /^https:\/\/[^/]+\.onrender\.com\/?$/i.test(s.url || ""));
  const out = [];
  for (let i = 0; i < targets.length; i += 5) {
    const batch = await Promise.all(targets.slice(i, i + 5).map(async (s) => ({ serviceKey: s.accountId + ":" + s.id, name: s.name, url: s.url.replace(/\/$/, ""), repo: s.repo, rootDir: s.rootDir, ...(await probeHealth(s.url.replace(/\/$/, ""))) })));
    out.push(...batch);
  }
  return out;
}

module.exports = { withServerUrls, runUserPings, runAllPings, pingResults, scanHealthRoutes, pingOnce, defaultJobs, safeDetails, findAlternative };
