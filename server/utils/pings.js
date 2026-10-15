const User = require("../models/schema");
const renderOps = require("./renderOps");

/*
 * Ping jobs: Stashr's own cron. Each enabled job GETs <url><path> every N minutes from the server scheduler.
 * Keeps free Render services awake and shows, per service, whether its health route answers. Results live in
 * memory (the newest per job), so a restart simply starts fresh.
 */
const results = new Map(); // userId -> Map(serviceKey -> { at, status, ms, ok, error })

async function pingOnce(url, path) {
  const started = Date.now();
  try {
    const res = await fetch(url + path, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(20000), headers: { "User-Agent": "Stashr-Ping/1.0", "Cache-Control": "no-cache" } });
    await res.body?.cancel();
    return { at: new Date().toISOString(), status: res.status, ms: Date.now() - started, ok: (res.status >= 200 && res.status < 400) || res.status === 429, missingRoute: res.status === 404 };
  } catch (error) {
    return { at: new Date().toISOString(), status: null, ms: Date.now() - started, ok: false, error: error?.name === "TimeoutError" ? "timeout" : "unreachable" };
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
  const users = await User.find({ "renderAccounts.0": { $exists: true } }).limit(500);
  let ran = 0, errors = 0;
  for (const user of users) { try { ran += (await runUserPings(user)).ran; } catch { errors += 1; } }
  return { ran, errors };
}

const pingResults = (userId) => Object.fromEntries(results.get(String(userId)) || []);

/** One-off: does every running web service answer on /health? */
async function scanHealthRoutes(user) {
  const dataKey = await user.getDataKey();
  const { services } = await renderOps.listEveryService(user, dataKey);
  const targets = services.filter((s) => !s.suspended && /^https:\/\/[^/]+\.onrender\.com\/?$/i.test(s.url || ""));
  const out = [];
  for (let i = 0; i < targets.length; i += 5) {
    const batch = await Promise.all(targets.slice(i, i + 5).map(async (s) => ({ serviceKey: s.accountId + ":" + s.id, name: s.name, url: s.url.replace(/\/$/, ""), repo: s.repo, rootDir: s.rootDir, ...(await pingOnce(s.url.replace(/\/$/, ""), "/health")) })));
    out.push(...batch);
  }
  return out;
}

module.exports = { runUserPings, runAllPings, pingResults, scanHealthRoutes, pingOnce, defaultJobs };
