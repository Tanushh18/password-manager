const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/schema");
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");
const { parseGithubRepo, orderAccounts, shapeRepoDetails, githubError } = require("../utils/github");

/*
 * GitHub connection for the Projects page. Tokens are stored like Render API keys: sealed with the
 * account's own data key and never returned to the browser. Only read-only GET requests are ever
 * made, and only to api.github.com. Details are fetched per project, on demand.
 */
const router = express.Router();
const GITHUB_API = "https://api.github.com";
const MAX_ACCOUNTS = 5;
const CACHE_TTL_MS = 60 * 1000;
const CACHE_MAX = 200;
const limiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: "Too many GitHub requests. Please slow down." });
const cache = new Map();

const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

async function githubGet(token, path) {
  try {
    const response = await fetch(GITHUB_API + path, {
      headers: {
        Authorization: "Bearer " + token, Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Stashr-Projects"
      },
      signal: AbortSignal.timeout(15000)
    });
    const body = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, body, headers: Object.fromEntries(response.headers) };
  } catch (error) {
    const timeout = error.name === "TimeoutError" || error.name === "AbortError";
    return { ok: false, status: timeout ? 504 : 502, body: null, headers: {}, network: true };
  }
}

function publicAccount(entry, fields) {
  return { id: String(entry._id), name: fields.name, login: fields.login, connectedAt: fields.connectedAt };
}

async function savedAccounts(req) {
  const dataKey = await req.rootUser.getDataKey();
  return (req.rootUser.githubAccounts || []).map((entry) => {
    const fields = entry.enc === "udk" ? User.publicEntry(entry, dataKey) : null;
    return fields && fields.token ? { id: String(entry._id), entry, dataKey, name: fields.name, login: fields.login, token: fields.token, connectedAt: fields.connectedAt } : null;
  }).filter(Boolean);
}

router.use("/github", authenticate, limiter);

router.get("/github/accounts", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    return res.json({ accounts: (await savedAccounts(req)).map((a) => ({ id: a.id, name: a.name, login: a.login, connectedAt: a.connectedAt })) });
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
    return res.status(201).json({ account: publicAccount(entry, fields) });
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

  const base = "/repos/" + encodeURIComponent(target.owner) + "/" + encodeURIComponent(target.repo);
  let repo = null, used = null, failure = null, invalid = 0;
  for (const account of orderAccounts(accounts, target.owner)) {
    const result = await githubGet(account.token, base);
    if (result.ok) { repo = result.body; used = account; break; }
    if (result.status === 401) invalid += 1;
    // Prefer the most informative failure: a 404/403 beats a transient error.
    if (!failure || result.status === 404 || result.status === 403) failure = githubError(result.network ? 502 : result.status, result.headers);
  }
  if (!repo) {
    const error = invalid === accounts.length ? githubError(401) : failure || githubError(502);
    return res.status(error.status).json({ error: error.message });
  }

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

module.exports = router;
