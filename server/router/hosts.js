const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/schema");
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");
const { PROVIDERS, ids, hostName } = require("../utils/hosts");
const { parseGithubRepo } = require("../utils/github");
const { githubGet, githubSend, loadGithubAccounts } = require("../utils/githubClient");
const crypto = require("crypto");
const { mapWithConcurrency } = require("../utils/renderGuards");
const { groupKey } = require("../utils/projectMerge");
const { applyClientFolder } = require("../utils/clientFolder");

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
    const folded = applyClientFolder({ folder: text(b.clientFolder, 200), buildCommand: input.buildCommand, outputDir: input.outputDir });
    if (folded.error) return res.status(400).json({ ok: false, error: folded.error });
    input.buildCommand = folded.buildCommand;
    input.outputDir = folded.outputDir;
    if (!input.name) return res.status(400).json({ ok: false, error: "That name can't be used. Use letters, numbers and dashes." });
    if (/[\r\n\0]/.test(input.buildCommand + input.outputDir)) return res.status(400).json({ ok: false, error: "Build settings must be a single line." });

    const result = await provider.deploy(account.token, account, input, undefined, (method, path, body) => githubSend(gh.token, method, path, body));
    if (!result.ok) return res.status(422).json({ ok: false, error: result.error, host: provider.label });

    const repoUrl = "https://github.com/" + owner + "/" + repo;
    const now = new Date();
    const fields = {
      name, description: text(b.description, 300), status: "in_progress", priority: "medium", repoUrl, repoAccount: owner,
      hostingProvider: provider.label, hostingServiceName: input.name, autoDeployBranch: input.branch, liveUrl: /^https:\/\//.test(result.service.url || "") ? result.service.url : "",
      envVars: envVars.map((v) => ({ name: v.name, value: v.value, purpose: "", source: "" })), databases: [], extraFields: [], hostLinks: []
    };
    // The host site is recorded as a link on the project, so its variables, deploys, logs and branch can be managed like a Render server.
    const hostLink = result.service?.id ? { id: crypto.randomBytes(8).toString("hex"), provider: account.provider, hostAccountId: text(b.hostAccountId, 40), remoteId: String(result.service.id), name: input.name, url: result.service.url || "", dashboardUrl: result.service.dashboardUrl || "", repo: owner + "/" + repo, branch: input.branch, meta: result.service.meta || {} } : null;
    if (hostLink) fields.hostLinks = [hostLink];
    let projectId = null;
    let linkId = hostLink ? hostLink.id : "";
    try {
      // Deploying a repo that already has a project adds a note to it instead of replacing its live URL or hosting.
      const key = groupKey(fields);
      const existing = (req.rootUser.projects || []).find((e) => e.enc === "udk" && groupKey(User.publicEntry(e, dataKey)) === key);
      if (existing && key && !key.startsWith("name:")) {
        const current = User.publicEntry(existing, dataKey);
        const extra = Array.isArray(current.extraFields) ? current.extraFields : [];
        const links = Array.isArray(current.hostLinks) ? current.hostLinks : [];
        const merged = { ...current, extraFields: [...extra, { label: provider.label + " · " + input.branch, value: result.service.url || result.service.dashboardUrl || input.name }], hostLinks: hostLink ? [...links, hostLink] : links };
        await User.updateOne({ _id: req.rootUser._id, "projects._id": existing._id }, { $set: { "projects.$.data": User.sealEntry(dataKey, merged), "projects.$.updatedAt": now } });
        projectId = String(existing._id);
      } else {
        const item = { _id: new mongoose.Types.ObjectId(), enc: "udk", data: User.sealEntry(dataKey, fields), createdAt: now, updatedAt: now };
        await User.updateOne({ _id: req.rootUser._id }, { $push: { projects: item } });
        projectId = String(item._id);
      }
    } catch { /* the deploy itself succeeded; saving the Stashr project is best-effort */ }
    res.set("Cache-Control", "no-store");
    return res.status(201).json({ ok: true, host: provider.label, projectId, linkId, repo: { owner, repo, url: repoUrl, branch: input.branch }, service: result.service, note: result.note || "" });
  } catch (error) {
    console.error("hosts/deploy failed:", error?.message || error);
    return res.status(500).json({ ok: false, error: "Could not deploy. Check the host and GitHub for anything already created." });
  }
});

/* ───────────── Link servers you already have ───────────── */
const accountOf = (req, dataKey, id) => {
  const entry = mongoose.isValidObjectId(id) ? (req.rootUser.hostAccounts || []).find((e) => String(e._id) === String(id) && e.enc === "udk") : null;
  const account = entry ? User.publicEntry(entry, dataKey) : null;
  return account && PROVIDERS[account.provider] ? account : null;
};
const projectOf = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.projectId)) { res.status(404).json({ error: "Could not find that project." }); return null; }
  const dataKey = await req.rootUser.getDataKey();
  const entry = (req.rootUser.projects || []).find((e) => String(e._id) === req.params.projectId && e.enc === "udk");
  if (!entry) { res.status(404).json({ error: "Could not find that project." }); return null; }
  const fields = User.publicEntry(entry, dataKey);
  if (fields.broken) { res.status(422).json({ error: "This project could not be decrypted." }); return null; }
  return { entry, fields, dataKey };
};
const saveLinks = (req, ctx, hostLinks) => User.updateOne({ _id: req.rootUser._id, "projects._id": ctx.entry._id }, { $set: { "projects.$.data": User.sealEntry(ctx.dataKey, { ...ctx.fields, hostLinks }), "projects.$.updatedAt": new Date() } });
const linksOf = (fields) => (Array.isArray(fields.hostLinks) ? fields.hostLinks : []).filter((l) => l && l.id && l.provider && l.remoteId);
const publicLink = (l) => ({ id: l.id, provider: l.provider, label: PROVIDERS[l.provider]?.label || l.provider, hostAccountId: l.hostAccountId, name: l.name, url: l.url || "", dashboardUrl: l.dashboardUrl || "", repo: l.repo || "", branch: l.branch || "", branchDeploy: Boolean(PROVIDERS[l.provider]?.branchDeploy) });

/* Sites/projects that already exist on a connected host, for the "link existing" picker. */
router.get("/hosts/accounts/:id/sites", async (req, res) => {
  try {
    const dataKey = await req.rootUser.getDataKey();
    const account = accountOf(req, dataKey, req.params.id);
    if (!account) return res.status(404).json({ error: "Connection not found." });
    const out = await PROVIDERS[account.provider].list(account.token, account);
    if (!out.ok) return res.status(422).json({ error: out.error });
    res.set("Cache-Control", "no-store");
    return res.json({ provider: account.provider, sites: out.sites.slice(0, 300).map((x) => ({ id: x.id, name: x.name, url: x.url, repo: x.repo, branch: x.branch })) });
  } catch { return res.status(500).json({ error: "Could not list the sites." }); }
});

router.post("/hosts/projects/:projectId/links", async (req, res) => {
  try {
    const ctx = await projectOf(req, res);
    if (!ctx) return undefined;
    const account = accountOf(req, ctx.dataKey, text(req.body?.hostAccountId, 40));
    if (!account) return res.status(400).json({ error: "Choose a connected hosting account." });
    const remoteId = text(req.body?.remoteId, 300);
    const found = await PROVIDERS[account.provider].list(account.token, account);
    if (!found.ok) return res.status(422).json({ error: found.error });
    const site = found.sites.find((x) => x.id === remoteId);
    if (!site) return res.status(404).json({ error: "That site was not found on this account." });
    const links = linksOf(ctx.fields);
    if (links.some((l) => l.provider === account.provider && l.remoteId === site.id && l.hostAccountId === text(req.body?.hostAccountId, 40))) return res.status(409).json({ error: "That site is already linked to this project." });
    if (links.length >= 20) return res.status(400).json({ error: "A project can link up to 20 servers." });
    const link = { id: crypto.randomBytes(8).toString("hex"), provider: account.provider, hostAccountId: text(req.body?.hostAccountId, 40), remoteId: site.id, name: site.name, url: site.url, dashboardUrl: site.dashboardUrl, repo: site.repo, branch: site.branch, meta: site.meta || {} };
    await saveLinks(req, ctx, [...links, link]);
    return res.status(201).json({ link: publicLink(link) });
  } catch { return res.status(500).json({ error: "Could not link this site." }); }
});

router.delete("/hosts/projects/:projectId/links/:linkId", async (req, res) => {
  try {
    const ctx = await projectOf(req, res);
    if (!ctx) return undefined;
    const links = linksOf(ctx.fields);
    if (!links.some((l) => l.id === req.params.linkId)) return res.status(404).json({ error: "That link was not found." });
    await saveLinks(req, ctx, links.filter((l) => l.id !== req.params.linkId));
    return res.json({ message: "Unlinked. The site itself was not touched." });
  } catch { return res.status(500).json({ error: "Could not unlink this site." }); }
});

/* Live status of every linked server of one project. One failing host never hides the others. */
router.get("/hosts/projects/:projectId/links", async (req, res) => {
  try {
    const ctx = await projectOf(req, res);
    if (!ctx) return undefined;
    const rows = await mapWithConcurrency(linksOf(ctx.fields), 3, async (link) => {
      const base = publicLink(link);
      const account = accountOf(req, ctx.dataKey, link.hostAccountId);
      if (!account) return { ...base, error: "Its " + base.label + " connection was removed. Connect it again to see the status." };
      try {
        const seen = await PROVIDERS[link.provider].inspect(account.token, account, link);
        if (!seen.ok) return { ...base, accountName: account.name, error: seen.error };
        return { ...base, accountName: account.name, name: seen.site.name || base.name, url: seen.site.url || base.url, dashboardUrl: seen.site.dashboardUrl || base.dashboardUrl, repo: seen.site.repo || base.repo, branch: seen.site.branch || base.branch, latestDeploy: seen.latestDeploy };
      } catch { return { ...base, accountName: account.name, error: "Could not read this server." }; }
    });
    res.set("Cache-Control", "no-store");
    return res.json({ links: rows });
  } catch { return res.status(500).json({ error: "Could not read the linked servers." }); }
});

/* Branches of the repository a linked server deploys, for hosts that can deploy any branch. */
router.get("/hosts/projects/:projectId/links/:linkId/branches", async (req, res) => {
  try {
    const ctx = await projectOf(req, res);
    if (!ctx) return undefined;
    const link = linksOf(ctx.fields).find((l) => l.id === req.params.linkId);
    if (!link) return res.status(404).json({ error: "That link was not found." });
    const target = parseGithubRepo(link.repo || ctx.fields.repoUrl);
    if (!target) return res.json({ connected: false, branches: [], current: link.branch || "" });
    for (const gh of loadGithubAccounts(req.rootUser, ctx.dataKey)) {
      const base = "/repos/" + encodeURIComponent(target.owner) + "/" + encodeURIComponent(target.repo);
      const repo = await githubGet(gh.token, base);
      if (!repo.ok) continue;
      const list = await githubGet(gh.token, base + "/branches?per_page=100");
      return res.json({ connected: true, current: link.branch || repo.body.default_branch || "", default: repo.body.default_branch || "", branches: list.ok && Array.isArray(list.body) ? list.body.map((b) => String(b.name)) : [] });
    }
    return res.json({ connected: false, branches: [], current: link.branch || "" });
  } catch { return res.status(500).json({ error: "Could not read the branches." }); }
});

router.post("/hosts/projects/:projectId/links/:linkId/redeploy", deployLimiter, async (req, res) => {
  try {
    const ctx = await projectOf(req, res);
    if (!ctx) return undefined;
    const link = linksOf(ctx.fields).find((l) => l.id === req.params.linkId);
    if (!link) return res.status(404).json({ error: "That link was not found." });
    const account = accountOf(req, ctx.dataKey, link.hostAccountId);
    if (!account) return res.status(400).json({ error: "Its connection was removed. Connect it again first." });
    const branch = text(req.body?.branch, 200);
    if (branch && (!BRANCH_RE.test(branch) || !PROVIDERS[link.provider].branchDeploy)) return res.status(400).json({ error: branch && !PROVIDERS[link.provider].branchDeploy ? PROVIDERS[link.provider].label + " can only redeploy its current branch from here." : "Choose a valid branch." });
    const out = await PROVIDERS[link.provider].redeploy(account.token, account, link, { branch });
    if (!out.ok) return res.status(422).json({ error: out.error });
    return res.json({ ok: true, branch: out.branch || "" });
  } catch { return res.status(500).json({ error: "Could not start the deployment." }); }
});

module.exports = router;
