/**
 * Project/infra tracker item model (same file as client/src/lib/projectItems.js).
 * Encrypted as one blob on the device before upload, same as a password entry.
 */
export const emptyDatabase = () => ({ label: "", provider: "", type: "", accountEmail: "", notes: "" });
export const emptyEnvVar = () => ({ name: "", value: "", purpose: "" });
export const emptyExtraField = () => ({ label: "", value: "" });

export const emptyProject = () => ({
  name: "",
  description: "",
  category: "",
  techStack: "",
  status: "planning", // planning | in_progress | deployed | broken | paused | archived
  priority: "medium", // low | medium | high
  tags: "",

  repoUrl: "",
  repoAccount: "",
  liveUrl: "",
  customDomain: "",

  hostingProvider: "",
  hostingAccountEmail: "",
  hostingAccountLabel: "",
  hostingServiceName: "",
  hostingPlan: "",
  hostingRegion: "",
  autoDeployBranch: "",

  firebaseProjectId: "",
  firebaseAccountEmail: "",
  googleCloudProjectId: "",
  googleCloudAccountEmail: "",

  playStorePackageName: "",
  playStoreAccountEmail: "",
  playStoreUrl: "",
  playStoreStatus: "",

  dnsProvider: "",
  dnsAccountEmail: "",

  monitoringProvider: "",
  monitoringAccountEmail: "",

  lastDeployedAt: "",
  notes: "",

  databases: [], // [{ label, provider, type, accountEmail, notes }]
  envVars: [], // [{ name, value, purpose }] — the actual secret values, encrypted with everything else
  extraFields: [], // [{ label, value }]
});

const clean = (v) => (v == null ? "" : String(v).trim());

export function normalizeProject(raw = {}) {
  const base = emptyProject();
  const next = { ...base };
  Object.keys(base).forEach((k) => {
    if (k === "databases" || k === "envVars" || k === "extraFields") return;
    next[k] = raw[k] == null ? base[k] : clean(raw[k]) || raw[k];
  });
  next.status = clean(raw.status) || "planning";
  next.priority = clean(raw.priority) || "medium";
  next.databases = Array.isArray(raw.databases)
    ? raw.databases.map((d) => ({ ...emptyDatabase(), ...d })).filter((d) => d.label || d.provider || d.type || d.accountEmail || d.notes)
    : [];
  next.envVars = Array.isArray(raw.envVars)
    ? raw.envVars.map((v) => ({ ...emptyEnvVar(), ...v })).filter((v) => v.name || v.value)
    : [];
  next.extraFields = Array.isArray(raw.extraFields)
    ? raw.extraFields.map((f) => ({ ...emptyExtraField(), ...f })).filter((f) => f.label)
    : [];
  return next;
}

export const STATUS_LABEL = {
  planning: "Planning",
  in_progress: "In progress",
  deployed: "Deployed",
  broken: "Broken",
  paused: "Paused",
  archived: "Archived",
};

export const STATUSES = ["planning", "in_progress", "deployed", "broken", "paused", "archived"];
export const PRIORITIES = ["low", "medium", "high"];

/**
 * Parses a raw .env-style block — exactly what you get pasting from Render's
 * Environment tab (or any KEY=VALUE dump) — into { name, value } rows.
 * Handles single-line values, quoted values, and multi-line quoted blocks
 * (e.g. a pasted Firebase service-account JSON wrapped in '...').
 */
export function parseEnvBlock(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const rows = [];
  let i = 0;

  const stripQuotes = (v) => {
    if (v.length >= 2 && ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))) {
      return v.slice(1, -1);
    }
    return v;
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) { i += 1; continue; }

    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) { i += 1; continue; }

    const [, key, rest] = m;
    const startsQuoted = /^['"]/.test(rest.trim());
    const quoteChar = startsQuoted ? rest.trim()[0] : null;
    const closesOnSameLine = quoteChar && rest.trim().length > 1 && rest.trim().endsWith(quoteChar);

    if (startsQuoted && !closesOnSameLine) {
      const blockLines = [rest.trim().slice(1)];
      i += 1;
      while (i < lines.length) {
        const l = lines[i];
        const closesHere = l.trim() === "}" || l.trim() === `}${quoteChar}` || l.trim().endsWith(`}${quoteChar}`);
        if (closesHere) { blockLines.push(l.trim().replace(new RegExp(`${quoteChar}$`), "")); i += 1; break; }
        blockLines.push(l);
        i += 1;
      }
      rows.push({ name: key, value: blockLines.join("\n") });
      continue;
    }

    rows.push({ name: key, value: stripQuotes(rest.trim()) });
    i += 1;
  }

  return rows.filter((r) => r.name);
}
