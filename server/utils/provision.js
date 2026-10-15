const { TEMPLATES } = require("./templates");
const { buildRenderPayload } = require("./provisionInput");
const { parseGithubRepo } = require("./github");
const { hashValue } = require("./envHash");

/*
 * One-click "create & deploy": GitHub repo -> starter files -> free Render service (with env vars) -> Stashr project.
 * Dependencies are injected so each step and failure path is testable. It never deletes anything: if a later
 * step fails, what was already created is kept and reported, and a retry can reuse the repository.
 */
const FREE_PLAN = "free";

const failure = (steps, step, error, extra = {}) => ({ ok: false, failedStep: step, error, steps, ...extra });
const done = (steps, step, detail) => steps.push({ step, status: "done", detail });
const skip = (steps, step, detail) => steps.push({ step, status: "skipped", detail });
const b64 = (text) => Buffer.from(String(text), "utf8").toString("base64");

/** Copy-paste commands for pushing local code to the new repository. Credentials are never embedded in URLs. */
function pushInstructions({ owner, repo, branch = "main" }) {
  const https = "https://github.com/" + owner + "/" + repo + ".git";
  const ssh = "git@github.com:" + owner + "/" + repo + ".git";
  return {
    https, ssh,
    commands: ["git init", "git add .", 'git commit -m "first commit"', "git branch -M " + branch, "git remote add origin " + https, "git push -u origin " + branch]
  };
}

async function provision({ input, github, render, ownerId: chosenOwner, saveProject, audit, precheck }) {
  const steps = [];

  /* 1. repository */
  let owner, repo, branch = "main";
  const bringOwn = input.template === "existing" || input.template === "empty";
  if (input.template === "existing") {
    const target = parseGithubRepo(input.existingRepoUrl);
    if (!target) return failure(steps, "github-repo", "That is not a GitHub repository URL.");
    const found = await github.send("GET", "/repos/" + encodeURIComponent(target.owner) + "/" + encodeURIComponent(target.repo));
    if (!found.ok) return failure(steps, "github-repo", found.status === 404 ? "Repository not found, or this GitHub token has no access to it." : "Could not read that repository from GitHub.");
    owner = found.body.owner?.login || target.owner; repo = found.body.name || target.repo; branch = found.body.default_branch || "main";
    if (precheck) {
      const refused = await precheck({ github, owner, repo });
      if (refused) return failure(steps, "github-repo", refused);
    }
    skip(steps, "github-repo", "Using existing repository " + owner + "/" + repo);
  } else {
    const created = await github.send("POST", "/user/repos", { name: input.repoName, private: input.visibility === "private", description: input.description || undefined, auto_init: false });
    if (created.ok) {
      owner = created.body.owner?.login || github.login; repo = created.body.name || input.repoName; branch = created.body.default_branch || "main";
      done(steps, "github-repo", "Created " + owner + "/" + repo + " (" + input.visibility + ")");
    } else if (created.status === 422 && input.useExistingRepo) {
      const found = await github.send("GET", "/repos/" + encodeURIComponent(github.login) + "/" + encodeURIComponent(input.repoName));
      if (!found.ok) return failure(steps, "github-repo", "Could not reuse the existing repository.");
      owner = found.body.owner?.login || github.login; repo = found.body.name; branch = found.body.default_branch || "main";
      skip(steps, "github-repo", "Reusing existing repository " + owner + "/" + repo);
    } else if (created.status === 422) {
      return failure(steps, "github-repo", "A repository named “" + input.repoName + "” already exists in your account. Pick another name, or reuse it.", { canReuseRepo: true });
    } else if (created.status === 401 || created.status === 403 || created.status === 404) {
      return failure(steps, "github-repo", "This GitHub token cannot create repositories. It needs the “repo” scope.");
    } else return failure(steps, "github-repo", "GitHub could not create the repository. Try again.");
  }
  const repoUrl = "https://github.com/" + owner + "/" + repo;

  /* 2. starter files (built-in templates only, and only into a repo we just created) */
  const template = TEMPLATES[input.template];
  if (template && !input.useExistingRepo) {
    for (const [path, content] of Object.entries(template.files(input.repoName))) {
      const put = await github.send("PUT", "/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo) + "/contents/" + path.split("/").map(encodeURIComponent).join("/"), { message: path === "package.json" || path === "requirements.txt" || path === "index.html" ? "Initial commit from Stashr" : "Add " + path, content: b64(content) });
      if (!put.ok) return failure(steps, "github-files", "Could not add " + path + " to the repository. The repository was kept.", { repo: { owner, repo, url: repoUrl } });
    }
    const info = await github.send("GET", "/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo));
    if (info.ok && info.body.default_branch) branch = info.body.default_branch;
    done(steps, "github-files", Object.keys(template.files(input.repoName)).length + " starter files committed");
  } else skip(steps, "github-files", bringOwn ? "Bring your own code" : "Repository reused");

  /* 3. Render owner */
  let ownerId = chosenOwner;
  try {
    const owners = (await render.request("/v1/owners?limit=20") || []).map((o) => o?.owner || o).filter((o) => o?.id);
    if (ownerId && !owners.some((o) => o.id === ownerId)) return failure(steps, "render-service", "That Render workspace is not part of this account.", { repo: { owner, repo, url: repoUrl } });
    ownerId = ownerId || owners[0]?.id;
  } catch (error) { return failure(steps, "render-service", "Could not read your Render workspaces.", { repo: { owner, repo, url: repoUrl } }); }
  if (!ownerId) return failure(steps, "render-service", "No Render workspace found for this account.", { repo: { owner, repo, url: repoUrl } });

  /* 4. Render service, free plan only */
  const payload = buildRenderPayload(input, { ownerId, repoUrl, branch });
  let service, deployId = null;
  try {
    const result = await render.request("/v1/services", { method: "POST", body: payload });
    service = result?.service || result;
    deployId = result?.deployId || null;
  } catch (error) {
    const hint = input.visibility === "private" ? " For a private repository, install Render’s GitHub app for this repository in Render once, then retry." : "";
    return failure(steps, "render-service", (error.message || "Render could not create the service.") + hint, { repo: { owner, repo, url: repoUrl }, canReuseRepo: true });
  }
  if (!service?.id) return failure(steps, "render-service", "Render did not return a service.", { repo: { owner, repo, url: repoUrl }, canReuseRepo: true });
  const plan = service.serviceDetails?.plan;
  if (plan && plan !== FREE_PLAN) return failure(steps, "render-service", "Render created the service on the “" + plan + "” plan, not free. Check it in Render now.", { repo: { owner, repo, url: repoUrl }, service: { id: service.id } });
  done(steps, "render-service", "Created " + service.name + " on the free plan" + (input.envVars.length ? " with " + input.envVars.length + " environment variable" + (input.envVars.length === 1 ? "" : "s") : ""));

  /* 5. Stashr project, already linked */
  const liveUrl = service.serviceDetails?.url || "";
  const now = new Date().toISOString();
  let projectId = null;
  try {
    projectId = await saveProject({
      name: input.name, description: input.description, status: "in_progress", priority: "medium",
      repoUrl, repoAccount: owner, hostingProvider: "Render", hostingServiceName: service.name, hostingRegion: input.region, hostingPlan: FREE_PLAN,
      autoDeployBranch: branch, liveUrl: /^https:\/\//.test(liveUrl) ? liveUrl : "",
      renderAccountId: input.renderAccountId, renderServiceId: service.id, renderServiceName: service.name, renderAutoSync: "on", renderAutoLinked: "", renderSyncedAt: now,
      envVars: input.envVars.map((v) => ({ name: v.name, value: v.value, purpose: "", source: "render", renderHash: hashValue(v.value) })),
      databases: [], extraFields: []
    });
    done(steps, "stashr-project", "Project created and linked");
  } catch (error) {
    steps.push({ step: "stashr-project", status: "failed", detail: "The repository and service were created, but saving the Stashr project failed." });
  }
  try { await audit({ template: input.template, repo: owner + "/" + repo, serviceId: service.id, visibility: input.visibility, envCount: input.envVars.length }); } catch { /* audit must never fail the request */ }

  const result = {
    ok: true, steps, projectId,
    repo: { owner, repo, url: repoUrl, branch, private: input.visibility === "private", ...pushInstructions({ owner, repo, branch }) },
    service: { id: service.id, name: service.name, url: liveUrl, dashboardUrl: service.dashboardUrl || "", plan: FREE_PLAN, type: payload.type },
    firstDeploy: input.template === "empty" ? "waiting-for-code" : deployId ? "started" : "pending",
    deployId
  };
  return result;
}

module.exports = { provision, pushInstructions };
