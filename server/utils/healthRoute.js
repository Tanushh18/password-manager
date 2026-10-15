/*
 * Pure: decide where and how to add a GET /health route to an app, from its files. No I/O.
 * Supports Express (Node) and FastAPI / Flask (Python). Returns { path, content, framework } or { error }.
 * Never rewrites existing code: one small block is inserted right after the app is created.
 */
const NODE_CANDIDATES = ["server.js", "index.js", "app.js", "src/server.js", "src/index.js", "src/app.js", "server/server.js", "server/index.js", "server/app.js", "backend/server.js", "backend/index.js", "backend/app.js", "api/index.js"];
const PY_CANDIDATES = ["main.py", "app.py", "server.py", "app/main.py", "src/main.py", "api/main.py", "backend/main.py", "backend/app.py"];

const join = (dir, file) => (dir ? dir.replace(/^\/+|\/+$/g, "") + "/" : "") + file.replace(/^\.?\//, "");
const hasHealth = (text) => /["'`]\/health["'`]/.test(text);

/** Files Stashr should read for a repo (relative to the repo root), given the Render root directory. */
function candidateFiles(rootDir = "", pkg = null) {
  const dirs = [...new Set([rootDir, ""].map((d) => String(d || "").replace(/^\/+|\/+$/g, "")))];
  const fromPkg = [];
  if (pkg) {
    if (typeof pkg.main === "string") fromPkg.push(pkg.main);
    const start = String(pkg.scripts?.start || "");
    const m = start.match(/(?:node|nodemon|tsx|ts-node)\s+([\w./-]+\.[cm]?[jt]s)/);
    if (m) fromPkg.push(m[1]);
  }
  const node = dirs.flatMap((d) => [...fromPkg, ...NODE_CANDIDATES].map((f) => join(d, f)));
  const py = dirs.flatMap((d) => PY_CANDIDATES.map((f) => join(d, f)));
  return [...new Set([...node, ...py])];
}

function detectFramework({ pkg = null, requirements = "" }) {
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  if (deps.express) return "express";
  const req = String(requirements || "").toLowerCase();
  if (/^\s*fastapi\b/m.test(req)) return "fastapi";
  if (/^\s*flask\b/m.test(req)) return "flask";
  if (deps.next) return "next";
  return "";
}

function patchExpress(text) {
  const m = text.match(/^([ \t]*)(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*express\(\s*\)\s*;?[ \t]*$/m);
  if (!m) return null;
  const [line, indent, app] = m;
  const block = "\n" + indent + "// Health check for uptime monitors (added by Stashr)\n" + indent + app + '.get("/health", (req, res) => res.status(200).json({ status: "ok", uptime: process.uptime() }));';
  const at = text.indexOf(line) + line.length;
  return text.slice(0, at) + block + text.slice(at);
}

function patchPython(text, framework) {
  const re = framework === "fastapi" ? /^([A-Za-z_]\w*)\s*=\s*FastAPI\(/m : /^([A-Za-z_]\w*)\s*=\s*Flask\(/m;
  const m = text.match(re);
  if (!m) return null;
  const app = m[1];
  const block = framework === "fastapi"
    ? "\n\n# Health check for uptime monitors (added by Stashr)\n@" + app + '.get("/health")\ndef stashr_health():\n    return {"status": "ok"}\n'
    : "\n\n# Health check for uptime monitors (added by Stashr)\n@" + app + '.route("/health")\ndef stashr_health():\n    return {"status": "ok"}\n';
  // Before a trailing `if __name__ == "__main__":` block (so it is registered before the server starts), else at the end.
  const main = text.search(/^if\s+__name__\s*==\s*["']__main__["']\s*:/m);
  if (main > text.search(re)) return text.slice(0, main).replace(/\s*$/, "") + block + "\n\n" + text.slice(main);
  return text.replace(/\s*$/, "") + block;
}

/**
 * files: { [path]: content } for the candidate files that exist, plus pkg (parsed package.json) / requirements text.
 */
function planHealthPatch({ files = {}, pkg = null, requirements = "", rootDir = "" }) {
  const framework = detectFramework({ pkg, requirements });
  if (!framework) return { error: "Could not tell the framework (supports Express, FastAPI and Flask). Add a GET /health route by hand." };
  if (framework === "next") return { error: "Next.js app: add app/health/route.js (or pages/api/health.js) by hand." };
  const order = candidateFiles(rootDir, pkg).filter((p) => framework === "express" ? /\.[cm]?[jt]s$/.test(p) : p.endsWith(".py"));
  if (order.some((p) => typeof files[p] === "string" && hasHealth(files[p]))) return { error: "This app already has a /health route.", already: true };
  for (const path of order) {
    const text = files[path];
    if (typeof text !== "string") continue;
    const next = framework === "express" ? patchExpress(text) : patchPython(text, framework);
    if (next && next !== text) return { path, content: next, framework };
  }
  return { error: "Could not find where the " + framework + " app is created. Add a GET /health route by hand." };
}

module.exports = { planHealthPatch, candidateFiles, detectFramework };
