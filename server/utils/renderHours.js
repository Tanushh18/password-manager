/* Monthly Render free-hours budget, estimated from the instance counts Stashr samples itself.
   Render's API does not report the hours a workspace has used, so every number here is an estimate:
   check it against the Render dashboard (Billing / Usage) before acting on it.

   Totals are kept per calendar month in UTC and stored per workspace as:
     { month: "2026-10", byService: { "<serviceId>": instanceMinutes }, updatedAt }
   Free hours are per running instance, so one instance for one minute adds one instance-minute. */

const FREE_HOURS_PER_MONTH = 750;
const WARN_AT_PERCENT = 80;
// Sampling: the first sample stands for 5 minutes; a later one for the time since the last, capped so an outage adds nothing.
const FIRST_SAMPLE_MINUTES = 5;
const MAX_MINUTES_PER_SAMPLE = 15;

const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const monthEnd = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
const monthKey = (now = new Date()) => monthStart(now).toISOString().slice(0, 7);

/** Adds `count` running instances of one service for `minutes` minutes to the totals of its month. Returns new totals. */
function addRunningMinutes(totals, { serviceId, count, minutes, now = new Date() }) {
  const key = monthKey(now);
  const current = totals && totals.month === key ? totals : { month: key, byService: {} };
  const add = Math.max(0, Number(count) || 0) * Math.max(0, Number(minutes) || 0);
  const byService = { ...current.byService };
  if (serviceId && add > 0) byService[serviceId] = (byService[serviceId] || 0) + add;
  return { month: key, byService, updatedAt: now.toISOString() };
}

/** The budget for the current month. A stored total from an earlier month counts as zero (the month reset). */
function budgetStatus(totals, { now = new Date(), limit = FREE_HOURS_PER_MONTH } = {}) {
  const key = monthKey(now);
  const current = totals && totals.month === key ? totals : { byService: {} };
  const perService = Object.entries(current.byService || {})
    .map(([serviceId, minutes]) => ({ serviceId, hours: round(minutes / 60, 2) }))
    .sort((a, b) => b.hours - a.hours);
  const usedHours = perService.reduce((sum, s) => sum + s.hours, 0);

  const start = monthStart(now).getTime();
  const end = monthEnd(now).getTime();
  const elapsed = Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
  const projectedHours = elapsed > 0 ? usedHours / elapsed : usedHours;
  const percent = limit > 0 ? (usedHours / limit) * 100 : 0;

  // Hour at which the usage so far would reach the limit at today's pace (null when it will not, or nothing ran yet).
  let runsOutAt = null;
  if (usedHours > 0 && usedHours < limit && elapsed > 0) {
    const hoursPerElapsedFraction = usedHours / elapsed;
    runsOutAt = new Date(start + (limit / hoursPerElapsedFraction) * (end - start));
    if (runsOutAt.getTime() >= end) runsOutAt = null;
  }

  const level = percent >= 100 ? "over" : percent >= WARN_AT_PERCENT ? "warn" : "ok";
  return {
    month: key,
    usedHours: round(usedHours, 2),
    limitHours: limit,
    remainingHours: round(Math.max(0, limit - usedHours), 2),
    percent: round(percent, 1),
    projectedHours: round(projectedHours, 1),
    projectedOver: projectedHours >= limit,
    runsOutAt: runsOutAt ? runsOutAt.toISOString() : null,
    resetsAt: end ? new Date(end).toISOString() : null,
    level,
    perService,
    estimate: true
  };
}

/** Whether to tell the user now: only when the level got worse since the last check (so one alert per step). */
function shouldAlert(previousLevel, status) {
  const rank = { ok: 0, warn: 1, over: 2 };
  return status.level !== "ok" && rank[status.level] > (rank[previousLevel] ?? 0);
}

/** The latest instance count in a Render metrics payload, or null when there is no point. Pure. */
function latestCount(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  const points = data.flatMap((series) => Array.isArray(series?.values) ? series.values : [])
    .map((p) => ({ t: Date.parse(p?.timestamp), value: Number(p?.value) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.value))
    .sort((a, b) => a.t - b.t);
  return points.length ? points[points.length - 1].value : null;
}

/** Minutes this sample stands for: the time since the last sample, capped, so a long outage does not add hours. */
function minutesSince(lastSampledAt, now) {
  if (!lastSampledAt) return FIRST_SAMPLE_MINUTES;
  const elapsed = (now.getTime() - Date.parse(lastSampledAt)) / 60000;
  return Math.min(MAX_MINUTES_PER_SAMPLE, Math.max(0, elapsed));
}

const round = (n, digits = 1) => (Number.isFinite(n) ? Math.round(n * 10 ** digits) / 10 ** digits : null);

module.exports = { FREE_HOURS_PER_MONTH, WARN_AT_PERCENT, monthKey, monthStart, monthEnd, addRunningMinutes, budgetStatus, shouldAlert, latestCount, minutesSince };
