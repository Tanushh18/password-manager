/* Pure merge of a Render service's environment variables into a project's saved variables. No I/O. */

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * existing:    project.envVars  [{ name, value, purpose, source? }]
 * renderVars:  Render list     [{ key, value }]
 *
 * Rules (Render -> Stashr only; nothing is ever written back to Render):
 *  - new in Render                      -> added            (source "render")
 *  - from Render, value changed         -> updated
 *  - from Render, now gone from Render  -> kept, flagged source "render-removed" (never silently deleted)
 *  - manual entry, same value           -> adopted as linked (no value change)
 *  - manual entry, different value      -> conflict: kept unless `resolveConflicts`, then Render's value wins
 * Variables that exist only in the project are left untouched.
 */
function mergeRenderEnv(existing, renderVars, { resolveConflicts = false } = {}) {
  const current = Array.isArray(existing) ? existing : [];
  const remote = new Map();
  for (const item of Array.isArray(renderVars) ? renderVars : []) {
    if (item && NAME.test(String(item.key || ""))) remote.set(item.key, typeof item.value === "string" ? item.value : "");
  }
  const summary = { added: [], updated: [], removed: [], conflicts: [], unchanged: [] };
  const seen = new Set();
  const envVars = [];

  for (const original of current) {
    const item = { ...original };
    const name = item.name;
    if (!name || seen.has(name)) { envVars.push(item); continue; }
    if (!remote.has(name)) {
      if (item.source === "render") { item.source = "render-removed"; summary.removed.push(name); }
      envVars.push(item);
      continue;
    }
    seen.add(name);
    const value = remote.get(name);
    const fromRender = item.source === "render" || item.source === "render-removed";
    if (item.value === value) { item.source = "render"; summary.unchanged.push(name); }
    else if (fromRender) { item.value = value; item.source = "render"; summary.updated.push(name); }
    else {
      summary.conflicts.push(name);
      if (resolveConflicts) { item.value = value; item.source = "render"; summary.updated.push(name); }
    }
    envVars.push(item);
  }

  for (const [name, value] of remote) {
    if (seen.has(name)) continue;
    envVars.push({ name, value, purpose: "", source: "render" });
    summary.added.push(name);
  }

  const changed = JSON.stringify(envVars) !== JSON.stringify(current);
  return { envVars, changed, ...summary };
}

module.exports = { mergeRenderEnv };
