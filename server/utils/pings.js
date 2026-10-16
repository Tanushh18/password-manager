const User = require("../models/schema");
const { without } = require("./projection");
const renderOps = require("./renderOps");

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

/** Default jobs: every running web service with a Render URL that has no job of its own, every 10 minutes. Pure. */
function defaultJobs(services, explicit) {
  const own = new Set((explicit || []).map((j) => j.serviceKey));
  return (services || [])
    .filter((s) => !s.suspended && /^https:\/\/[^/]+\.onrender\.com\/?$/i.test(s.url || "") && !/cron|worker|private/i.test(s.type || ""))
    .map((s) => ({ serviceKey: s.accountId + ":" + s.id, name: s.name, url: s.url.replace(/\/$/, ""), path: "/health", everyMinutes: renderOps.DEFAULT_PING_MINUTES, enabled: true, auto: true }))
    .filter((j) => !own.has(j.serviceKey));
}

async function jobsFor(user, config) {
  const explicit = config.pings || [];
  if (config.pingAll === false) return explicit;
  const { services } = await renderOps.listEveryService(user, await user.getDataKey());
  return [...explicit, ...defaultJobs(services, explicit)];
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
    mine.set(job.serviceKey, await pingOnce(job.url, job.path));
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

module.exports = { runUserPings, runAllPings, pingResults, scanHealthRoutes, pingOnce, defaultJobs, safeDetails, findAlternative };
