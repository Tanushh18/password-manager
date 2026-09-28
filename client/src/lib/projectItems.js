/**
 * Project/infra tracker item model. Encrypted as one blob on the device
 * before upload, same as a password entry (see lib/items.js, state/vault.jsx).
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
