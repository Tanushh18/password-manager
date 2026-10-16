const { parseGithubRepo } = require("./github");
const { githubGet, resolveRepo } = require("./githubClient");
const { analyzeCode } = require("./serviceSignals");

/*
 * Reads an app's repository (read-only, through the user's own GitHub connection) to see which service SDKs it
 * depends on and which environment variables it reads. Only package names and variable NAMES are kept; file
 * contents are discarded as soon as they are analysed. The result is cached, and a first scan runs in the
 * background so the Services page never waits for it.
 */
const TTL_MS = 6 * 60 * 60 * 1000;
const FAIL_TTL_MS = 10 * 60 * 1000;
const MAX_MANIFESTS = 12;
const MAX_SOURCES = 30;
const MAX_FILE_BYTES = 60 * 1024;
const BUDGET_MS = 25 * 1000;
const CACHE_MAX = 100;

const cache = new Map(); // "owner/repo" -> { at, ttl, data | null, promise }

const SKIP_DIR = /(^|\/)(node_modules|dist|build|out|\.next|\.nuxt|vendor|venv|\.venv|env|__pycache__|coverage|\.git|test|tests|__tests__|spec|e2e|stories|migrations|public|assets|static|docs?)\//i;
const MANIFEST = /(^|\/)(package\.json|requirements[^/]*\.txt|pyproject\.toml|Pipfile)$/;
const SOURCE = /\.(?:[cm]?jsx?|tsx?|py)$/i;
const INTERESTING = /(config|env|service|client|lib|util|provider|integration|upload|mail|email|sms|storage|db|database|auth|api|server|app|index|main|settings|cloud|media|payment|notify)/i;

/** Which files of a repository tree are worth reading: dependency manifests first, then likely source files. */
function pickFiles(tree) {
  const files = (Array.isArray(tree) ? tree : []).filter((f) => f && f.type === "blob" && typeof f.path === "string" && f.sha);
  const depth = (p) => p.split("/").length;
  const manifests = files.filter((f) => MANIFEST.test(f.path) && !SKIP_DIR.test(f.path) && (f.size || 0) <= 400 * 1024)
    .sort((a, b) => depth(a.path) - depth(b.path)).slice(0, MAX_MANIFESTS);
  const sources = files.filter((f) => SOURCE.test(f.path) && !SKIP_DIR.test(f.path) && !/\.(test|spec|d)\.[a-z]+$/i.test(f.path) && (f.size || 0) > 0 && (f.size || 0) <= MAX_FILE_BYTES)
    .sort((a, b) => (INTERESTING.test(b.path) ? 1 : 0) - (INTERESTING.test(a.path) ? 1 : 0) || depth(a.path) - depth(b.path) || a.path.localeCompare(b.path))
    .slice(0, MAX_SOURCES);
  return [...manifests, ...sources];
}

async function mapLimit(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const item = items[i++]; await fn(item); } }));
}

/* At most two repositories are read at once, however many services the page lists. */
let active = 0;
const waiting = [];
const acquire = () => new Promise((resolve) => { if (active < 2) { active += 1; resolve(); } else waiting.push(resolve); });
const release = () => { const next = waiting.shift(); if (next) next(); else active -= 1; };

async function scan(accounts, target, get) {
  await acquire();
  try { return await scanOnce(accounts, target, get); } finally { release(); }
}

async function scanOnce(accounts, target, get) {
  const resolved = await resolveRepo(accounts, target);
  if (resolved.error) return { error: resolved.error.message || "Could not read the repository." };
  const { repo, used, base } = resolved;
  const branch = encodeURIComponent(repo.default_branch || "HEAD");
  const tree = await get(used.token, base + "/git/trees/" + branch + "?recursive=1");
  if (!tree.ok) return { error: "Could not list the repository files." };
  const picked = pickFiles(tree.body?.tree);
  const deadline = Date.now() + BUDGET_MS;
  const loaded = [];
  await mapLimit(picked, 6, async (file) => {
    if (Date.now() > deadline) return;
    const blob = await get(used.token, base + "/git/blobs/" + file.sha);
    if (!blob.ok || blob.body?.encoding !== "base64" || typeof blob.body.content !== "string") return;
    loaded.push({ path: file.path, text: Buffer.from(blob.body.content, "base64").toString("utf8") });
  });
  const analysis = analyzeCode(loaded);
  return { ...analysis, files: loaded.length, truncated: Boolean(tree.body?.truncated) || loaded.length < picked.length, scannedAt: new Date().toISOString() };
}

/**
 * Cached analysis of a repository, or null while the first scan is still running (or when it cannot be done).
 * `wait` makes the caller wait for a scan in progress; `force` ignores the cache and reads the repository again
 * (the "Rescan code" button).
 */
async function hintsFor(accounts, repoUrl, { wait = false, force = false, get = githubGet, now = Date.now() } = {}) {
  const target = parseGithubRepo(repoUrl);
  if (!target || !accounts?.length) return null;
  const key = (target.owner + "/" + target.repo).toLowerCase();
  const hit = cache.get(key);
  if (hit && !force && now - hit.at < hit.ttl) {
    if (hit.promise && wait) await hit.promise;
    return cache.get(key)?.data || null;
  }
  const entry = { at: now, ttl: TTL_MS, data: hit?.data || null, promise: null };
  entry.promise = scan(accounts, target, get)
    .then((result) => {
      if (result.error) { entry.ttl = FAIL_TTL_MS; entry.error = result.error; } else entry.data = result;
    })
    .catch(() => { entry.ttl = FAIL_TTL_MS; })
    .finally(() => { entry.promise = null; });
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, entry);
  if (wait) await entry.promise;
  return entry.data || null;
}

/** What the page can say about a repository: scanned / still scanning / not possible. */
function scanState(repoUrl) {
  const target = parseGithubRepo(repoUrl);
  if (!target) return "no-repo";
  const hit = cache.get((target.owner + "/" + target.repo).toLowerCase());
  if (!hit) return "pending";
  if (hit.promise && !hit.data) return "pending";
  return hit.data ? "scanned" : "unavailable";
}

const clearCodeScans = () => cache.clear();

module.exports = { hintsFor, scanState, clearCodeScans, pickFiles };
