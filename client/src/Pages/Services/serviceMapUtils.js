/* Pure helpers for the service-mapping page (no React, so they are unit-tested). */

export const CATEGORIES = ["Database", "Media", "SMS / Voice", "Voice / speech", "Email", "Messaging", "AI", "Realtime", "Auth", "APIs", "Monitoring", "DevOps", "Other"];

/** "Acme Maps!" -> "acme-maps" (the id of a user-defined service). */
export const slugify = (label) => String(label || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/**
 * Every variable of a project as one row: what Stashr decided (owner + how), or nothing. The project merges every
 * server built from the repo, so a variable seen on several servers is one row.
 */
export function buildRows(project) {
  const rows = new Map();
  const put = (v, extra) => { if (v?.name && !rows.has(v.name)) rows.set(v.name, { name: v.name, kind: v.kind, set: v.set, display: v.display, ownerKey: "", ownerLabel: "", via: "", ...extra }); };
  for (const svc of project.services || []) for (const v of svc.vars || []) put(v, { ownerKey: svc.key, ownerLabel: svc.label, via: v.via || "name" });
  for (const v of project.otherVars || []) put(v, {});
  for (const v of project.internalVars || []) put(v, { ownerKey: "", ownerLabel: "App setting", via: "", internal: true });
  return [...rows.values()].sort((a, b) => Number(Boolean(a.ownerKey)) - Number(Boolean(b.ownerKey)) || a.name.localeCompare(b.name));
}

/** The user's current choice for a variable in a project: this project's first, then "all projects". */
export function choiceOf(draft, projectId, name) {
  const mine = draft[projectId + "|" + name];
  if (mine) return { ...mine, scope: "project" };
  const all = draft["*|" + name];
  return all ? { ...all, scope: "all" } : null;
}

/**
 * Returns a new mapping with the choice applied. `choice` carries role / group / scope; an empty key removes the
 * choice (back to Stashr's guess). Changing scope moves the entry between "this project" and "*".
 */
export function applyChoice(mapping, projectId, name, key, choice) {
  const next = { ...mapping };
  const scope = choice?.scope === "all" ? "*" : projectId;
  delete next[projectId + "|" + name];
  delete next["*|" + name];
  if (!key) return next;
  const entry = { key };
  const keepRole = choice?.role && choice.key === key ? choice.role : "";
  if (keepRole) { entry.role = keepRole; if (choice.group) entry.group = choice.group; }
  next[scope + "|" + name] = entry;
  return next;
}

export const sameMapping = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
const sortKeys = (o) => Object.fromEntries(Object.entries(o || {}).sort(([x], [y]) => x.localeCompare(y)));
