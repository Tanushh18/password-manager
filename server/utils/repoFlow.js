const { TEMPLATES } = require("./templates");
const { pushInstructions } = require("./provision");

/*
 * The two-phase "create & deploy" flow:
 *   1. createRepo  - a PUBLIC GitHub repository (optionally with starter files), plus the git commands to push your code.
 *   2. checkRepo   - has any code arrived yet? Deploy stays locked until it has.
 * Free-tier hosting needs the repository to be public, so private is refused with a clear error. Nothing here deletes anything.
 */
const PRIVATE_ERROR = "Private repositories are not supported on the free tier. Make the repository public and try again.";

const enc = encodeURIComponent;
const b64 = (text) => Buffer.from(String(text), "utf8").toString("base64");
const failure = (error, extra = {}) => ({ ok: false, error, ...extra });

/** Commands for getting code into the repository: a fresh push, or a clone when starter files are already there. */
function codeCommands({ owner, repo, branch = "main", hasStarter }) {
  const https = "https://github.com/" + owner + "/" + repo + ".git";
  const ssh = "git@github.com:" + owner + "/" + repo + ".git";
  const commands = hasStarter
    ? ["git clone " + https, "cd " + repo, "# add or change your code here", "git add .", 'git commit -m "my code"', "git push origin " + branch]
    : pushInstructions({ owner, repo, branch }).commands;
  return { https, ssh, commands };
}

async function createRepo({ input, github }) {
  if (input.visibility !== "public") return failure(PRIVATE_ERROR, { failedStep: "github-repo", private: true });

  const created = await github.send("POST", "/user/repos", { name: input.repoName, private: false, description: input.description || undefined, auto_init: false });
  let owner, repo, branch = "main", reused = false;
  if (created.ok) {
    owner = created.body.owner?.login || github.login; repo = created.body.name || input.repoName; branch = created.body.default_branch || "main";
  } else if (created.status === 422) {
    const found = await github.send("GET", "/repos/" + enc(github.login) + "/" + enc(input.repoName));
    if (!found.ok) return failure("A repository named “" + input.repoName + "” already exists in your account. Pick another name.", { failedStep: "github-repo" });
    if (found.body.private) return failure(PRIVATE_ERROR, { failedStep: "github-repo", private: true });
    owner = found.body.owner?.login || github.login; repo = found.body.name || input.repoName; branch = found.body.default_branch || "main"; reused = true;
  } else if ([401, 403, 404].includes(created.status)) {
    return failure("This GitHub token cannot create repositories. It needs the “repo” scope.", { failedStep: "github-repo" });
  } else return failure("GitHub could not create the repository. Try again.", { failedStep: "github-repo" });

  const url = "https://github.com/" + owner + "/" + repo;
  let hasStarter = false;
  const template = TEMPLATES[input.template];
  if (template && !reused) {
    for (const [path, content] of Object.entries(template.files(input.repoName))) {
      const put = await github.send("PUT", "/repos/" + enc(owner) + "/" + enc(repo) + "/contents/" + path.split("/").map(enc).join("/"), { message: "Add " + path, content: b64(content) });
      if (!put.ok) return failure("Could not add " + path + " to the repository. The repository was kept.", { failedStep: "github-files", repo: { owner, repo, url } });
    }
    const info = await github.send("GET", "/repos/" + enc(owner) + "/" + enc(repo));
    if (info.ok && info.body.default_branch) branch = info.body.default_branch;
    hasStarter = true;
  }
  return { ok: true, reused, hasStarter, repo: { owner, repo, url, branch, private: false, ...codeCommands({ owner, repo, branch, hasStarter }) } };
}

/** { ok, hasCode, branch, private } for a repository, or { ok: false, error }. An empty repository is not an error. */
async function checkRepo({ github, owner, repo }) {
  const info = await github.send("GET", "/repos/" + enc(owner) + "/" + enc(repo));
  if (!info.ok) return failure(info.status === 404 ? "Repository not found, or this GitHub token has no access to it." : "Could not read that repository from GitHub.", { status: info.status });
  if (info.body.private) return failure(PRIVATE_ERROR, { status: 422, private: true });
  const branch = info.body.default_branch || "main";
  const commits = await github.send("GET", "/repos/" + enc(owner) + "/" + enc(repo) + "/commits?per_page=1&sha=" + enc(branch));
  const hasCode = commits.ok && Array.isArray(commits.body) && commits.body.length > 0;
  return { ok: true, hasCode, branch, private: false, pushedAt: info.body.pushed_at || "" };
}

/** `precheck` for provision(): refuse private repositories and repositories that have no code yet. Returns an error string or null. */
async function repoReadyError({ github, owner, repo }) {
  const status = await checkRepo({ github, owner, repo });
  if (!status.ok) return status.error;
  if (!status.hasCode) return "No code has been pushed to " + owner + "/" + repo + " yet. Push your code first, then deploy.";
  return null;
}

module.exports = { createRepo, checkRepo, repoReadyError, codeCommands, PRIVATE_ERROR };
