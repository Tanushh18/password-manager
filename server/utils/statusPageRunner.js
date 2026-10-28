/* Keeps each enabled public status page's snapshot current. Runs from the scheduler, and once when the page is saved. */
const User = require("../models/schema");
const { without } = require("./projection");
const renderOps = require("./renderOps");
const { buildSnapshot } = require("./statusPage");

async function refreshUser(user) {
  const dataKey = await user.getDataKey();
  const { services } = await renderOps.listEveryService(user, dataKey);
  const snapshot = buildSnapshot(services, (user.publicStatus && user.publicStatus.serviceIds) || [], new Date());
  await User.updateOne({ _id: user._id }, { $set: { "publicStatus.snapshot": snapshot } });
  return snapshot;
}

async function runAllStatusPages() {
  const users = await User.find({ "publicStatus.enabled": true }, without("passwords", "renderMetricHistory", "renderIncidents", "renderAudit", "usageHistory")).limit(200);
  let refreshed = 0;
  for (const user of users) {
    try { await refreshUser(user); refreshed += 1; } catch { /* one page failing must not stop the others */ }
  }
  return { pages: refreshed };
}

module.exports = { refreshUser, runAllStatusPages };
