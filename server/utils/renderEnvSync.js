const mongoose = require("mongoose");
const User = require("../models/schema");
const { renderRequest } = require("./renderOps");
const { fetchAllPages } = require("./renderPaging");
const { mergeRenderEnv } = require("./envMerge");

/*
 * One-way sync: a Render service's environment variables -> a Stashr project's saved variables.
 * Reads from Render only. Values are sealed with the account data key like every other project
 * field, and are never included in any return value (names only).
 */
const safeId = (value) => /^[A-Za-z0-9_-]{1,160}$/.test(String(value || ""));
const AUTO_INTERVAL_MS = 15 * 60 * 1000;
const MAX_AUTO_PER_USER = 10;
const STRIP = ["_id", "createdAt", "updatedAt", "broken"];

const fail = (status, message) => Object.assign(new Error(message), { status });

async function syncProjectEnv(user, projectId, { apply = false, resolveConflicts = false } = {}) {
  if (!mongoose.isValidObjectId(projectId)) throw fail(404, "Could not find that project.");
  const dataKey = await user.getDataKey();
  const entry = (user.projects || []).find((item) => String(item._id) === String(projectId));
  if (!entry) throw fail(404, "Could not find that project.");
  const fields = User.publicEntry(entry, dataKey);
  if (fields.broken) throw fail(422, "This project could not be decrypted.");
  if (!fields.renderAccountId || !fields.renderServiceId) throw fail(400, "Link this project to a Render service first.");
  if (!safeId(fields.renderServiceId)) throw fail(400, "Invalid Render service link.");

  const accountEntry = mongoose.isValidObjectId(fields.renderAccountId)
    ? (user.renderAccounts || []).find((item) => String(item._id) === String(fields.renderAccountId) && item.enc === "udk") : null;
  const account = accountEntry ? User.publicEntry(accountEntry, dataKey) : null;
  if (!account?.apiKey) throw fail(404, "The linked Render account is no longer connected. Re-link this project.");

  let listing;
  try {
    listing = await fetchAllPages((path) => renderRequest(account.apiKey, path), "/v1/services/" + encodeURIComponent(fields.renderServiceId) + "/env-vars");
  } catch (error) {
    throw fail(error.status === 404 ? 404 : 502, error.status === 404 ? "The linked Render service no longer exists." : "Could not read variables from Render.");
  }
  // Marking variables as "removed" from a partial listing would be wrong, so refuse instead.
  if (listing.truncated) throw fail(422, "This service has more variables than Stashr can safely load at once.");

  const remote = listing.items.map((item) => item?.envVar || item).filter((item) => item && typeof item.key === "string");
  const merged = mergeRenderEnv(fields.envVars, remote, { resolveConflicts });
  const summary = {
    added: merged.added, updated: merged.updated, removed: merged.removed, conflicts: merged.conflicts,
    unchanged: merged.unchanged.length, changed: merged.changed, applied: false, syncedAt: fields.renderSyncedAt || null
  };
  if (!apply) return summary;

  const now = new Date();
  const next = { ...fields };
  STRIP.forEach((key) => delete next[key]);
  next.envVars = merged.envVars;
  next.renderSyncedAt = now.toISOString();
  await User.updateOne(
    { _id: user._id, "projects._id": entry._id },
    { $set: { "projects.$.enc": "udk", "projects.$.data": User.sealEntry(dataKey, next), "projects.$.updatedAt": now } }
  );
  return { ...summary, applied: true, syncedAt: next.renderSyncedAt };
}

/** Background pass for the scheduler tick: refreshes every project that has auto-sync switched on. */
async function runAllEnvSync() {
  const summary = { usersChecked: 0, projectsSynced: 0, varsAdded: 0, varsUpdated: 0, errors: 0 };
  const users = await User.find({ "projects.0": { $exists: true }, "renderAccounts.0": { $exists: true } }).limit(1000);
  for (const user of users) {
    let dataKey;
    try { dataKey = await user.getDataKey(); } catch { summary.errors += 1; continue; }
    const due = (user.projects || []).filter((entry) => {
      if (entry.enc !== "udk") return false;
      const fields = User.publicEntry(entry, dataKey);
      return !fields.broken && fields.renderAutoSync === "on" && fields.renderAccountId && fields.renderServiceId
        && Date.now() - (Date.parse(fields.renderSyncedAt) || 0) >= AUTO_INTERVAL_MS;
    }).slice(0, MAX_AUTO_PER_USER);
    if (!due.length) continue;
    summary.usersChecked += 1;
    for (const entry of due) {
      try {
        // Auto-sync never overwrites a value the user typed by hand (conflicts are skipped).
        const result = await syncProjectEnv(user, entry._id, { apply: true, resolveConflicts: false });
        summary.projectsSynced += 1;
        summary.varsAdded += result.added.length;
        summary.varsUpdated += result.updated.length;
      } catch { summary.errors += 1; }
    }
  }
  return summary;
}

module.exports = { syncProjectEnv, runAllEnvSync, AUTO_INTERVAL_MS };
