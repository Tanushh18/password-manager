const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/schema");
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");
const { parseGithubRepo, shapeRepoDetails } = require("../utils/github");
const { githubGet, githubSend, loadGithubAccounts, resolveRepo, probeScopes } = require("../utils/githubClient");
const { listRepos } = require("../utils/githubRepos");
const { planBranchDeletes, branchPath } = require("../utils/githubBranches");
const { applyHealthRoute } = require("../utils/healthRouteApply");

/*
 * GitHub connection for the Projects page. Tokens are stored like Render API keys: sealed with the
 * account's own data key and never returned to the browser. Only read-only GET requests are ever
 * made, and only to api.github.com. Details are fetched per project, on demand.
 */
const router = express.Router();
const MAX_ACCOUNTS = 5;
const CACHE_TTL_MS = 60 * 1000;
const CACHE_MAX = 200;
const limiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: "Too many GitHub requests. Please slow down." });
const cache = new Map();

const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

function publicAccount(entry, fields) {
  return { id: String(entry._id), name: fields.name, login: fields.login, connectedAt: fields.connectedAt };
}

async function savedAccounts(req) {
  return loadGithubAccounts(req.rootUser, await req.rootUser.getDataKey());
}

router.use("/github", authenticate, limiter);

router.get("/github/accounts", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    // Capabilities are probed live (cached 5 min), so a token saved before this feature existed is recognised too.
    const accounts = await Promise.all((await savedAccounts(req)).map(async (a) => {
      const caps = await probeScopes(a.token);
      return { id: a.id, name: a.name, login: a.login, connectedAt: a.connectedAt, valid: caps.valid, write: caps.write, workflow: caps.workflow, risky: caps.risky };
    }));
    return res.json({ accounts });
  } catch { return res.status(500).json({ error: "Could not load GitHub connections." }); }
});

router.post("/github/accounts", async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (!/^\S{20,255}$/.test(token)) return res.status(400).json({ error: "Enter a valid GitHub token." });
  if ((req.rootUser.githubAccounts || []).length >= MAX_ACCOUNTS) return res.status(400).json({ error: "You can connect up to " + MAX_ACCOUNTS + " GitHub accounts." });
  // Validate before saving; the token is never echoed back.
  const who = await githubGet(token, "/user");
  if (!who.ok) {
    if (who.status === 401) return res.status(400).json({ error: "GitHub rejected this token. Check it was copied in full and has not expired." });
    return res.status(502).json({ error: "Could not reach GitHub to validate this token. Try again." });
  }
  const login = text(who.body?.login, 60);
  if (!login) return res.status(502).json({ error: "GitHub returned an unexpected response." });
  try {
    const dataKey = await req.rootUser.getDataKey();
    const now = new Date();
    const fields = { name: text(req.body?.name, 80) || login, login, token, connectedAt: now.toISOString() };
    const entry = { _id: new mongoose.Types.ObjectId(), enc: "udk", data: User.sealEntry(dataKey, fields), createdAt: now, updatedAt: now };
    await User.updateOne({ _id: req.rootUser._id }, { $push: { githubAccounts: entry } });
    cache.clear();
    const caps = await probeScopes(token);
    return res.status(201).json({ account: { ...publicAccount(entry, fields), valid: true, write: caps.write, workflow: caps.workflow, risky: caps.risky } });
  } catch { return res.status(500).json({ error: "Could not save this GitHub connection." }); }
});

router.delete("/github/accounts/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "GitHub connection not found." });
  try {
    const result = await User.updateOne({ _id: req.rootUser._id, "githubAccounts._id": req.params.id }, { $pull: { githubAccounts: { _id: req.params.id } } });
    if (result.matchedCount === 0) return res.status(404).json({ error: "GitHub connection not found." });
    cache.clear();
    return res.json({ message: "Disconnected." });
  } catch { return res.status(500).json({ error: "Could not remove this GitHub connection." }); }
});

/* Repositories one connected GitHub account can see, for the "pick an existing repo" step. Cached briefly. */
router.get("/github/accounts/:id/repos", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "GitHub connection not found." });
  try {
    const account = (await savedAccounts(req)).find((a) => a.id === req.params.id);
    if (!account) return res.status(404).json({ error: "GitHub connection not found." });
    const result = await listRepos(account.token, { refresh: req.query.refresh === "1" });
    if (!result.ok) return res.status(result.status === 401 ? 401 : 502).json({ error: result.status === 401 ? "GitHub rejected this token. Reconnect it." : "Could not list repositories from GitHub." });
    res.set("Cache-Control", "no-store");
    return res.json({ repos: result.repos, truncated: result.truncated, account: { id: account.id, login: account.login } });
  } catch { return res.status(500).json({ error: "Could not list repositories." }); }
});

/* Every branch of one repository (read with the chosen account). The default branch is marked, never deletable. */
router.get("/github/repo/branches", async (req, res) => {
  const target = parseGithubRepo(req.query.url);
  if (!target) return res.status(400).json({ error: "This is not a GitHub repository URL." });
  try {
    const account = (await savedAccounts(req)).find((a) => a.id === String(req.query.githubAccountId || ""));
    if (!account) return res.status(400).json({ error: "Choose a connected GitHub account." });
    const resolved = await resolveRepo([account], target);
    if (resolved.error) return res.status(resolved.error.status).json({ error: resolved.error.message });
    const branches = [];
    for (let page = 1; page <= 5; page += 1) {
      const r = await githubGet(account.token, resolved.base + "/branches?per_page=100&page=" + page);
      if (!r.ok) { if (page === 1) return res.status(502).json({ error: "Could not read the branches from GitHub." }); break; }
      branches.push(...r.body.map((b) => ({ name: String(b.name), protected: Boolean(b.protected) })));
      if (r.body.length < 100) break;
    }
    const scopes = await probeScopes(account.token);
    res.set("Cache-Control", "no-store");
    return res.json({ repo: resolved.repo.full_name, default: resolved.repo.default_branch || "", canDelete: scopes.write, branches: branches.map((b) => ({ ...b, isDefault: b.name === resolved.repo.default_branch })) });
  } catch { return res.status(500).json({ error: "Could not read the branches." }); }
});

/* Deletes the chosen branches (never the default branch). Each result is reported on its own, so one failure does not hide the rest. */
router.post("/github/repo/branches/delete", async (req, res) => {
  const target = parseGithubRepo(req.body?.url);
  if (!target) return res.status(400).json({ error: "This is not a GitHub repository URL." });
  const names = Array.isArray(req.body?.branches) ? req.body.branches.filter((n) => typeof n === "string") : [];
  if (!names.length) return res.status(400).json({ error: "Choose at least one branch." });
  try {
    const account = (await savedAccounts(req)).find((a) => a.id === String(req.body?.githubAccountId || ""));
    if (!account) return res.status(400).json({ error: "Choose a connected GitHub account." });
    const resolved = await resolveRepo([account], target);
    if (resolved.error) return res.status(resolved.error.status).json({ error: resolved.error.message });
    const plan = planBranchDeletes(names, { defaultBranch: resolved.repo.default_branch || "", live: Array.isArray(req.body?.live) ? req.body.live.filter((n) => typeof n === "string") : [] });
    const results = [];
    for (const branch of plan.allowed) {
      const r = await githubSend(account.token, "DELETE", resolved.base + "/git/refs/heads/" + branchPath(branch.name));
      results.push(r.ok || r.status === 404 ? { name: branch.name, ok: true, alreadyGone: r.status === 404 } : { name: branch.name, ok: false, error: r.status === 403 ? "GitHub refused: this token cannot delete branches (it needs the repo scope)." : "GitHub could not delete this branch." });
    }
    res.set("Cache-Control", "no-store");
    return res.json({ repo: resolved.repo.full_name, results, refused: plan.refused });
  } catch { return res.status(500).json({ error: "Could not delete the branches." }); }
});

/* Details for ONE project's repository: repo info, recent commits, open PRs and the latest CI run. */
router.get("/github/repo", async (req, res) => {
  const target = parseGithubRepo(req.query.url);
  if (!target) return res.status(400).json({ error: "This project's repo URL is not a GitHub repository." });
  let accounts;
  try { accounts = await savedAccounts(req); } catch { return res.status(500).json({ error: "Could not load GitHub connections." }); }
  res.set("Cache-Control", "no-store");
  if (!accounts.length) return res.json({ connected: false });

  const key = req.rootUser._id + ":" + target.owner.toLowerCase() + "/" + target.repo.toLowerCase();
  const hit = cache.get(key);
  if (hit && req.query.refresh !== "1" && Date.now() - hit.at < CACHE_TTL_MS) return res.json({ ...hit.data, cached: true });

  const resolved = await resolveRepo(accounts, target);
  if (resolved.error) return res.status(resolved.error.status).json({ error: resolved.error.message });
  const { repo, used, base } = resolved;

  const branch = encodeURIComponent(repo.default_branch || "");
  const [commits, pulls, runs] = await Promise.all([
    githubGet(used.token, base + "/commits?per_page=5"),
    githubGet(used.token, base + "/pulls?state=open&sort=updated&direction=desc&per_page=10"),
    githubGet(used.token, base + "/actions/runs?per_page=10&branch=" + branch)
  ]);
  const partial = [];
  if (!commits.ok) partial.push("commits");
  if (!pulls.ok) partial.push("pull requests");
  if (!runs.ok) partial.push("CI runs");
  const data = {
    connected: true, account: { name: used.name, login: used.login }, fetchedAt: new Date().toISOString(), partial,
    ...shapeRepoDetails({ repo, commits: commits.ok ? commits.body : [], pulls: pulls.ok ? pulls.body : [], runs: runs.ok ? runs.body?.workflow_runs : [] })
  };
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), data });
  return res.json(data);
});

/*
 * Adds a GET /health route to a repo: reads its files, inserts one small block (Express / FastAPI / Flask),
 * commits it on a new branch, opens a pull request and, when asked, merges it straight away (which makes
 * Render redeploy the app). Needs a GitHub token with the "repo" scope. Nothing is force-pushed or deleted
 * except Stashr's own temporary branch after a merge.
 */
router.post("/github/health-route", async (req, res) => {
  let accounts;
  try { accounts = await savedAccounts(req); } catch { return res.status(500).json({ error: "Could not load GitHub connections." }); }
  const result = await applyHealthRoute({ accounts, repoUrl: req.body?.repoUrl, rootDir: req.body?.rootDir, merge: req.body?.merge === true });
  if (result.status === 200 && result.body.ok && !result.body.already) cache.clear();
  return res.status(result.status).json(result.body);
});

module.exports = router;
