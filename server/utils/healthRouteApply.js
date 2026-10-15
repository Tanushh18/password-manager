const { parseGithubRepo } = require("./github");
const { githubGet, githubSend, resolveRepo, probeScopes } = require("./githubClient");
const { planHealthPatch, candidateFiles } = require("./healthRoute");

/*
 * Adds a GET /health route to a repository: reads its files, inserts one small block (Express / FastAPI / Flask) or
 * a new route file (Next.js), commits it on a new branch, opens a pull request and, when asked, merges it straight
 * away (which makes Render redeploy). Needs a GitHub token with the "repo" scope. Nothing is force-pushed or deleted
 * except Stashr's own temporary branch after a merge.
 * Returns { status, body } so both the HTTP route and the monitor can use it.
 */
async function applyHealthRoute({ accounts, repoUrl, rootDir = "", merge = false }) {
  const target = parseGithubRepo(repoUrl);
  if (!target) return { status: 400, body: { error: "This service has no GitHub repository." } };
  const dir = typeof rootDir === "string" ? rootDir.replace(/[^A-Za-z0-9._/-]/g, "").slice(0, 120) : "";
  if (!accounts?.length) return { status: 400, body: { error: "Connect a GitHub token first (Projects → GitHub)." } };
  const resolved = await resolveRepo(accounts, target);
  if (resolved.error) return { status: resolved.error.status, body: { error: resolved.error.message } };
  const { repo, used, base } = resolved;
  if (!(await probeScopes(used.token)).write) return { status: 400, body: { error: "The GitHub token for " + repo.full_name + " is read-only. Add a classic token with the “repo” scope." } };

  const branchBase = repo.default_branch || "main";
  const enc = (path) => path.split("/").map(encodeURIComponent).join("/");
  const readFile = async (path) => {
    const r = await githubGet(used.token, base + "/contents/" + enc(path) + "?ref=" + encodeURIComponent(branchBase));
    if (!r.ok || r.body?.type !== "file" || typeof r.body.content !== "string") return null;
    return { text: Buffer.from(r.body.content, "base64").toString("utf8"), sha: r.body.sha };
  };
  try {
    const trim = dir.replace(/\/+$/, "");
    const pkgFile = (trim && await readFile(trim + "/package.json")) || await readFile("package.json");
    let pkg = null;
    try { pkg = pkgFile ? JSON.parse(pkgFile.text) : null; } catch { pkg = null; }
    const reqFile = (trim && await readFile(trim + "/requirements.txt")) || await readFile("requirements.txt");
    const files = {}, shas = {};
    for (const path of candidateFiles(dir, pkg).slice(0, 60)) {
      const f = await readFile(path);
      if (f) { files[path] = f.text; shas[path] = f.sha; }
    }
    const plan = planHealthPatch({ files, pkg, requirements: reqFile?.text || "", rootDir: dir });
    if (plan.error) return { status: plan.already ? 200 : 422, body: { ok: Boolean(plan.already), already: Boolean(plan.already), error: plan.error } };

    const ref = await githubGet(used.token, base + "/git/ref/heads/" + enc(branchBase));
    if (!ref.ok) return { status: 502, body: { error: "Could not read the " + branchBase + " branch." } };
    const branch = "stashr/health-route-" + Date.now().toString(36);
    const created = await githubSend(used.token, "POST", base + "/git/refs", { ref: "refs/heads/" + branch, sha: ref.body.object.sha });
    if (!created.ok) return { status: 502, body: { error: "Could not create a branch (" + created.status + ")." } };
    const commit = await githubSend(used.token, "PUT", base + "/contents/" + enc(plan.path), {
      message: "Add GET /health route for uptime monitoring", content: Buffer.from(plan.content, "utf8").toString("base64"), sha: shas[plan.path], branch
    });
    if (!commit.ok) return { status: 502, body: { error: "Could not commit the change (" + commit.status + ")." } };
    const pr = await githubSend(used.token, "POST", base + "/pulls", {
      title: "Add /health route", head: branch, base: branchBase,
      body: "Adds a `GET /health` route to `" + plan.path + "` (" + plan.framework + ") so Stashr and uptime monitors can check the service and keep it awake.\n\nOpened by Stashr."
    });
    if (!pr.ok) return { status: 502, body: { error: "Could not open the pull request (" + pr.status + ")." } };
    let merged = false, mergeError = "";
    if (merge) {
      const m = await githubSend(used.token, "PUT", base + "/pulls/" + pr.body.number + "/merge", { merge_method: "squash", commit_title: "Add /health route (#" + pr.body.number + ")" });
      merged = m.ok && m.body?.merged === true;
      if (merged) await githubSend(used.token, "DELETE", base + "/git/refs/heads/" + enc(branch));
      else mergeError = m.body?.message ? String(m.body.message).slice(0, 200) : "GitHub refused the merge (" + m.status + ").";
    }
    return { status: 200, body: { ok: true, framework: plan.framework, file: plan.path, prUrl: pr.body.html_url, prNumber: pr.body.number, merged, mergeError, repo: repo.full_name, branch: branchBase } };
  } catch {
    return { status: 500, body: { error: "Could not add the health route." } };
  }
}

module.exports = { applyHealthRoute };
