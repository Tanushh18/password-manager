/* Pure helpers for the GitHub integration (no I/O, so they can be unit-tested without a database). */

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Accepts a project's "Repo URL" in any of the forms people paste and returns `{ owner, repo }`,
 * or null if it isn't a github.com repository. Other hosts are rejected on purpose so a token is
 * only ever sent to api.github.com.
 */
function parseGithubRepo(input) {
  const raw = String(input || "").trim();
  if (!raw || raw.length > 300) return null;
  let path = "";
  const ssh = raw.match(/^(?:ssh:\/\/)?git@github\.com[:/](.+)$/i);
  if (ssh) path = ssh[1];
  else if (/^[\w.-]+\/[\w.-]+$/.test(raw) && !raw.includes("://")) path = raw;
  else {
    let url;
    try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : "https://" + raw); } catch { return null; }
    if (!/^https?:$/.test(url.protocol) || !/^(www\.)?github\.com$/i.test(url.hostname) || url.username || url.password) return null;
    path = url.pathname;
  }
  const [owner, rawRepo] = path.replace(/^\/+/, "").split("/");
  const repo = String(rawRepo || "").replace(/\.git$/i, "");
  if (!OWNER.test(owner || "") || !REPO.test(repo) || repo === "." || repo === "..") return null;
  return { owner, repo };
}

/** Tokens saved for the repo owner's login are tried first, then the rest in saved order. */
function orderAccounts(accounts, owner) {
  const wanted = String(owner || "").toLowerCase();
  const mine = accounts.filter((a) => String(a.login || "").toLowerCase() === wanted);
  return [...mine, ...accounts.filter((a) => !mine.includes(a))];
}

const firstLine = (text, max = 140) => String(text || "").split("\n")[0].slice(0, max);

/** Latest workflow run on the default branch -> a small CI summary (null if there are none). */
function ciSummary(runs, branch) {
  const list = Array.isArray(runs) ? runs : [];
  const run = list.find((r) => r && r.head_branch === branch) || list[0];
  if (!run) return null;
  const state = run.status !== "completed" ? "running"
    : run.conclusion === "success" ? "passing"
    : ["failure", "timed_out", "startup_failure"].includes(run.conclusion) ? "failing"
    : "other";
  return { state, conclusion: run.conclusion || null, name: String(run.name || "Workflow").slice(0, 100), branch: run.head_branch || null, url: run.html_url || null, at: run.updated_at || run.created_at || null };
}

/** Whitelists the fields we expose; raw GitHub payloads are never passed through to the browser. */
function shapeRepoDetails({ repo, commits, pulls, runs }) {
  return {
    repo: repo ? {
      fullName: repo.full_name, description: String(repo.description || "").slice(0, 300), url: repo.html_url,
      private: Boolean(repo.private), archived: Boolean(repo.archived), defaultBranch: repo.default_branch || null,
      language: repo.language || null, stars: repo.stargazers_count ?? 0, forks: repo.forks_count ?? 0,
      openIssuesAndPulls: repo.open_issues_count ?? 0, pushedAt: repo.pushed_at || null
    } : null,
    commits: (Array.isArray(commits) ? commits : []).slice(0, 5).map((c) => ({
      sha: String(c.sha || "").slice(0, 7), message: firstLine(c.commit?.message),
      author: String(c.commit?.author?.name || c.author?.login || "").slice(0, 80), at: c.commit?.author?.date || null, url: c.html_url || null
    })),
    pulls: (Array.isArray(pulls) ? pulls : []).slice(0, 10).map((p) => ({
      number: p.number, title: String(p.title || "").slice(0, 140), author: p.user?.login || "", draft: Boolean(p.draft),
      url: p.html_url, updatedAt: p.updated_at || null
    })),
    ci: ciSummary(runs, repo?.default_branch)
  };
}

/**
 * GitHub compare of `deployedSha...branch`. `behindBy` is how many commits on the branch have not been
 * deployed yet (compare.ahead_by, since the deployed commit is the base). Null if the payload is unusable.
 */
function shapeCompare(compare, branch) {
  if (!compare || typeof compare !== "object") return null;
  const known = ["ahead", "identical", "behind", "diverged"];
  return {
    status: known.includes(compare.status) ? compare.status : "unknown",
    behindBy: Math.max(0, Number(compare.ahead_by) || 0),
    branch: branch || null,
    commits: (Array.isArray(compare.commits) ? compare.commits : []).slice(-5).reverse().map((c) => ({
      sha: String(c.sha || "").slice(0, 7), message: firstLine(c.commit?.message), at: c.commit?.author?.date || null, url: c.html_url || null
    }))
  };
}

/** Maps a GitHub failure to a status/message that is safe and useful to show to the user. */
function githubError(status, headers = {}) {
  const remaining = headers["x-ratelimit-remaining"];
  if (status === 401) return { status: 401, message: "GitHub rejected this token. It may be revoked or expired." };
  if (status === 403 && String(remaining) === "0") return { status: 429, message: "GitHub rate limit reached for this token. Try again later." };
  if (status === 403) return { status: 403, message: "This token is not allowed to read that repository." };
  if (status === 404) return { status: 404, message: "Repository not found, or the token has no access to it." };
  return { status: 502, message: "GitHub returned an unexpected error." };
}

module.exports = { parseGithubRepo, orderAccounts, ciSummary, shapeRepoDetails, shapeCompare, githubError };
