/* Samples how many instances each running Render service has, every scheduler tick, and keeps a monthly
   free-hours budget per connected Render account (a Render account is a workspace, and the 750 free hours are per workspace).
   Estimate only: see renderHours.js. The totals are sealed like the other per-user settings. */
const User = require("../models/schema");
const { without } = require("./projection");
const renderOps = require("./renderOps");
const { addRunningMinutes, budgetStatus, shouldAlert, latestCount, minutesSince } = require("./renderHours");

const FIELD = "renderHoursBudget";
const WINDOW_MINUTES = 15;
const RESOLUTION_SECONDS = 300;

const emptyState = () => ({ accounts: {} });

function readState(user, dataKey) {
  const entry = (user[FIELD] || [])[0];
  if (!entry || entry.enc !== "udk") return emptyState();
  try { return User.publicEntry(entry, dataKey) || emptyState(); } catch { return emptyState(); }
}

async function writeState(user, dataKey, value) {
  const data = User.sealEntry(dataKey, value);
  if ((user[FIELD] || []).length) {
    await User.updateOne({ _id: user._id }, { $set: { [FIELD + ".0.enc"]: "udk", [FIELD + ".0.data"]: data, [FIELD + ".0.updatedAt"]: new Date() } });
  } else {
    await User.updateOne({ _id: user._id }, { $push: { [FIELD]: { enc: "udk", data, createdAt: new Date(), updatedAt: new Date() } } });
  }
}

async function sampleService(apiKey, serviceId, now) {
  const params = new URLSearchParams({
    resource: serviceId,
    startTime: new Date(now.getTime() - WINDOW_MINUTES * 60000).toISOString(),
    endTime: now.toISOString(),
    resolutionSeconds: String(RESOLUTION_SECONDS)
  });
  const payload = await renderOps.renderRequest(apiKey, "/v1/metrics/instance-count?" + params.toString());
  return latestCount(payload);
}

/** Samples every running service of one user and updates their budget. Returns per-account results (no secrets). */
async function sampleUser(user, now = new Date()) {
  const dataKey = await user.getDataKey();
  const { services } = await renderOps.listEveryService(user, dataKey);
  const state = readState(user, dataKey);
  const results = {};

  const accountIds = [...new Set(services.map((s) => s.accountId))];
  for (const accountId of accountIds) {
    const apiKey = renderOps.accountApiKey(user, dataKey, accountId);
    if (!apiKey) continue;
    const running = services.filter((s) => s.accountId === accountId && !s.suspended);
    const prev = state.accounts[accountId] || { totals: null, lastSampledAt: null, level: "ok" };
    const minutes = minutesSince(prev.lastSampledAt, now);
    let totals = prev.totals;
    try {
      for (const service of running) {
        const count = await sampleService(apiKey, service.id, now);
        if (count === null) continue;
        totals = addRunningMinutes(totals, { serviceId: service.id, count, minutes, now });
      }
    } catch {
      // A failed metrics call leaves this account's totals as they were; the next tick tries again.
      results[accountId] = { ok: false };
      continue;
    }
    const status = budgetStatus(totals, { now });
    const alert = shouldAlert(prev.level, status);
    state.accounts[accountId] = { totals, lastSampledAt: now.toISOString(), level: status.level };
    results[accountId] = { ok: true, level: status.level, usedHours: status.usedHours, alert };
  }

  if (Object.keys(results).length) await writeState(user, dataKey, state);
  return results;
}

/** The current budget of every account of one user, read from the stored totals (no Render calls). */
async function budgetsFor(user, now = new Date()) {
  const dataKey = await user.getDataKey();
  const state = readState(user, dataKey);
  return Object.fromEntries(Object.entries(state.accounts).map(([accountId, acc]) => [accountId, {
    ...budgetStatus(acc.totals, { now }),
    lastSampledAt: acc.lastSampledAt || null
  }]));
}

/** The scheduler step: samples every user who has a connected Render account. One user failing does not stop the others. */
async function runAllRenderHours() {
  const users = await User.find({ "renderAccounts.0": { $exists: true } }, without("passwords", "renderMetricHistory", "renderIncidents", "renderAudit", "usageHistory")).limit(500);
  let sampled = 0;
  for (const user of users) {
    try { await sampleUser(user); sampled += 1; } catch { /* keep going */ }
  }
  return { users: sampled };
}

module.exports = { sampleUser, budgetsFor, runAllRenderHours, FIELD };
