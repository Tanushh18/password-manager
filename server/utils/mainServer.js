/* Which Stashr server is the main one: the first URL of the "stashr" registry list. Only the main server runs the
   scheduler (cron). The others stay up but idle, and Render spins a free one down after 15 minutes without traffic.
   Fail-open: when this server does not know its own address, or there is no list, it runs, so cron never stops. */
const { urlsFor } = require("./registryDefaults");

const originOf = (value) => { try { return new URL(String(value || "").trim()).origin; } catch { return ""; } };

function isMainServer(urls, selfUrl) {
  const self = originOf(selfUrl);
  const main = originOf((urls || [])[0]);
  if (!self || !main) return true;
  return self === main;
}

const selfUrl = () => process.env.SELF_URL || process.env.RENDER_EXTERNAL_URL || "";

/** The saved list for Stashr (or its built-in default). */
async function stashrUrls() {
  const Registry = require("../models/registry");
  const doc = await Registry.findOne({ app: "stashr" }).lean();
  return urlsFor(doc, "stashr") || [];
}

async function shouldRunScheduler() {
  try { return isMainServer(await stashrUrls(), selfUrl()); } catch { return true; }
}

module.exports = { isMainServer, originOf, stashrUrls, shouldRunScheduler, selfUrl };
