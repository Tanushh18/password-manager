const User = require("../models/schema");
const { orderAccounts, githubError } = require("./github");
const { hashValue } = require("./envHash");

/* Shared read-only GitHub access. Tokens only ever go to api.github.com. */
const GITHUB_API = "https://api.github.com";

async function githubRequest(token, method, path, body) {
  try {
    const response = await fetch(GITHUB_API + path, {
      method,
      headers: {
        Authorization: "Bearer " + token, Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Stashr-Projects",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000)
    });
    const parsed = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, body: parsed, headers: Object.fromEntries(response.headers) };
  } catch (error) {
    const timeout = error.name === "TimeoutError" || error.name === "AbortError";
    return { ok: false, status: timeout ? 504 : 502, body: null, headers: {}, network: true };
  }
}

const githubGet = (token, path) => githubRequest(token, "GET", path);
/** Write call (repo creation, file commits). Only used by the explicit "create & deploy" flow. */
const githubSend = (token, method, path, body) => githubRequest(token, method, path, body);

/* Scopes a classic token carries (X-OAuth-Scopes). Fine-grained tokens send no header: write ability is unknown, so false. */
const RISKY_SCOPES = ["delete_repo", "admin:org", "admin:enterprise", "admin:public_key", "admin:repo_hook", "admin:org_hook", "admin:gpg_key", "user", "codespace", "copilot", "delete:packages"];
const scopeCache = new Map();
async function probeScopes(token) {
  const key = hashValue(token);
  const hit = scopeCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.data;
  const result = await githubGet(token, "/user");
  const header = result.headers["x-oauth-scopes"];
  const scopes = typeof header === "string" ? header.split(",").map((s) => s.trim()).filter(Boolean) : null;
  const data = {
    valid: result.ok, scopes,
    write: Boolean(scopes && scopes.includes("repo")),
    workflow: Boolean(scopes && scopes.includes("workflow")),
    risky: (scopes || []).filter((s) => RISKY_SCOPES.includes(s))
  };
  if (result.ok || result.status === 401) { if (scopeCache.size > 50) scopeCache.clear(); scopeCache.set(key, { at: Date.now(), data }); }
  return data;
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

module.exports = { githubGet, githubSend, probeScopes, loadGithubAccounts, resolveRepo, RISKY_SCOPES };
