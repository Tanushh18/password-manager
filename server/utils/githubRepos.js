const { githubGet } = require("./githubClient");
const { hashValue } = require("./envHash");

/* Lists every repository a saved GitHub token can see (read-only). Used by the automatic project sync. */
const PER_PAGE = 100;
const MAX_PAGES = 5;
const TTL_MS = 2 * 60 * 1000;
const cache = new Map();

const shape = (r) => ({
  key: String(r.full_name || "").toLowerCase(), owner: r.owner?.login || "", name: r.name || "",
  url: r.html_url || "", description: String(r.description || "").slice(0, 280), language: r.language || "",
  archived: Boolean(r.archived), fork: Boolean(r.fork), private: Boolean(r.private), pushedAt: r.pushed_at || ""
});

/** { ok, repos, truncated } or { ok: false, status }. Cached briefly per token. */
async function listRepos(token, { refresh = false } = {}) {
  const id = hashValue(token);
  const hit = cache.get(id);
  if (hit && !refresh && Date.now() - hit.at < TTL_MS) return hit.data;
  const repos = [];
  let truncated = false;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await githubGet(token, "/user/repos?per_page=" + PER_PAGE + "&page=" + page + "&sort=pushed&affiliation=owner,collaborator,organization_member");
    if (!result.ok || !Array.isArray(result.body)) return { ok: false, status: result.status };
    repos.push(...result.body.map(shape).filter((r) => r.key && r.url));
    if (result.body.length < PER_PAGE) break;
    if (page === MAX_PAGES) truncated = true;
  }
  const data = { ok: true, repos, truncated };
  if (cache.size > 50) cache.clear();
  cache.set(id, { at: Date.now(), data });
  return data;
}

module.exports = { listRepos, shape };
