const User = require("../models/schema");
const { without } = require("./projection");
const Registry = require("../models/registry");
const renderOps = require("./renderOps");
const { mapWithConcurrency } = require("./renderGuards");
const { planRegistrySync, applyRemovals } = require("./registrySync");
const { loadRenderServices } = require("./projectStatus");
const { ADMINS, DEFAULTS, APP_LABELS } = require("./registryDefaults");

/*
 * Servers tab <-> Render. Matching and status are read-only. The only automatic change to the registry is
 * dropping URLs of Render services that are suspended, and only while another URL remains.
 * Adding newly discovered services is a one-click suggestion, never automatic.
 */
const LOG_LIMIT = 20;

const stateOf = (service) => (service.suspended ? "suspended" : "active");

async function deployBrief(accounts, service) {
  const account = accounts.get(service.accountId);
  if (!account) return null;
  try {
    const rows = await renderOps.renderRequest(account.apiKey, "/v1/services/" + encodeURIComponent(service.id) + "/deploys?limit=1");
    const d = (Array.isArray(rows) ? rows : []).map((r) => r?.deploy || r)[0];
    return d ? { status: String(d.status || "unknown"), at: d.finishedAt || d.createdAt || null } : null;
  } catch { return null; }
}

const savedUrls = (doc, app) => (doc && doc.urls && doc.urls.length ? doc.urls : DEFAULTS[app]);

/** Per-app sync view for the admin Servers page. */
async function buildRegistrySync(user) {
  const dataKey = await user.getDataKey();
  const { services, accounts } = await loadRenderServices(user, dataKey);
  const docs = await Registry.find({}).lean();
  const byApp = new Map(docs.map((d) => [d.app, d]));
  const apps = [];
  for (const app of Object.keys(DEFAULTS)) {
    const doc = byApp.get(app);
    const urls = savedUrls(doc, app);
    const plan = planRegistrySync(urls, services);
    const items = await mapWithConcurrency(plan.items, 4, async (item) => {
      if (!item.service) return { url: item.url, kind: item.kind, service: null };
      const s = item.service;
      return { url: item.url, kind: item.kind, service: { name: s.name, accountName: s.accountName, state: stateOf(s), plan: s.plan, region: s.region, dashboardUrl: s.dashboardUrl, lastDeploy: await deployBrief(accounts, s) } };
    });
    apps.push({
      app, label: APP_LABELS[app], autoSync: doc ? doc.autoSync !== false : true, renderConnected: accounts.size > 0,
      items, add: plan.add, willRemove: plan.remove, log: (doc?.syncLog || []).slice(-5).reverse()
    });
  }
  return { apps };
}

async function setAutoSync(app, enabled, email) {
  if (!DEFAULTS[app]) return null;
  return Registry.findOneAndUpdate({ app }, { $set: { autoSync: Boolean(enabled), updatedBy: email } }, { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }).lean();
}

/** Background pass: applies the safe removals for every app with auto-sync on. */
async function runAllRegistrySync() {
  const summary = { appsChecked: 0, urlsRemoved: 0, errors: 0 };
  const admins = await User.find({ $expr: { $in: [{ $toLower: "$email" }, ADMINS] }, "renderAccounts.0": { $exists: true } }, without("passwords", "projects", "renderMetricHistory", "renderIncidents", "renderAudit", "usageHistory")).limit(5);
  if (!admins.length) return summary;
  const services = [];
  for (const admin of admins) {
    try { services.push(...(await loadRenderServices(admin, await admin.getDataKey(), { refresh: true })).services); } catch { summary.errors += 1; }
  }
  if (!services.length) return summary;
  for (const app of Object.keys(DEFAULTS)) {
    try {
      const doc = await Registry.findOne({ app }).lean();
      if (doc && doc.autoSync === false) continue;
      const urls = savedUrls(doc, app);
      summary.appsChecked += 1;
      const plan = planRegistrySync(urls, services);
      if (!plan.remove.length) continue;
      const next = applyRemovals(urls, plan.remove);
      if (next.length === urls.length) continue;
      const removed = urls.filter((u) => !next.includes(u));
      const at = new Date();
      const log = removed.map((url) => {
        const service = plan.items.find((i) => i.url === url)?.service;
        return { at, action: "removed", url, reason: "Render service " + (service?.name || "") + " is suspended" };
      });
      await Registry.findOneAndUpdate(
        { app },
        { $set: { urls: next, updatedAt: at, updatedBy: "render-sync" }, $push: { syncLog: { $each: log, $slice: -LOG_LIMIT } } },
        { upsert: true, setDefaultsOnInsert: true }
      );
      summary.urlsRemoved += removed.length;
    } catch { summary.errors += 1; }
  }
  return summary;
}

module.exports = { buildRegistrySync, setAutoSync, runAllRegistrySync };
