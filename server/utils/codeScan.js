const { parseGithubRepo } = require("./github");
const { githubGet, resolveRepo } = require("./githubClient");
const { analyzeFile, combineFiles } = require("./serviceSignals");

/*
 * Reads an app's repository (read-only, through the user's own GitHub connection) to learn which folders it has,
 * which service SDKs the code depends on and which environment variables each folder reads. Only package names and
 * variable NAMES are kept (per file); file contents are discarded as soon as they are analysed. Results are cached,
 * and a first scan runs in the background so the Services page never waits for it.
 *
 * `serverFolder` is what the user said is their server ("server", "backend/api", "." for the repo root). Variables
 * read only outside it belong to some other part of the repo (a frontend) and are reported as `frontendEnv`.
 */
const TTL_MS = 6 * 60 * 60 * 1000;
const FAIL_TTL_MS = 10 * 60 * 1000;
const MAX_MANIFESTS = 16;
const MAX_SERVER_SOURCES = 24;
const MAX_OTHER_SOURCES = 14;
const MAX_FILE_BYTES = 60 * 1024;
const BUDGET_MS = 25 * 1000;
const CACHE_MAX = 100;
const MAX_DIRS = 40;

const cache = new Map(); // "owner/repo@folder" -> { at, ttl, data | null, promise }

const SKIP_DIR = /(^|\/)(node_modules|dist|build|out|\.next|\.nuxt|vendor|venv|\.venv|env|__pycache__|coverage|\.git|\.github|test|tests|__tests__|spec|e2e|stories|migrations|public|assets|static|docs?)\//i;
const MANIFEST = /(^|\/)(package\.json|requirements[^/]*\.txt|pyproject\.toml|Pipfile)$/;
const SOURCE = /\.(?:[cm]?jsx?|tsx?|py)$/i;
const INTERESTING = /(config|env|service|client|lib|util|provider|integration|upload|mail|email|sms|storage|db|database|auth|api|server|app|index|main|settings|cloud|media|payment|notify)/i;
const SERVERISH_DIR = /(^|\/)(server|backend|api|back-end|service|services|worker|functions)(\/|$)/i;
const FRONTENDISH_DIR = /(^|\/)(client|frontend|front-end|web|webapp|ui|www|mobile|android|ios|app-client|website)(\/|$)/i;

/** True when `path` is inside `folder` ("." means the whole repository). */
const inFolder = (path, folder) => !folder || folder === "." || path === folder || path.startsWith(folder.replace(/\/+$/, "") + "/");

/** A folder the user may name as their server: no traversal, plain repo-relative path. */
const validFolder = (value) => typeof value === "string" && (value === "." || (/^[A-Za-z0-9._][A-Za-z0-9._/-]{0,119}$/.test(value) && !value.split("/").some((part) => part === ".." || part === "." || part === "")));

/** Which files of a tree are worth reading: manifests first, then source files, the server folder's first. */
function pickFiles(tree, serverFolder) {
  const files = (Array.isArray(tree) ? tree : []).filter((f) => f && f.type === "blob" && typeof f.path === "string" && f.sha);
  const depth = (p) => p.split("/").length;
  const manifests = files.filter((f) => MANIFEST.test(f.path) && !SKIP_DIR.test(f.path) && (f.size || 0) <= 400 * 1024)
    .sort((a, b) => depth(a.path) - depth(b.path)).slice(0, MAX_MANIFESTS);
  const sources = files.filter((f) => SOURCE.test(f.path) && !SKIP_DIR.test(f.path) && !/\.(test|spec|d)\.[a-z]+$/i.test(f.path) && (f.size || 0) > 0 && (f.size || 0) <= MAX_FILE_BYTES)
    .sort((a, b) => (INTERESTING.test(b.path) ? 1 : 0) - (INTERESTING.test(a.path) ? 1 : 0) || depth(a.path) - depth(b.path) || a.path.localeCompare(b.path));
  const mine = serverFolder ? sources.filter((f) => inFolder(f.path, serverFolder)) : sources.filter((f) => !FRONTENDISH_DIR.test(f.path));
  const rest = sources.filter((f) => !mine.includes(f));
  return [...manifests, ...mine.slice(0, MAX_SERVER_SOURCES), ...rest.slice(0, serverFolder ? MAX_OTHER_SOURCES : MAX_OTHER_SOURCES + 6)];
}

/** The repository's folders (top level and one level down) that hold code, with what each looks like. Pure. */
function summarizeDirs(tree) {
  const files = (Array.isArray(tree) ? tree : []).filter((f) => f && f.type === "blob" && typeof f.path === "string" && !SKIP_DIR.test(f.path));
  const byDir = new Map();
  const add = (dir, f) => {
    const cur = byDir.get(dir) || { path: dir, files: 0, code: 0, manifest: false };
    cur.files += 1;
    if (SOURCE.test(f.path)) cur.code += 1;
    if (MANIFEST.test(f.path) && f.path.split("/").length === dir.split("/").length + 1) cur.manifest = true;
    byDir.set(dir, cur);
  };
  for (const f of files) {
    const parts = f.path.split("/");
    if (parts.length < 2) continue;
    add(parts[0], f);
    if (parts.length > 2) add(parts[0] + "/" + parts[1], f);
  }
  return [...byDir.values()].filter((d) => d.code > 0 || d.manifest).sort((a, b) => a.path.localeCompare(b.path)).slice(0, MAX_DIRS);
}

/**
 * Best guess at the server folder from the manifests: a folder whose dependencies are a server framework (Express,
 * Flask, ...) beats one that is a browser app. Returns { folder, reason } or null. Pure.
 */
function suggestServerFolder(manifestResults, dirs) {
  const score = new Map();
  const bump = (folder, n, why) => { const cur = score.get(folder) || { n: 0, why: [] }; cur.n += n; cur.why.push(why); score.set(folder, cur); };
  for (const m of manifestResults) {
    const folder = m.path.includes("/") ? m.path.slice(0, m.path.lastIndexOf("/")) : ".";
    if (m.roles?.server?.length) bump(folder, 4, "uses " + m.roles.server[0]);
    if (m.roles?.fullstack?.length) bump(folder, 3, "uses " + m.roles.fullstack[0] + " (frontend and server together)");
    if (m.roles?.frontend?.length && !m.roles?.server?.length && !m.roles?.fullstack?.length) bump(folder, -3, "looks like a browser app");
  }
  for (const d of dirs) {
    if (SERVERISH_DIR.test(d.path) && d.code > 0) bump(d.path, 2, "named like a server");
    if (FRONTENDISH_DIR.test(d.path)) bump(d.path, -2, "named like a frontend");
  }
  const best = [...score].filter(([, v]) => v.n > 0).sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))[0];
  return best ? { folder: best[0], reason: best[1].why[0] } : null;
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

async function scan(accounts, target, get, serverFolder) {
  await acquire();
  try { return await scanOnce(accounts, target, get, serverFolder); } finally { release(); }
}

async function scanOnce(accounts, target, get, serverFolder) {
  const resolved = await resolveRepo(accounts, target);
  if (resolved.error) return { error: resolved.error.message || "Could not read the repository." };
  const { repo, used, base } = resolved;
  const branch = encodeURIComponent(repo.default_branch || "HEAD");
  const tree = await get(used.token, base + "/git/trees/" + branch + "?recursive=1");
  if (!tree.ok) return { error: "Could not list the repository files." };
  const picked = pickFiles(tree.body?.tree, serverFolder);
  const deadline = Date.now() + BUDGET_MS;
  const results = [];
  await mapLimit(picked, 6, async (file) => {
    if (Date.now() > deadline) return;
    const blob = await get(used.token, base + "/git/blobs/" + file.sha);
    if (!blob.ok || blob.body?.encoding !== "base64" || typeof blob.body.content !== "string") return;
    results.push(analyzeFile(file.path, Buffer.from(blob.body.content, "base64").toString("utf8")));
  });
  const dirs = summarizeDirs(tree.body?.tree);
  return {
    results, dirs, suggestion: suggestServerFolder(results.filter((r) => r.manifest), dirs),
    files: results.length, truncated: Boolean(tree.body?.truncated) || results.length < picked.length, scannedAt: new Date().toISOString()
  };
}

/** What the catalog and the mapping page need from a scan, for the chosen server folder. */
function present(data, serverFolder) {
  if (!data) return null;
  const inside = serverFolder ? data.results.filter((r) => inFolder(r.path, serverFolder)) : data.results;
  const combined = combineFiles(inside);
  let frontendEnv = [];
  if (serverFolder) {
    const server = new Set(combined.envNames);
    const others = combineFiles(data.results.filter((r) => !inFolder(r.path, serverFolder))).envNames;
    frontendEnv = others.filter((n) => !server.has(n));
  }
  return { ...combined, frontendEnv, files: data.files, truncated: data.truncated, scannedAt: data.scannedAt, dirs: data.dirs, suggestion: data.suggestion, serverFolder: serverFolder || "" };
}

/**
 * Cached analysis of a repository, or null while the first scan is still running (or when it cannot be done).
 * `wait` makes the caller wait for a scan in progress; `force` ignores the cache and reads the repository again
 * (the "Rescan code" button). `serverFolder` focuses the scan on the folder the user named.
 */
async function hintsFor(accounts, repoUrl, { wait = false, force = false, serverFolder = "", get = githubGet, now = Date.now() } = {}) {
  const target = parseGithubRepo(repoUrl);
  if (!target || !accounts?.length) return null;
  const folder = validFolder(serverFolder) ? serverFolder : "";
  const key = (target.owner + "/" + target.repo).toLowerCase() + "@" + folder;
  // While a scan focused on the chosen folder runs, the general scan of the same repo (if any) still answers.
  const general = () => cache.get((target.owner + "/" + target.repo).toLowerCase() + "@")?.data || null;
  const hit = cache.get(key);
  if (hit && !force && now - hit.at < hit.ttl) {
    if (hit.promise && wait) await hit.promise;
    return present(cache.get(key)?.data || general(), folder);
  }
  const entry = { at: now, ttl: TTL_MS, data: hit?.data || null, promise: null };
  entry.promise = scan(accounts, target, get, folder)
    .then((result) => {
      if (result.error) { entry.ttl = FAIL_TTL_MS; entry.error = result.error; } else entry.data = result;
    })
    .catch(() => { entry.ttl = FAIL_TTL_MS; })
    .finally(() => { entry.promise = null; });
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, entry);
  if (wait) await entry.promise;
  return present(entry.data || general(), folder);
}

/** What the page can say about a repository: scanned / still scanning / not possible. */
function scanState(repoUrl, serverFolder = "") {
  const target = parseGithubRepo(repoUrl);
  if (!target) return "no-repo";
  const hit = cache.get((target.owner + "/" + target.repo).toLowerCase() + "@" + (validFolder(serverFolder) ? serverFolder : ""));
  if (!hit) return "pending";
  if (hit.promise && !hit.data) return "pending";
  return hit.data ? "scanned" : "unavailable";
}

const clearCodeScans = () => cache.clear();

module.exports = { hintsFor, scanState, clearCodeScans, pickFiles, summarizeDirs, suggestServerFolder, validFolder, inFolder };
