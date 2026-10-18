const { seal } = require("./workerSeal");

/*
 * Optional pool of extra servers that do the heavy photo work (scanning Drive, streaming previews) so this
 * server stays free for the app. Configure with PHOTO_WORKER_URLS (comma separated) and PHOTO_WORKER_SECRET.
 * A worker that fails is skipped for a minute; with none healthy the work simply runs here.
 */
const COOL_DOWN_MS = 60 * 1000;
const bad = new Map(); // base url -> time it may be tried again
let turn = 0;

const secret = () => process.env.PHOTO_WORKER_SECRET || "";
const urls = () => (process.env.PHOTO_WORKER_URLS || "").split(",").map((u) => u.trim().replace(/\/+$/, "")).filter((u) => /^https:\/\//i.test(u) || /^http:\/\/localhost/i.test(u));
const enabled = () => Boolean(secret()) && urls().length > 0;
const ready = () => urls().filter((u) => (bad.get(u) || 0) <= Date.now());

/** Next healthy worker in rotation, or "" when none. */
function pick() {
  const list = ready();
  if (!list.length) return "";
  turn = (turn + 1) % list.length;
  return list[turn];
}
const fail = (base) => bad.set(base, Date.now() + COOL_DOWN_MS);

/** Runs a task on a worker, trying each healthy one once. Returns null when no worker could do it. */
async function run(task, payload, { timeoutMs = 60000 } = {}) {
  if (!enabled()) return null;
  for (let tried = 0; tried < urls().length; tried += 1) {
    const base = pick();
    if (!base) return null;
    try {
      const response = await fetch(`${base}/worker/${task}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blob: seal(payload, secret(), 120) }), signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok) return await response.json();
      if (response.status >= 500 || response.status === 404) fail(base);
      else return null; // the worker understood and refused; do not retry elsewhere
    } catch { fail(base); }
  }
  return null;
}

/** Signed link to stream a file through a worker, or "" when no worker is available. */
function mediaLink(payload) {
  const base = enabled() ? pick() : "";
  return base ? `${base}/worker/media?d=${seal(payload, secret(), 600)}` : "";
}

async function status() {
  return Promise.all(urls().map(async (base) => {
    const t0 = Date.now();
    try {
      const r = await fetch(`${base}/worker/health`, { signal: AbortSignal.timeout(8000) });
      return { host: new URL(base).host, online: r.ok, ms: Date.now() - t0 };
    } catch { return { host: new URL(base).host, online: false, ms: null }; }
  }));
}

module.exports = { enabled, run, mediaLink, status, urls };
