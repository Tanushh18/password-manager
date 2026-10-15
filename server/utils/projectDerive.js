/*
 * Pure: fills a project's blank details from what its own environment variables already say. Only names and
 * hosts are used (never a password, key or token). Existing values are never overwritten; the "(auto)" list of
 * services is the only field Stashr keeps refreshing.
 */
const { detectServices } = require("./usageCatalog");

const hostOf = (value) => {
  const m = String(value || "").match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/\s]*@)?([^/:?#\s]+)/i);
  return m ? m[1].toLowerCase() : "";
};
const DB_HOSTS = [
  [/mongodb\.net$/, "MongoDB Atlas"], [/render\.com$/, "Render Postgres"], [/neon\.tech$/, "Neon"], [/supabase\.(co|com)$/, "Supabase"],
  [/upstash\.io$/, "Upstash"], [/redislabs\.com$|redis-cloud\.com$|redns\.redis-cloud\.com$/, "Redis Cloud"], [/turso\.io$/, "Turso"],
  [/railway\.app$|rlwy\.net$/, "Railway"], [/aivencloud\.com$/, "Aiven"], [/rds\.amazonaws\.com$/, "AWS RDS"], [/planetscale\.com|psdb\.cloud$/, "PlanetScale"],
  [/elephantsql\.com$/, "ElephantSQL"], [/cockroachlabs\.cloud$/, "CockroachDB"], [/firebaseio\.com$/, "Firebase"]
];
const providerFor = (host) => (DB_HOSTS.find(([re]) => re.test(host)) || [null, ""])[1];
const DB_KIND = [[/^mongodb(\+srv)?:/i, "MongoDB", "Document database"], [/^postgres(ql)?:/i, "PostgreSQL", "SQL database"], [/^mysql:/i, "MySQL", "SQL database"], [/^rediss?:/i, "Redis", "Key-value / cache"], [/^libsql:/i, "Turso (libSQL)", "SQL database"]];

/** NS hostnames -> DNS provider name. */
function dnsProviderFromNs(nameservers) {
  const ns = (nameservers || []).join(" ").toLowerCase();
  if (/cloudflare\.com/.test(ns)) return "Cloudflare";
  if (/awsdns/.test(ns)) return "AWS Route 53";
  if (/domaincontrol\.com/.test(ns)) return "GoDaddy";
  if (/registrar-servers\.com/.test(ns)) return "Namecheap";
  if (/googledomains\.com|google\.com/.test(ns)) return "Google";
  if (/hostinger/.test(ns)) return "Hostinger";
  if (/vercel-dns\.com/.test(ns)) return "Vercel";
  if (/nsone\.net/.test(ns)) return "NS1";
  if (/digitalocean\.com/.test(ns)) return "DigitalOcean";
  return ns ? ns.split(/\s+/)[0].replace(/^ns\d*\./, "") : "";
}

/** The patch to apply, or null. `nameservers` (optional) is the NS list of the project's domain. */
function deriveDetails(project, { nameservers = null } = {}) {
  const env = new Map((project?.envVars || []).filter((v) => v && v.name).map((v) => [v.name, String(v.value ?? "")]));
  const patch = {};

  // Databases: one entry per connection string, identified by kind + host.
  const databases = Array.isArray(project?.databases) ? [...project.databases] : [];
  const seen = new Set(databases.map((d) => (String(d.label || "") + "|" + String(d.notes || "")).toLowerCase()));
  for (const [, value] of env) {
    const kind = DB_KIND.find(([re]) => re.test(value.trim()));
    if (!kind) continue;
    const host = hostOf(value);
    if (!host) continue;
    const label = kind[1], notes = "host " + host;
    if (seen.has((label + "|" + notes).toLowerCase()) || databases.some((d) => String(d.notes || "").toLowerCase().includes(host))) continue;
    seen.add((label + "|" + notes).toLowerCase());
    databases.push({ label, provider: providerFor(host), type: kind[2], accountEmail: "", notes, source: "env" });
  }
  if (databases.length !== (project?.databases || []).length) patch.databases = databases;

  // Services used (auto): refreshed from the env var names every time.
  const used = detectServices(env).services.filter((s) => !["render", "github"].includes(s.key)).map((s) => s.label);
  const extras = Array.isArray(project?.extraFields) ? project.extraFields : [];
  const autoLabel = "Services used (auto)";
  const current = extras.find((f) => f.label === autoLabel);
  const value = [...new Set(used)].join(", ");
  if (value && (!current || current.value !== value)) patch.extraFields = [...extras.filter((f) => f.label !== autoLabel), { label: autoLabel, value }];
  if (!value && current) patch.extraFields = extras.filter((f) => f.label !== autoLabel);

  // Custom domain from the live URL, and who runs its DNS.
  const liveHost = hostOf(project?.liveUrl);
  if (!String(project?.customDomain || "").trim() && liveHost && !/\.onrender\.com$/.test(liveHost)) patch.customDomain = liveHost;
  if (!String(project?.dnsProvider || "").trim() && nameservers && nameservers.length) {
    const p = dnsProviderFromNs(nameservers);
    if (p) patch.dnsProvider = p;
  }
  return Object.keys(patch).length ? patch : null;
}

const apexOf = (host) => String(host || "").split(".").slice(-2).join(".");

module.exports = { deriveDetails, dnsProviderFromNs, apexOf, hostOf };
