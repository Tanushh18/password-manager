const mongoose = require("mongoose");
const User = require("../models/schema");
const { renderRequest } = require("./renderOps");
const { retargetService } = require("./projectServiceAccount");
const { repoKey } = require("./projectLink");

/*
 * Render-side helpers for a project: moving a server to another connected Render account, and finding the other
 * projects that deploy the same repository. Copying variables lives in utils/deployOps.js.
 */
const safeId = (value) => /^[A-Za-z0-9_-]{1,160}$/.test(String(value || ""));
const STRIP = ["_id", "createdAt", "updatedAt", "broken"];
const fail = (status, message) => Object.assign(new Error(message), { status });

async function loadProject(user, projectId) {
  if (!mongoose.isValidObjectId(projectId)) throw fail(404, "Could not find that project.");
  const dataKey = await user.getDataKey();
  const entry = (user.projects || []).find((item) => String(item._id) === String(projectId));
  if (!entry) throw fail(404, "Could not find that project.");
  const fields = User.publicEntry(entry, dataKey);
  if (fields.broken) throw fail(422, "This project could not be decrypted.");
  return { entry, dataKey, fields };
}

/** The apiKey of a connected Render account, or "" when it is gone. */
function accountKey(user, dataKey, accountId) {
  if (!mongoose.isValidObjectId(accountId)) return "";
  const entry = (user.renderAccounts || []).find((item) => String(item._id) === String(accountId) && item.enc === "udk");
  return entry ? User.publicEntry(entry, dataKey).apiKey || "" : "";
}

async function saveProject(user, entry, dataKey, fields, patch) {
  const now = new Date();
  const next = { ...fields, ...patch };
  STRIP.forEach((key) => delete next[key]);
  const sealed = User.sealEntry(dataKey, next);
  await User.updateOne({ _id: user._id, "projects._id": entry._id }, { $set: { "projects.$.enc": "udk", "projects.$.data": sealed, "projects.$.updatedAt": now } });
  entry.enc = "udk";
  entry.data = sealed;
}

/** Decrypted projects (other than `fields`) whose GitHub repo is the same repository. */
function projectsSharingRepo(projects, fields) {
  const key = repoKey(fields?.repoUrl);
  if (!key) return [];
  return (projects || []).filter((p) => p && !p.broken && p.id !== fields.id && repoKey(p.repoUrl) === key);
}

/** Moves a linked server to another connected Render account. The account must be able to see the service. */
async function moveServiceAccount(user, projectId, serviceId, accountId) {
  if (!safeId(serviceId)) throw fail(400, "Invalid service.");
  const { entry, dataKey, fields } = await loadProject(user, projectId);
  const apiKey = accountKey(user, dataKey, accountId);
  if (!apiKey) throw fail(404, "Choose a connected Render account.");
  let service;
  try { const raw = await renderRequest(apiKey, "/v1/services/" + encodeURIComponent(serviceId)); service = raw?.service || raw; }
  catch (error) { throw fail(error.status === 404 ? 422 : 502, error.status === 404 ? "That account cannot see this service." : "Could not check this service on Render."); }
  const patch = retargetService(fields, serviceId, String(accountId));
  if (!patch) throw fail(404, "This server is not linked to the project.");
  await saveProject(user, entry, dataKey, fields, patch);
  return { serviceId, accountId: String(accountId), name: String(service?.name || serviceId) };
}

module.exports = { moveServiceAccount, projectsSharingRepo };
