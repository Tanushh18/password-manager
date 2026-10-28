/* When Stashr's main server URL changes, put the new URL into the STASHR_SERVER_URL env var of every selected app's
   Render service(s) and deploy them again. The apps read that variable, so they follow Stashr without a code change.
   Per project, Stashr remembers the URL it last applied, so a failed app is retried on the next tick and a newly
   selected app is brought up to date. Only the variable STASHR_SERVER_URL is written; nothing is ever deleted. */
const ENV_NAME = "STASHR_SERVER_URL";

const safeId = (value) => /^[A-Za-z0-9_-]{1,160}$/.test(String(value || ""));

/** The Render services of one project (its primary link plus the merged ones), without duplicates. Pure. */
function targetsOf(fields) {
  const seen = new Set();
  const out = [];
  const add = (serviceId, accountId, name) => {
    if (!safeId(serviceId) || seen.has(serviceId)) return;
    seen.add(serviceId);
    out.push({ serviceId, accountId: accountId || fields.renderAccountId || "", name: String(name || serviceId).slice(0, 80) });
  };
  add(fields.renderServiceId, fields.renderAccountId, fields.name);
  for (const s of Array.isArray(fields.renderServices) ? fields.renderServices : []) if (s) add(s.serviceId, s.accountId, s.name);
  return out;
}

/** Project ids that still need the current URL. Pure. */
function projectsToUpdate(state, mainUrl) {
  if (!mainUrl) return [];
  return (state.projectIds || []).filter((id) => (state.applied || {})[id] !== mainUrl);
}

/** Automatic runs happen only when switched on, and only after a successful test. Pure. */
function mayRunAutomatically(state) {
  return Boolean(state.enabled && state.testedAt);
}

/**
 * Writes the variable to each target and deploys it. `request(apiKey, path, options)` is Render's API call and
 * `apiKeyFor(accountId)` the key of that account. Returns one result per target; never throws for a single service.
 */
async function applyToTargets(targets, mainUrl, { request, apiKeyFor, deploy = true }) {
  const results = [];
  for (const target of targets) {
    const apiKey = apiKeyFor(target.accountId);
    if (!apiKey) { results.push({ ...target, ok: false, error: "Render account not connected." }); continue; }
    const base = "/v1/services/" + encodeURIComponent(target.serviceId);
    try {
      await request(apiKey, base + "/env-vars/" + ENV_NAME, { method: "PUT", body: { value: mainUrl } });
    } catch (error) {
      results.push({ ...target, ok: false, error: error.status === 404 ? "Service no longer exists on Render." : "Render refused the variable." });
      continue;
    }
    let deployed = false;
    if (deploy) {
      try { await request(apiKey, base + "/deploys", { method: "POST", body: { clearCache: "do_not_clear", deployMode: "build_and_deploy" } }); deployed = true; }
      catch { /* a suspended service cannot deploy; the variable is saved and applies on its next start */ }
    }
    results.push({ ...target, ok: true, deployed });
  }
  return results;
}

/** A project counts as applied when every one of its services accepted the variable. Pure. */
const projectApplied = (results) => results.length > 0 && results.every((r) => r.ok);

module.exports = { ENV_NAME, targetsOf, projectsToUpdate, mayRunAutomatically, applyToTargets, projectApplied };
