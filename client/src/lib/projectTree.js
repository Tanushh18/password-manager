/**
 * Turns a project into a tree of sections → fields, and searches across every
 * project's fields (env var names and values included). Pure functions, no
 * network: projects are already decrypted on the device.
 * Same file as mobile/src/lib/projectTree.js (client/tests checks they match).
 */

const has = (v) => v != null && String(v).trim() !== "";

const leaf = (label, value, extra = {}) => (has(value) ? { label, value: String(value), ...extra } : null);

const isUrl = (v) => /^(https?:\/\/|www\.)|^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(String(v).trim());

const branch = (id, label, children) => {
  const kids = children.filter(Boolean);
  return kids.length ? { id, label, children: kids } : null;
};

const link = (label, value) => leaf(label, value, { link: isUrl(value) });

/**
 * Sections of a project. Each section is { id, label, children }, where a
 * child is either a field { label, value, secret?, link? } or a nested
 * branch (one per database). Empty fields and empty sections are left out.
 */
export function projectTree(p = {}) {
  return [
    branch("overview", "Overview", [
      leaf("Category", p.category),
      leaf("Tech stack", p.techStack),
      leaf("Priority", p.priority),
      leaf("Tags", p.tags),
      leaf("Description", p.description),
      leaf("Last deployed", p.lastDeployedAt),
    ]),
    branch("repo", "Repo & URLs", [
      link("Repo URL", p.repoUrl),
      leaf("Repo account", p.repoAccount),
      link("Live URL", p.liveUrl),
      link("Custom domain", p.customDomain),
    ]),
    branch("hosting", "Hosting", [
      leaf("Provider", p.hostingProvider),
      leaf("Account email", p.hostingAccountEmail),
      leaf("Account label", p.hostingAccountLabel),
      leaf("Service name", p.hostingServiceName),
      leaf("Plan", p.hostingPlan),
      leaf("Region", p.hostingRegion),
      leaf("Auto-deploy branch", p.autoDeployBranch),
    ]),
    branch(
      "databases",
      "Databases",
      (p.databases || []).map((d, i) =>
        branch(`db-${i}`, d.label || d.provider || d.type || `Database ${i + 1}`, [
          leaf("Provider", d.provider),
          leaf("Type", d.type),
          leaf("Account email", d.accountEmail),
          leaf("Notes", d.notes),
        ])
      )
    ),
    branch("firebase", "Firebase / Google Cloud", [
      leaf("Firebase project ID", p.firebaseProjectId),
      leaf("Firebase account", p.firebaseAccountEmail),
      leaf("Google Cloud project ID", p.googleCloudProjectId),
      leaf("Google Cloud account", p.googleCloudAccountEmail),
    ]),
    branch("play", "Play Store", [
      leaf("Package name", p.playStorePackageName),
      leaf("Console account", p.playStoreAccountEmail),
      link("Store URL", p.playStoreUrl),
      leaf("Status", p.playStoreStatus),
    ]),
    branch("dns", "DNS & monitoring", [
      leaf("DNS provider", p.dnsProvider),
      leaf("DNS account", p.dnsAccountEmail),
      leaf("Monitoring", p.monitoringProvider),
      leaf("Monitoring account", p.monitoringAccountEmail),
    ]),
    branch(
      "env",
      "Environment variables",
      (p.envVars || []).map((v) => leaf(v.name || "(unnamed)", v.value, { secret: true, mono: true, hint: v.purpose || "" }))
    ),
    branch("custom", "Custom fields", (p.extraFields || []).map((f) => leaf(f.label, f.value))),
    branch("notes", "Notes", [leaf("Notes", p.notes)]),
  ].filter(Boolean);
}

/** Number of fields under a node (recursively). */
export const countLeaves = (node) =>
  node.children ? node.children.reduce((n, c) => n + countLeaves(c), 0) : 1;

/** Every field in a project, flattened with its path, e.g. ["Databases", "Main DB"]. */
export function flattenProject(project) {
  const out = [];
  const walk = (nodes, path) =>
    nodes.forEach((n) => {
      if (n.children) walk(n.children, [...path, n.label]);
      else out.push({ ...n, path });
    });
  walk(projectTree(project), []);
  return out;
}

/**
 * Searches all projects. Returns
 *   projects: projects whose name, status or any field matches
 *   values:   individual fields whose label (e.g. an env var name) or value
 *             matches, each with its project — so searching "MONGO_URI"
 *             gives the URI itself, not only the project.
 * Label matches rank before value-only matches, exact before partial.
 */
export function searchProjects(projects = [], query = "") {
  const term = String(query).trim().toLowerCase();
  if (!term) return { projects, values: [] };

  const values = [];
  const matched = [];

  projects.forEach((project) => {
    let hit = [project.name, project.status].some((v) => String(v || "").toLowerCase().includes(term));
    flattenProject(project).forEach((field) => {
      const label = field.label.toLowerCase();
      const value = field.value.toLowerCase();
      const inLabel = label.includes(term);
      const inValue = value.includes(term);
      if (!inLabel && !inValue) return;
      hit = true;
      const rank = label === term ? 0 : inLabel ? 1 : 2;
      values.push({ project, field, rank, matchedOn: inLabel ? "name" : "value" });
    });
    if (hit) matched.push(project);
  });

  values.sort((a, b) => a.rank - b.rank || a.field.label.localeCompare(b.field.label));
  return { projects: matched, values };
}
