/* When Stashr's main server URL changes, put the new URL into the STASHR_SERVER_URL env var of every selected app's
   Render service(s) and deploy them again. The apps read that variable, so they follow Stashr without a code change.
   Per project, Stashr remembers the URL it last applied, so a failed app is retried on the next tick and a newly
   selected app is brought up to date. Only the variable STASHR_SERVER_URL is written; nothing is ever deleted. */
const ENV_NAME = "STASHR_SERVER_URL";
// Build tools only expose variables with their own prefix to browser and app code, so an app that already has
// REACT_APP_* variables reads REACT_APP_STASHR_SERVER_URL, a Vite app VITE_..., and so on.
const PREFIXES = ["REACT_APP_", "VITE_", "EXPO_PUBLIC_", "NEXT_PUBLIC_"];

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

/** The variable names to write for a project: the plain one, plus the prefixed one for each build tool it already uses. Pure. */
function envNamesFor(fields) {
  const names = new Set([ENV_NAME]);
  for (const row of Array.isArray(fields.envVars) ? fields.envVars : []) {
    const name = String((row && row.name) || "");
    for (const prefix of PREFIXES) if (name.startsWith(prefix)) names.add(prefix + ENV_NAME);
  }
  return [...names];
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

/** The variable names a service already has (Set), or null when they cannot be read. */
async function existingKeys(request, apiKey, base) {
  try {
    const list = await request(apiKey, base + "/env-vars?limit=100");
    if (!Array.isArray(list)) return null;
    return new Set(list.map((item) => (item && item.envVar ? item.envVar.key : item && item.key)).filter(Boolean));
  } catch { return null; }
}

/**
 * Writes the variable to each target and deploys it. `request(apiKey, path, options)` is Render's API call and
 * `apiKeyFor(accountId)` the key of that account. Returns one result per target; never throws for a single service.
 */
async function applyToTargets(targets, mainUrl, { request, apiKeyFor, names = [ENV_NAME], deploy = true }) {
  const results = [];
  for (const target of targets) {
    const apiKey = apiKeyFor(target.accountId);
    if (!apiKey) { results.push({ ...target, ok: false, error: "Render account not connected." }); continue; }
    const base = "/v1/services/" + encodeURIComponent(target.serviceId);
    // Render's PUT creates the variable when it is missing and updates it when it exists. Read the keys first only to
    // tell the user which one happened; if the read fails the write still goes ahead and is reported as "set".
    const existing = await existingKeys(request, apiKey, base);
    const actions = {};
    try {
      for (const name of names) {
        await request(apiKey, base + "/env-vars/" + name, { method: "PUT", body: { value: mainUrl } });
        actions[name] = existing ? (existing.has(name) ? "updated" : "created") : "set";
      }
    } catch (error) {
      results.push({ ...target, ok: false, error: error.status === 404 ? "Service no longer exists on Render." : "Render refused the variable." });
      continue;
    }
    let deployed = false;
    if (deploy) {
      try { await request(apiKey, base + "/deploys", { method: "POST", body: { clearCache: "do_not_clear", deployMode: "build_and_deploy" } }); deployed = true; }
      catch { /* a suspended service cannot deploy; the variable is saved and applies on its next start */ }
    }
    results.push({ ...target, ok: true, deployed, actions });
  }
  return results;
}

/** A project counts as applied when every one of its services accepted the variable. Pure. */
const projectApplied = (results) => results.length > 0 && results.every((r) => r.ok);

module.exports = { ENV_NAME, envNamesFor, targetsOf, projectsToUpdate, mayRunAutomatically, applyToTargets, projectApplied };
