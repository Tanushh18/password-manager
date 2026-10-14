/* Pure helpers for the Render control center. Kept free of React so they can be unit-tested. */

export const SERVICE_KINDS = ["Web service", "Static site", "Private service", "Cron job", "Background worker", "PostgreSQL"];

export const METRIC_OPTIONS = [
  ["cpu", "CPU usage"],
  ["memory", "Memory usage"],
  ["http-latency", "HTTP latency"],
  ["http-requests", "HTTP requests"],
  ["bandwidth", "Bandwidth"],
  ["instance-count", "Instance count"]
];

export const RANGE_OPTIONS = [
  ["1h", "Last hour", 60 * 60 * 1000],
  ["6h", "Last 6 hours", 6 * 60 * 60 * 1000],
  ["24h", "Last 24 hours", 24 * 60 * 60 * 1000],
  ["7d", "Last 7 days", 7 * 24 * 60 * 60 * 1000]
];

export const rangeStart = (range, now = Date.now()) => {
  const found = RANGE_OPTIONS.find(([value]) => value === range) || RANGE_OPTIONS[0];
  return new Date(now - found[2]).toISOString();
};

export const serviceKind = (s) => {
  const t = String(s?.type || "").toLowerCase();
  if (t.includes("static")) return "Static site";
  if (t.includes("private")) return "Private service";
  if (t.includes("cron")) return "Cron job";
  if (t.includes("postgres")) return "PostgreSQL";
  if (t.includes("worker")) return "Background worker";
  return "Web service";
};

export const serviceKey = (s) => s.accountId + ":" + s.id;

export const normalizeServices = (payload) => (Array.isArray(payload) ? payload : [])
  .map((entry) => entry?.service || entry)
  .filter((s) => s?.id)
  .map((s) => ({ ...s, ownerId: s.ownerId || s.owner?.id }));

export const normalizeList = (payload, key) => {
  const plural = key === "envVar" ? "envVars" : key + "s";
  const rows = Array.isArray(payload) ? payload
    : Array.isArray(payload?.[plural]) ? payload[plural]
    : Array.isArray(payload?.[key]) ? payload[key]
    : Array.isArray(payload?.data) ? payload.data : [];
  return rows.map((x) => x?.[key] || x).filter(Boolean);
};

export const initials = (value) => String(value || "R").split(/[\s\-_]+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join("").toUpperCase();

export const timeAgo = (value, now = Date.now()) => {
  if (!value) return "—";
  const stamp = new Date(value).getTime();
  if (!Number.isFinite(stamp)) return "—";
  const mins = Math.max(0, Math.floor((now - stamp) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  if (mins < 1440) return Math.floor(mins / 60) + "h ago";
  return Math.floor(mins / 1440) + "d ago";
};

export const formatNumber = (value, digits = 2) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : digits });
};

export const formatTime = (value) => {
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
};

export const formatDateTime = (value) => {
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : "—";
};

const MAX_POINTS = 120;

/** Number(null) is 0, which would plot a missing sample as a real zero. */
const hasValue = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));

/** Evenly thins a series so a 7-day range doesn't render thousands of SVG nodes. */
export const downsample = (points, max = MAX_POINTS) => {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out = [];
  for (let i = 0; i < max; i += 1) out.push(points[Math.floor(i * step)]);
  if (out[out.length - 1] !== points[points.length - 1]) out[out.length - 1] = points[points.length - 1];
  return out;
};

export const normalizeMetricPoints = (payload) => {
  const series = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  const points = series.flatMap((item) => Array.isArray(item?.values) ? item.values : [])
    .filter((point) => point?.timestamp && hasValue(point?.value) && Number.isFinite(new Date(point.timestamp).getTime()))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return downsample(points);
};

/** Sums every series that shares a timestamp (e.g. several instances of one service). */
export const sumMetricPoints = (payload) => {
  const totals = new Map();
  const series = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  series.flatMap((item) => Array.isArray(item?.values) ? item.values : []).forEach((point) => {
    const time = new Date(point?.timestamp).getTime();
    if (!hasValue(point?.value) || !Number.isFinite(time)) return;
    const value = Number(point.value);
    const timestamp = new Date(time).toISOString();
    const current = totals.get(timestamp);
    totals.set(timestamp, { timestamp, value: (current?.value || 0) + value, unit: point.unit || current?.unit || "" });
  });
  return downsample([...totals.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)));
};

export const peakOf = (points) => points.reduce((best, p) => (!best || Number(p.value) > Number(best.value) ? p : best), null);

export const ERROR_LOG_PATTERN = /error|fatal|exception|traceback|panic|\b5\d\d\b/i;
export const isErrorLog = (log) => ERROR_LOG_PATTERN.test(String(log?.level || "") + " " + String(log?.message || ""));

/** Rule-based log triage. Returns a list of human-readable findings. */
export const diagnoseLogText = (logs) => {
  const text = (logs || []).map((l) => String(l.message || "")).join("\n").toLowerCase();
  const findings = [];
  if (/econnrefused|connection refused|connect econn/.test(text)) findings.push("Connection refused: verify the target service is running, the hostname/port is correct, and private services share the expected network.");
  if (/econnreset|socket hang up|timeout|timed out/.test(text)) findings.push("Connection instability or timeout: check downstream latency, request timeouts, and whether the service is waking from a spin-down.");
  if (/out of memory|heap out of memory|oomkilled|memory limit/.test(text)) findings.push("Possible memory pressure: inspect memory usage, recent traffic and large in-memory operations.");
  if (/permission denied|unauthorized|forbidden|invalid token|\b401\b|\b403\b/.test(text)) findings.push("Authentication/permission failure: verify credential scope, token expiry and service-level access without pasting secrets into logs.");
  if (/missing environment|undefined|not configured|no such file|module not found/.test(text)) findings.push("Configuration or startup failure: compare required environment variables, root directory, build command and installed dependencies.");
  if (/syntaxerror|typeerror|referenceerror|uncaught exception|traceback|fatal/.test(text)) findings.push("Application exception detected: inspect the first stack trace and correlate it with the latest commit/deployment.");
  if (/\b429\b|rate limit|too many requests/.test(text)) findings.push("Rate limiting detected: review client retries, upstream quotas and request burst patterns.");
  if (/\b5\d\d\b|internal server error/.test(text)) findings.push("Server-side errors found: correlate request logs with app logs and compare against the last healthy deployment.");
  if (!findings.length) findings.push(logs?.length ? "No common failure signature matched. Review the newest entries, deployment build logs and service health result." : "Load application or build logs first, then run diagnostics.");
  return findings;
};

/** Latest event per (group, service, type); returns only those still open. */
export const openIncidents = (incidents) => {
  const latest = new Map();
  [...(incidents || [])]
    .sort((a, b) => Date.parse(a.at || a.openedAt || 0) - Date.parse(b.at || b.openedAt || 0))
    .forEach((incident) => latest.set([incident.groupId, incident.serviceKey, incident.type].join(":"), incident));
  return [...latest.values()].filter((incident) => incident.state === "open");
};

/**
 * Operational state of a service as shown in the inventory:
 * suspended > incident (open monitoring incident) > active.
 */
export const serviceState = (service, incidentKeys) => {
  if (service.suspended === "suspended") return "suspended";
  if (incidentKeys && incidentKeys.has(serviceKey(service))) return "incident";
  return "active";
};

export const STATE_LABEL = { active: "Active", incident: "Incident open", suspended: "Suspended" };

export const summarizeFleet = (services, incidents) => {
  const incidentKeys = new Set(openIncidents(incidents).map((i) => i.serviceKey));
  const counts = { active: 0, incident: 0, suspended: 0 };
  const kinds = {};
  services.forEach((s) => {
    counts[serviceState(s, incidentKeys)] += 1;
    const kind = serviceKind(s);
    kinds[kind] = (kinds[kind] || 0) + 1;
  });
  return { total: services.length, ...counts, kinds, incidentKeys };
};

const SORTERS = {
  name: (s) => String(s.name || "").toLowerCase(),
  account: (s) => String(s.accountName || "").toLowerCase(),
  type: (s) => serviceKind(s),
  region: (s) => String(s.serviceDetails?.region || ""),
  status: (s) => (s.suspended === "suspended" ? 1 : 0),
  updated: (s) => Date.parse(s.updatedAt || 0) || 0
};

export const sortServices = (rows, key, dir = "asc") => {
  const pick = SORTERS[key] || SORTERS.name;
  const sign = dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = pick(a), y = pick(b);
    if (x < y) return -1 * sign;
    if (x > y) return 1 * sign;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
};

export const paginate = (rows, page, pageSize) => {
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  return { rows: rows.slice((current - 1) * pageSize, current * pageSize), page: current, pages };
};

export const filterServices = (services, { query = "", accountId = "all", kind = "all", hideSuspended = false, favoriteIds = null }) => {
  const needle = query.trim().toLowerCase();
  return services.filter((s) => {
    if (needle) {
      const haystack = [s.name, s.type, s.serviceDetails?.region, s.accountName, s.branch, s.repo, s.id].join(" ").toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    if (favoriteIds && !favoriteIds.includes(serviceKey(s))) return false;
    if (accountId !== "all" && s.accountId !== accountId) return false;
    if (kind !== "all" && serviceKind(s) !== kind) return false;
    if (hideSuspended && s.suspended === "suspended") return false;
    return true;
  });
};

/** Only http(s) links may be rendered into href attributes from API data. */
export const safeUrl = (value, fallback = "https://dashboard.render.com") => {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : fallback;
  } catch { return fallback; }
};

export const readStored = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
};

export const writeStored = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* browser storage is optional */ }
};

export const errorMessage = (e, fallback) => e?.response?.data?.error || fallback;
