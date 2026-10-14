/* Pure: usage percent, remaining and "approximately how many days are left". No I/O. */
const DAY = 24 * 60 * 60 * 1000;
const MIN_SPAN_MS = 20 * 60 * 60 * 1000;   // history needs at least ~a day between points to say anything
const MIN_ELAPSED_DAYS = 0.5;               // period run-rate needs at least half a day of data

/** Calendar-day quota period (UTC) for providers with daily limits (e.g. requests per day). */
function dayPeriod(now = new Date()) {
  const startsAt = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { type: "day", startsAt: new Date(startsAt).toISOString(), resetsAt: new Date(startsAt + 86400000).toISOString() };
}

/** Calendar-month quota period (UTC). Many providers reset monthly; the exact anniversary may differ, so this is approximate. */
function monthPeriod(now = new Date()) {
  const startsAt = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const resetsAt = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return { type: "month", startsAt: new Date(startsAt).toISOString(), resetsAt: new Date(resetsAt).toISOString() };
}

const round = (n, digits = 1) => (Number.isFinite(n) ? Math.round(n * 10 ** digits) / 10 ** digits : null);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** Points for one metric from stored snapshots [{ t, values: { key: number } }], oldest first. */
function seriesFor(snapshots, key) {
  return (Array.isArray(snapshots) ? snapshots : [])
    .filter((s) => s && isNum(s.t) && isNum(s.values?.[key]))
    .map((s) => ({ t: s.t, v: s.values[key] }))
    .sort((a, b) => a.t - b.t);
}

/** Per-day change using the first and last points of the window (needs about a day of spread). */
function dailyChange(points, now, windowDays = 14) {
  const recent = points.filter((p) => now - p.t <= windowDays * DAY);
  if (recent.length < 2) return null;
  const first = recent[0], last = recent[recent.length - 1];
  if (last.t - first.t < MIN_SPAN_MS) return null;
  return (last.v - first.v) / ((last.t - first.t) / DAY);
}

function statusFor(percent) {
  if (percent == null) return "unknown";
  return percent >= 95 ? "critical" : percent >= 80 ? "warn" : "ok";
}

/**
 * metric: { used?, limit?, remaining?, kind?: "usage" | "balance", period?: { startsAt, resetsAt } }
 *   usage metric with a monthly period -> run-rate this period (works from day one)
 *   usage metric that only grows (storage) -> trend from stored history
 *   balance metric (money / credits left) -> burn rate from stored history
 */
function projectMetric(metric, history = [], now = Date.now()) {
  const kind = metric.kind || "usage";
  const base = { percent: null, remaining: null, status: "unknown", daysLeft: null, exhaustsAt: null, willLast: null, method: null, note: "" };

  if (kind === "balance") {
    const left = isNum(metric.remaining) ? metric.remaining : null;
    const out = { ...base, remaining: left };
    if (left == null) return out;
    const change = dailyChange(history, now);
    if (change == null) { out.note = "Collecting data — burn rate appears after about a day of history."; return out; }
    const spend = -change;
    if (spend <= 0) { out.method = "history"; out.willLast = true; out.note = "Balance is not decreasing."; return out; }
    out.method = "history";
    out.daysLeft = round(left / spend);
    out.exhaustsAt = new Date(now + (left / spend) * DAY).toISOString();
    out.willLast = false;
    return out;
  }

  const used = isNum(metric.used) ? metric.used : null;
  const limit = isNum(metric.limit) && metric.limit > 0 ? metric.limit : null;
  const out = { ...base };
  if (used == null) return out;
  if (limit == null) { out.note = "No limit reported for this plan."; return out; }
  out.percent = round((used / limit) * 100);
  out.remaining = Math.max(0, limit - used);
  out.status = statusFor(out.percent);

  if (used >= limit) { out.daysLeft = 0; out.exhaustsAt = new Date(now).toISOString(); out.willLast = false; out.method = "reached"; return out; }

  if (metric.period?.startsAt && metric.period?.resetsAt) {
    const start = Date.parse(metric.period.startsAt), reset = Date.parse(metric.period.resetsAt);
    const elapsed = (now - start) / DAY;
    const periodLeft = Math.max(0, (reset - now) / DAY);
    out.method = "period-rate";
    if (used <= 0) { out.willLast = true; out.note = "No usage yet this period."; return out; }
    if (elapsed < (reset - start <= 86400000 * 1.01 ? 2 / 24 : MIN_ELAPSED_DAYS)) { out.method = null; out.note = "Too early in the period to project."; return out; }
    const rate = used / elapsed;
    const daysLeft = out.remaining / rate;
    out.projectedAtReset = round(used + rate * periodLeft, 2);
    out.willLast = out.projectedAtReset <= limit;
    out.daysLeft = out.willLast ? null : round(daysLeft);
    out.exhaustsAt = out.willLast ? null : new Date(now + daysLeft * DAY).toISOString();
    out.resetsInDays = round(periodLeft);
    if (out.willLast) out.note = "On track to last until the quota resets.";
    return out;
  }

  const change = dailyChange(history, now);
  if (change == null) { out.note = "Collecting data — projection appears after about a day of history."; return out; }
  out.method = "history";
  if (change <= 0) { out.willLast = true; out.note = "Usage is stable or shrinking."; return out; }
  const daysLeft = out.remaining / change;
  out.daysLeft = round(daysLeft);
  out.exhaustsAt = new Date(now + daysLeft * DAY).toISOString();
  out.willLast = false;
  out.growthPerDay = round(change, 2);
  return out;
}

module.exports = { projectMetric, monthPeriod, dayPeriod, seriesFor, dailyChange, statusFor };
