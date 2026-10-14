const User = require("../models/schema");
const { orderAccounts, githubError } = require("./github");

/* Shared read-only GitHub access. Tokens only ever go to api.github.com. */
const GITHUB_API = "https://api.github.com";

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

/** Decrypts the user's saved GitHub connections. */
function loadGithubAccounts(user, dataKey) {
  return (user.githubAccounts || []).map((entry) => {
    const fields = entry.enc === "udk" ? User.publicEntry(entry, dataKey) : null;
    return fields && fields.token ? { id: String(entry._id), entry, dataKey, name: fields.name, login: fields.login, token: fields.token, connectedAt: fields.connectedAt } : null;
  }).filter(Boolean);
}

/**
 * Finds a token that can read owner/repo: the owner's own login first, then the rest.
 * Returns { repo, used } on success, otherwise { error } with a user-safe status/message.
 */
async function resolveRepo(accounts, target) {
  const base = "/repos/" + encodeURIComponent(target.owner) + "/" + encodeURIComponent(target.repo);
  let failure = null, invalid = 0;
  for (const account of orderAccounts(accounts, target.owner)) {
    const result = await githubGet(account.token, base);
    if (result.ok) return { repo: result.body, used: account, base };
    if (result.status === 401) invalid += 1;
    // Prefer the most informative failure: a 404/403 beats a transient error.
    if (!failure || result.status === 404 || result.status === 403) failure = githubError(result.network ? 502 : result.status, result.headers);
  }
  return { error: invalid && invalid === accounts.length ? githubError(401) : failure || githubError(502) };
}

module.exports = { githubGet, loadGithubAccounts, resolveRepo };
