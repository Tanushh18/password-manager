/* The part of the Stashr URL propagation that touches the database and Render. The decisions live in
   stashrPropagation.js. Settings are sealed on the admin's account (like the other per-user settings). */
const User = require("../models/schema");
const { without } = require("./projection");
const renderOps = require("./renderOps");
const { isAdminEmail } = require("./registryDefaults");
const { stashrUrls } = require("./mainServer");
const P = require("./stashrPropagation");

const FIELD = "stashrPropagation";
const emptyState = () => ({ enabled: false, projectIds: [], applied: {}, testedAt: null, lastRunAt: null, lastRun: [] });

function readState(user, dataKey) {
  const entry = (user[FIELD] || [])[0];
  if (!entry || entry.enc !== "udk") return emptyState();
  try { return { ...emptyState(), ...(User.publicEntry(entry, dataKey) || {}) }; } catch { return emptyState(); }
}

async function writeState(user, dataKey, value) {
  const data = User.sealEntry(dataKey, value);
  if ((user[FIELD] || []).length) {
    await User.updateOne({ _id: user._id }, { $set: { [FIELD + ".0.enc"]: "udk", [FIELD + ".0.data"]: data, [FIELD + ".0.updatedAt"]: new Date() } });
  } else {
    await User.updateOne({ _id: user._id }, { $push: { [FIELD]: { enc: "udk", data, createdAt: new Date(), updatedAt: new Date() } } });
  }
}

function projectFields(user, dataKey, projectId) {
  const entry = (user.projects || []).find((item) => String(item._id) === String(projectId));
  if (!entry) return null;
  try { const fields = User.publicEntry(entry, dataKey); return fields && !fields.broken ? fields : null; } catch { return null; }
}

/** The user's projects that have a GitHub repository, for the checkbox list. */
function listProjects(user, dataKey) {
  return (user.projects || []).map((entry) => {
    let fields = null;
    try { fields = User.publicEntry(entry, dataKey); } catch { /* skipped */ }
    if (!fields || fields.broken || !fields.repoUrl) return null;
    return { id: String(entry._id), name: String(fields.name || fields.repoUrl).slice(0, 80), repo: String(fields.repoUrl).slice(0, 200), services: P.targetsOf(fields).length };
  }).filter(Boolean);
}

async function applyProject(user, dataKey, projectId, mainUrl) {
  const fields = projectFields(user, dataKey, projectId);
  if (!fields) return { projectId, ok: false, error: "Project not found." };
  const targets = P.targetsOf(fields);
  if (!targets.length) return { projectId, name: fields.name, ok: false, error: "No Render service is linked to this project." };
  const results = await P.applyToTargets(targets, mainUrl, {
    request: renderOps.renderRequest,
    apiKeyFor: (accountId) => renderOps.accountApiKey(user, dataKey, accountId),
    ...P.envNamesFor(fields)
  });
  return {
    projectId, name: fields.name, ok: P.projectApplied(results),
    services: results.map(({ name, ok, deployed, error, actions }) => ({ name, ok, deployed: Boolean(deployed), error: error || "", actions: actions || {} }))
  };
}

/**
 * Applies the current main URL. `only` runs a single project (the test); `force` runs the selected ones even when the
 * automatic switch is off (the manual button). Without either, it is the automatic run.
 */
async function runForUser(user, { only = null, force = false } = {}) {
  const dataKey = await user.getDataKey();
  const state = readState(user, dataKey);
  const mainUrl = (await stashrUrls())[0] || "";
  if (!mainUrl) return { skipped: "There is no main server URL." };
  if (!only && !force && !P.mayRunAutomatically(state)) return { skipped: "Automatic updates are off, or not tested yet." };
  if (only && !state.projectIds.includes(String(only))) return { skipped: "Select the project first." };

  const ids = only ? [String(only)] : P.projectsToUpdate(state, mainUrl);
  if (!ids.length) return { mainUrl, runs: [], upToDate: true };

  const runs = [];
  for (const id of ids) {
    const run = await applyProject(user, dataKey, id, mainUrl);
    runs.push(run);
    if (run.ok) state.applied[id] = mainUrl;
  }
  if (only && runs.length && runs.every((r) => r.ok)) state.testedAt = new Date().toISOString();
  state.lastRunAt = new Date().toISOString();
  state.lastRun = runs;
  await writeState(user, dataKey, state);
  return { mainUrl, runs };
}

/** The scheduler step: every admin with propagation settings. One failing does not stop the rest. */
async function runAllPropagation() {
  const users = await User.find({ [FIELD + ".0"]: { $exists: true } }, without("passwords", "renderMetricHistory", "renderIncidents", "renderAudit", "usageHistory")).limit(50);
  let applied = 0;
  for (const user of users) {
    if (!isAdminEmail(user.email)) continue;
    try { const result = await runForUser(user); applied += (result.runs || []).filter((r) => r.ok).length; } catch { /* next tick tries again */ }
  }
  return { projects: applied };
}

module.exports = { readState, writeState, listProjects, runForUser, runAllPropagation, emptyState };
