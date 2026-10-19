const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/schema");
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");
const { PROVIDERS, ids, hostName } = require("../utils/hosts");
const { parseGithubRepo } = require("../utils/github");
const { githubSend, loadGithubAccounts } = require("../utils/githubClient");
const { groupKey } = require("../utils/projectMerge");

/*
 * Hosting connections (Vercel, Netlify, Railway, Cloudflare Pages) and "deploy this repo + branch" from Projects.
 * Tokens are sealed with the account data key and never returned to the browser.
 */
const router = express.Router();
const MAX_ACCOUNTS = 10;
const limiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: "Too many hosting requests. Please slow down." });
const deployLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 10, message: "Too many deploy requests. Please wait a few minutes." });
const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const BRANCH_RE = /^(?!-)(?!.*\.\.)[A-Za-z0-9._\/-]{1,200}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

router.use("/hosts", authenticate, limiter);

const publicAccount = (entry, f) => ({ id: String(entry._id), provider: f.provider, name: f.name, label: f.label, connectedAt: f.connectedAt });

router.get("/hosts/accounts", async (req, res) => {
  try {
    const dataKey = await req.rootUser.getDataKey();
    const accounts = (req.rootUser.hostAccounts || []).filter((e) => e.enc === "udk").map((e) => publicAccount(e, User.publicEntry(e, dataKey)));
    res.set("Cache-Control", "no-store");
    return res.json({ providers: ids().map((id) => ({ id, label: PROVIDERS[id].label, kind: PROVIDERS[id].kind })), accounts });
  } catch { return res.status(500).json({ error: "Could not load hosting connections." }); }
});

router.post("/hosts/accounts", async (req, res) => {
  const provider = PROVIDERS[text(req.body?.provider, 20)];
  if (!provider) return res.status(400).json({ error: "Choose a hosting provider." });
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (!/^\S{8,4096}$/.test(token)) return res.status(400).json({ error: "Enter a valid " + provider.label + " token." });
  if ((req.rootUser.hostAccounts || []).length >= MAX_ACCOUNTS) return res.status(400).json({ error: "You can connect up to " + MAX_ACCOUNTS + " hosting accounts." });
  const teamId = text(req.body?.teamId, 80);
  if (teamId && !/^[A-Za-z0-9_-]+$/.test(teamId)) return res.status(400).json({ error: "That team ID is not valid." });
  try {
    const checked = await provider.validate(token, { teamId });
    if (!checked.ok) return res.status(400).json({ error: checked.error });
    const dataKey = await req.rootUser.getDataKey();
    const now = new Date();
    const fields = { provider: provider.id, name: text(req.body?.name, 80) || checked.label, label: checked.label, token, teamId: checked.teamId || "", accountId: checked.accountId || "", connectedAt: now.toISOString() };
    const entry = { _id: new mongoose.Types.ObjectId(), enc: "udk", data: User.sealEntry(dataKey, fields), createdAt: now, updatedAt: now };
    await User.updateOne({ _id: req.rootUser._id }, { $push: { hostAccounts: entry } });
    return res.status(201).json({ account: publicAccount(entry, fields) });
  } catch { return res.status(500).json({ error: "Could not save this connection." }); }
});

router.delete("/hosts/accounts/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Connection not found." });
  try {
    const result = await User.updateOne({ _id: req.rootUser._id, "hostAccounts._id": req.params.id }, { $pull: { hostAccounts: { _id: req.params.id } } });
    if (!result.matchedCount) return res.status(404).json({ error: "Connection not found." });
    return res.json({ message: "Disconnected." });
  } catch { return res.status(500).json({ error: "Could not remove this connection." }); }
});

/* Deploy an existing GitHub repository + branch to a connected host and record it in Stashr. */
router.post("/hosts/deploy", deployLimiter, async (req, res) => {
  const b = req.body || {};
  const name = text(b.name, 80);
  const target = parseGithubRepo(b.repoUrl);
  const branch = text(b.branch, 200);
  if (!name) return res.status(400).json({ ok: false, error: "Give the project a name." });
  if (!target) return res.status(400).json({ ok: false, error: "That is not a GitHub repository URL." });
  if (branch && !BRANCH_RE.test(branch)) return res.status(400).json({ ok: false, error: "Choose a valid branch." });
  const envVars = [];
  for (const row of Array.isArray(b.envVars) ? b.envVars.slice(0, 50) : []) {
    const n = text(row?.name, 200);
    if (!n) continue;
    if (!ENV_NAME.test(n)) return res.status(400).json({ ok: false, error: "“" + n.slice(0, 40) + "” is not a valid variable name." });
    envVars.push({ name: n, value: typeof row.value === "string" ? row.value.slice(0, 8000) : "" });
  }
  try {
    const dataKey = await req.rootUser.getDataKey();
    const entry = mongoose.isValidObjectId(b.hostAccountId) ? (req.rootUser.hostAccounts || []).find((e) => String(e._id) === b.hostAccountId && e.enc === "udk") : null;
    const account = entry ? User.publicEntry(entry, dataKey) : null;
    const provider = account && PROVIDERS[account.provider];
    if (!provider) return res.status(400).json({ ok: false, error: "Choose a connected hosting account." });
    const gh = loadGithubAccounts(req.rootUser, dataKey).find((a) => a.id === text(b.githubAccountId, 40));
    if (!gh) return res.status(400).json({ ok: false, error: "Choose a connected GitHub account." });
    const repoInfo = await githubSend(gh.token, "GET", "/repos/" + encodeURIComponent(target.owner) + "/" + encodeURIComponent(target.repo));
    if (!repoInfo.ok) return res.status(422).json({ ok: false, error: repoInfo.status === 404 ? "Repository not found, or this GitHub token has no access to it." : "Could not read that repository from GitHub." });
    const owner = repoInfo.body.owner?.login || target.owner;
    const repo = repoInfo.body.name || target.repo;
    const defaultBranch = repoInfo.body.default_branch || "main";
    if (branch) {
      const found = await githubSend(gh.token, "GET", "/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/branches/" + branch.split("/").map(encodeURIComponent).join("/"));
      if (!found.ok) return res.status(422).json({ ok: false, error: found.status === 404 ? "The branch “" + branch + "” does not exist in " + owner + "/" + repo + "." : "Could not check the branch on GitHub." });
    }
    const input = {
      name: hostName(b.hostName || name), owner, repo, branch: branch || defaultBranch, defaultBranch, envVars,
      framework: text(b.framework, 40), buildCommand: text(b.buildCommand, 300), outputDir: text(b.outputDir, 200)
    };
    if (!input.name) return res.status(400).json({ ok: false, error: "That name can't be used. Use letters, numbers and dashes." });
    if (/[\r\n\0]/.test(input.buildCommand + input.outputDir)) return res.status(400).json({ ok: false, error: "Build settings must be a single line." });

    const result = await provider.deploy(account.token, account, input, undefined, (method, path, body) => githubSend(gh.token, method, path, body));
    if (!result.ok) return res.status(422).json({ ok: false, error: result.error, host: provider.label });

    const repoUrl = "https://github.com/" + owner + "/" + repo;
    const now = new Date();
    const fields = {
      name, description: text(b.description, 300), status: "in_progress", priority: "medium", repoUrl, repoAccount: owner,
      hostingProvider: provider.label, hostingServiceName: input.name, autoDeployBranch: input.branch, liveUrl: /^https:\/\//.test(result.service.url || "") ? result.service.url : "",
      envVars: envVars.map((v) => ({ name: v.name, value: v.value, purpose: "", source: "" })), databases: [], extraFields: []
    };
    let projectId = null;
    try {
      // Deploying a repo that already has a project adds a note to it instead of replacing its live URL or hosting.
      const key = groupKey(fields);
      const existing = (req.rootUser.projects || []).find((e) => e.enc === "udk" && groupKey(User.publicEntry(e, dataKey)) === key);
      if (existing && key && !key.startsWith("name:")) {
        const current = User.publicEntry(existing, dataKey);
        const extra = Array.isArray(current.extraFields) ? current.extraFields : [];
        const merged = { ...current, extraFields: [...extra, { label: provider.label + " · " + input.branch, value: result.service.url || result.service.dashboardUrl || input.name }] };
        await User.updateOne({ _id: req.rootUser._id, "projects._id": existing._id }, { $set: { "projects.$.data": User.sealEntry(dataKey, merged), "projects.$.updatedAt": now } });
        projectId = String(existing._id);
      } else {
        const item = { _id: new mongoose.Types.ObjectId(), enc: "udk", data: User.sealEntry(dataKey, fields), createdAt: now, updatedAt: now };
        await User.updateOne({ _id: req.rootUser._id }, { $push: { projects: item } });
        projectId = String(item._id);
      }
    } catch { /* the deploy itself succeeded; saving the Stashr project is best-effort */ }
    res.set("Cache-Control", "no-store");
    return res.status(201).json({ ok: true, host: provider.label, projectId, repo: { owner, repo, url: repoUrl, branch: input.branch }, service: result.service, note: result.note || "" });
  } catch {
    return res.status(500).json({ ok: false, error: "Could not deploy. Check the host and GitHub for anything already created." });
  }
});

module.exports = router;
