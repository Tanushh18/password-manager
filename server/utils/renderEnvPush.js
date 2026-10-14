const mongoose = require("mongoose");
const User = require("../models/schema");
const { renderRequest } = require("./renderOps");
const { fetchAllPages } = require("./renderPaging");
const { mapWithConcurrency } = require("./renderGuards");
const { diffEnvPush, selectPushes } = require("./envPush");
const { hashValue } = require("./envHash");

/*
 * Stashr -> Render env var push. The ONLY thing that writes to Render's variables, and only for names the
 * user approved. Never deletes. Values are sent to Render and stored sealed in the project; they are never
 * included in any return value (names only).
 */
const safeId = (value) => /^[A-Za-z0-9_-]{1,160}$/.test(String(value || ""));
const STRIP = ["_id", "createdAt", "updatedAt", "broken"];
const fail = (status, message) => Object.assign(new Error(message), { status });

async function pushProjectEnv(user, projectId, { apply = false, names = [], overwrite = [], deploy = false } = {}) {
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

  const servicePath = "/v1/services/" + encodeURIComponent(fields.renderServiceId);
  let listing;
  try { listing = await fetchAllPages((path) => renderRequest(account.apiKey, path), servicePath + "/env-vars"); }
  catch (error) { throw fail(error.status === 404 ? 404 : 502, error.status === 404 ? "The linked Render service no longer exists." : "Could not read variables from Render."); }
  if (listing.truncated) throw fail(422, "This service has more variables than Stashr can safely load at once.");

  const remote = listing.items.map((item) => item?.envVar || item).filter((item) => item && typeof item.key === "string");
  const plan = diffEnvPush(fields.envVars, remote);
  const others = (Array.isArray(fields.renderServices) ? fields.renderServices : []).filter((s) => s && s.serviceId !== fields.renderServiceId && safeId(s.serviceId));
  const preview = { alsoTo: others.map((s) => s.name || s.serviceId), create: plan.create, update: plan.update, conflicts: plan.conflicts, unchanged: plan.unchanged.length, onlyInRender: plan.onlyInRender, skippedEmpty: plan.skippedEmpty, applied: false };
  if (!apply) return preview;

  const pushes = selectPushes(plan, { names, overwrite });
  const results = await mapWithConcurrency(pushes, 3, async (push) => {
    try {
      await renderRequest(account.apiKey, servicePath + "/env-vars/" + encodeURIComponent(push.name), { method: "PUT", body: { value: push.value } });
      return { ok: true, name: push.name, action: push.action };
    } catch (error) { return { ok: false, name: push.name, error: error.message || "Render refused this variable." }; }
  });
  const pushed = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok).map((r) => ({ name: r.name, error: r.error }));

  if (pushed.length) {
    const pushedNames = new Set(pushed.map((r) => r.name));
    const now = new Date();
    const next = { ...fields };
    STRIP.forEach((key) => delete next[key]);
    next.envVars = (fields.envVars || []).map((row) => (pushedNames.has(row.name) ? { ...row, source: "render", renderHash: hashValue(row.value) } : row));
    next.renderSyncedAt = now.toISOString();
    const sealed = User.sealEntry(dataKey, next);
    await User.updateOne({ _id: user._id, "projects._id": entry._id }, { $set: { "projects.$.enc": "udk", "projects.$.data": sealed, "projects.$.updatedAt": now } });
    entry.enc = "udk"; entry.data = sealed;
  }

  let deployed = false;
  if (deploy && pushed.length) {
    try { await renderRequest(account.apiKey, servicePath + "/deploys", { method: "POST", body: { clearCache: "do_not_clear", deployMode: "build_and_deploy" } }); deployed = true; }
    catch { /* the variables are saved; the user can deploy manually */ }
  }

  // A project merged from several deployments of the same repo: send the same variables to every other service too.
  const otherServices = await mapWithConcurrency(others, 2, async (target) => {
    const acc = target.accountId === fields.renderAccountId ? account : (() => {
      const e = mongoose.isValidObjectId(target.accountId) ? (user.renderAccounts || []).find((item) => String(item._id) === String(target.accountId) && item.enc === "udk") : null;
      return e ? User.publicEntry(e, dataKey) : null;
    })();
    if (!acc?.apiKey) return { serviceId: target.serviceId, name: target.name, pushed: 0, error: "Render account not connected." };
    const path = "/v1/services/" + encodeURIComponent(target.serviceId);
    let ok = 0, error = "";
    for (const r of pushed) {
      const push = pushes.find((p) => p.name === r.name);
      try { await renderRequest(acc.apiKey, path + "/env-vars/" + encodeURIComponent(push.name), { method: "PUT", body: { value: push.value } }); ok += 1; }
      catch (e) { error = e.status === 404 ? "Service no longer exists on Render." : (e.message || "Render refused a variable."); if (e.status === 404) break; }
    }
    let svcDeployed = false;
    if (deploy && ok) {
      try { await renderRequest(acc.apiKey, path + "/deploys", { method: "POST", body: { clearCache: "do_not_clear", deployMode: "build_and_deploy" } }); svcDeployed = true; }
      catch { /* suspended services can't deploy; variables are still saved */ }
    }
    return { serviceId: target.serviceId, name: target.name, pushed: ok, error, deployed: svcDeployed };
  });
  return { ...preview, applied: true, pushed: pushed.map((r) => r.name), failed, skippedConflicts: plan.conflicts.filter((n) => !overwrite.includes(n) || !names.includes(n)), deployed, otherServices };
}

module.exports = { pushProjectEnv };
