const User = require("../models/schema");
const { PROVIDERS } = require("./hosts");
const { mapWithConcurrency } = require("./renderGuards");

/*
 * Sites on the user's connected Vercel / Netlify / Railway / Cloudflare accounts, shaped like Render services so the
 * Servers tab can match registry URLs against them. Read-only; a failing account never hides the others.
 */
const TTL_MS = 60 * 1000;
const cache = new Map();

async function loadHostSites(user, dataKey, { refresh = false } = {}) {
  const key = String(user._id);
  const hit = cache.get(key);
  if (hit && !refresh && Date.now() - hit.at < TTL_MS) return hit.data;
  const accounts = [];
  for (const entry of user.hostAccounts || []) {
    if (entry.enc !== "udk") continue;
    const f = User.publicEntry(entry, dataKey);
    if (f?.token && PROVIDERS[f.provider]) accounts.push({ id: String(entry._id), name: f.name || PROVIDERS[f.provider].label, ...f });
  }
  const services = [];
  await mapWithConcurrency(accounts, 3, async (account) => {
    const provider = PROVIDERS[account.provider];
    try {
      const out = await provider.list(account.token, account);
      if (!out.ok) return null;
      for (const s of out.sites) services.push({ id: s.id, name: s.name, repo: s.repo ? "https://github.com/" + s.repo : "", url: s.url, suspended: false, accountId: account.id, accountName: account.name, plan: "", region: "", dashboardUrl: s.dashboardUrl, provider: account.provider, providerLabel: provider.label });
    } catch { /* one account failing must not hide the others */ }
    return null;
  });
  const data = { services, count: accounts.length };
  if (cache.size > 100) cache.clear();
  cache.set(key, { at: Date.now(), data });
  return data;
}

module.exports = { loadHostSites };
