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

/* Variables only the browser sees (they end up in the website bundle), never a server credential. */
export const PUBLIC_VAR = /^(NEXT_PUBLIC|NUXT_PUBLIC|EXPO_PUBLIC|REACT_APP|VITE|PUBLIC|GATSBY)_/i;

/** A variable the mapping page leaves out: browser-only by name, or read only by code outside the server folder. */
export const isFrontendVar = (name, project) => PUBLIC_VAR.test(name) || Boolean(project?.code?.frontendVars?.includes(name));

/* Which part of a service's credentials a variable name most likely is. Only a unique match counts. */
const ROLE_HINTS = {
  cloudName: /CLOUD|NAME/i, apiKey: /KEY|CLIENT_ID|\bID\b/i, apiSecret: /SECRET|PASS|PWD/i,
  uri: /URI|URL|CONNECTION|DSN|STRING/i, restUrl: /REST.*URL|URL/i, restToken: /TOKEN/i, url: /URL|HOST|ENDPOINT/i, token: /TOKEN|AUTH/i,
  accountSid: /SID|ACCOUNT/i, authToken: /TOKEN|AUTH/i, accessKey: /ACCESS/i, secretKey: /SECRET/i, bucket: /BUCKET/i, region: /REGION/i,
  endpoint: /ENDPOINT/i, user: /USER/i, password: /PASS/i
};
export function guessRole(roles, name, providerKey = "") {
  // Judge the part of the name that is left once the framework prefix and the service's own name are removed.
  const rest = String(name || "").replace(PUBLIC_VAR, "").replace(new RegExp(String(providerKey || "$^").replace(/[^a-z0-9]/gi, ""), "ig"), "_");
  const hits = (roles || []).filter(([role]) => ROLE_HINTS[role]?.test(rest)).map(([role]) => role);
  // A name that says SECRET is the secret, even though secrets are often called "KEY" too.
  if (hits.includes("apiSecret")) return "apiSecret";
  if (hits.includes("secretKey")) return "secretKey";
  if (hits.length > 1 && hits.includes("apiKey") && hits.includes("cloudName")) return "";
  return hits.length === 1 ? hits[0] : "";
}

/** Folder rows for the "which folder is your server" list: indented by depth, with a hint about what each looks like. */
export function folderRows(dirs, suggestion) {
  const FRONT = /(^|\/)(client|frontend|front-end|web|webapp|ui|www|mobile|android|ios|website)(\/|$)/i;
  return (dirs || []).map((d) => ({
    path: d.path, depth: d.path.split("/").length - 1, name: d.path.split("/").pop(), files: d.code || d.files,
    suggested: suggestion?.folder === d.path, why: suggestion?.folder === d.path ? suggestion.reason : "", looksFrontend: FRONT.test(d.path)
  }));
}
