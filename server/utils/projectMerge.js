/* Pure helpers: find saved projects that are really the same app, and merge them into one. No I/O. */
const { repoKey } = require("./projectLink");

const META = ["_id", "id", "createdAt", "updatedAt", "broken"];
const nameKey = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const isEmpty = (value) => value == null || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && value.length === 0);

/** Same GitHub repo = same app. Projects without a repo fall back to the name ignoring case and punctuation. */
const groupKey = (project) => repoKey(project?.repoUrl) || (nameKey(project?.name) ? "name:" + nameKey(project.name) : "");

/** Groups of 2+ projects that look like the same app: [{ key, ids }]. */
function duplicateGroups(projects) {
  const groups = new Map();
  for (const p of projects || []) {
    if (!p || p.broken) continue;
    const key = groupKey(p);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(String(p._id ?? p.id));
  }
  return [...groups].filter(([, ids]) => ids.length > 1).map(([key, ids]) => ({ key, ids }));
}

const filled = (p) => Object.entries(p).filter(([k, v]) => !META.includes(k) && !isEmpty(v)).length;

/** The project to keep: most env vars, then most filled-in fields, then the oldest. */
function pickPrimary(projects) {
  return [...projects].sort((a, b) =>
    (b.envVars || []).length - (a.envVars || []).length
    || filled(b) - filled(a)
    || new Date(a.createdAt || 0) - new Date(b.createdAt || 0))[0];
}

/** Every Render service the projects were linked to, without repeats. */
function linkedServices(projects) {
  const out = [];
  const add = (accountId, serviceId, name) => {
    if (!accountId || !serviceId || out.some((s) => s.serviceId === serviceId)) return;
    out.push({ accountId: String(accountId), serviceId: String(serviceId), name: String(name || "") });
  };
  for (const p of projects) {
    add(p.renderAccountId, p.renderServiceId, p.renderServiceName);
    for (const s of Array.isArray(p.renderServices) ? p.renderServices : []) add(s.accountId, s.serviceId, s.name);
  }
  return out;
}

/**
 * Merges projects into the primary one. The primary's values always win; the others only fill in what the
 * primary is missing. Env vars are combined by name (a name with a different value elsewhere is reported in
 * `conflicts`, names only). Lists like databases are combined without exact repeats.
 */
function mergeProjects(primary, others) {
  const merged = { ...primary };
  META.forEach((k) => delete merged[k]);
  const conflicts = [];
  const envVars = [...(primary.envVars || [])];
  for (const other of others) {
    for (const [key, value] of Object.entries(other)) {
      if (META.includes(key) || key === "envVars" || key === "renderServices") continue;
      if (Array.isArray(value) && Array.isArray(merged[key])) {
        const seen = new Set(merged[key].map((v) => JSON.stringify(v)));
        merged[key] = [...merged[key], ...value.filter((v) => !seen.has(JSON.stringify(v)))];
      } else if (isEmpty(merged[key]) && !isEmpty(value)) merged[key] = value;
    }
    for (const row of other.envVars || []) {
      const mine = envVars.find((v) => v.name === row.name);
      if (!mine) envVars.push(row);
      else if (mine.value !== row.value && !conflicts.includes(row.name)) conflicts.push(row.name);
    }
  }
  merged.envVars = envVars;
  const services = linkedServices([primary, ...others]);
  if (services.length > 1 || (Array.isArray(primary.renderServices) && primary.renderServices.length)) merged.renderServices = services;
  if (!merged.renderServiceId && services.length) {
    merged.renderAccountId = services[0].accountId; merged.renderServiceId = services[0].serviceId; merged.renderServiceName = services[0].name;
  }
  return { fields: merged, conflicts };
}

module.exports = { duplicateGroups, groupKey, pickPrimary, mergeProjects, linkedServices };
