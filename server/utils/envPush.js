/* Pure: Stashr -> Render env var push planning. Render is only changed for names you explicitly approve. */
const { hashValue } = require("./envHash");

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * projectVars: [{ name, value, source?, renderHash? }]   renderVars: [{ key, value }]
 *   create    - not in Render yet
 *   update    - differs, and Render still has the value Stashr last saw (safe to overwrite)
 *   conflicts - differs, and Render's value changed since the last sync (or was never synced): needs explicit overwrite
 *   unchanged - identical
 *   onlyInRender - exists only in Render; never touched (and never deleted)
 *   skippedEmpty - empty values are not pushed
 */
function diffEnvPush(projectVars, renderVars) {
  const remote = new Map();
  for (const item of Array.isArray(renderVars) ? renderVars : []) if (item && NAME.test(String(item.key || ""))) remote.set(item.key, typeof item.value === "string" ? item.value : "");
  const plan = { create: [], update: [], conflicts: [], unchanged: [], onlyInRender: [], skippedEmpty: [], values: new Map() };
  const seen = new Set();
  for (const item of Array.isArray(projectVars) ? projectVars : []) {
    const name = item?.name;
    if (!NAME.test(String(name || "")) || seen.has(name) || item.source === "render-removed") continue;
    seen.add(name);
    const value = typeof item.value === "string" ? item.value : "";
    if (value === "") { plan.skippedEmpty.push(name); continue; }
    plan.values.set(name, value);
    if (!remote.has(name)) plan.create.push(name);
    else if (remote.get(name) === value) plan.unchanged.push(name);
    else if (item.renderHash && hashValue(remote.get(name)) === item.renderHash) plan.update.push(name);
    else plan.conflicts.push(name);
  }
  for (const name of remote.keys()) if (!seen.has(name)) plan.onlyInRender.push(name);
  return plan;
}

/**
 * What will really be sent. Only names the user approved are applied; conflicts additionally need to be
 * listed in `overwrite`. The server recomputes the plan at apply time, so a stale preview can't push extra names.
 */
function selectPushes(plan, { names = [], overwrite = [] } = {}) {
  const approved = new Set(names);
  const forced = new Set(overwrite);
  const pushes = [];
  const add = (name, action) => { if (approved.has(name)) pushes.push({ name, value: plan.values.get(name), action }); };
  plan.create.forEach((n) => add(n, "create"));
  plan.update.forEach((n) => add(n, "update"));
  plan.conflicts.filter((n) => forced.has(n)).forEach((n) => add(n, "overwrite"));
  return pushes;
}

module.exports = { diffEnvPush, selectPushes };
