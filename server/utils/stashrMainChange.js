/* When Stashr's main server list is saved, two things follow the new main URL:
   1. Stashr's own frontend (the stashr-client static site) is rebuilt with the whole list in VITE_API_URLS, main first,
      so it reaches the new server before the old one is deleted.
   2. Every project whose Server URLs still list the old Stashr address gets the new one, and the public registry that
      project feeds is published again. Nothing is deleted. */
const User = require("../models/schema");
const renderOps = require("./renderOps");
const { repoKey } = require("./projectLink");
const { swapServerUrl } = require("./serverUrlsSync");
const { publishToRegistry } = require("./projectServers");
const { saveProjectFields } = require("./moveServer");
const P = require("./stashrPropagation");

const STASHR_REPO = "tanushh18/password-manager";
const FRONTEND_SERVICE = "stashr-client";
const FRONTEND_VAR = "VITE_API_URLS";

/** The value the frontend is built with: every URL, main first, comma separated. Pure. */
function frontendValue(urls) {
  return (urls || []).map((u) => String(u || "").trim().replace(/\/+$/, "")).filter(Boolean).join(",");
}

/** The stashr-client service of the Stashr project, or none for any other project. Pure. */
function frontendTargets(fields) {
  if (repoKey(fields.repoUrl) !== STASHR_REPO) return [];
  return P.targetsOf(fields).filter((t) => t.name === FRONTEND_SERVICE);
}

function fieldsOf(entry, dataKey) {
  try {
    const fields = User.publicEntry(entry, dataKey);
    return fields && !fields.broken ? fields : null;
  } catch {
    return null;
  }
}

/** Writes VITE_API_URLS to the Stashr frontend and deploys it, so the build picks up the new list. */
async function updateFrontend(user, dataKey, urls) {
  const byService = new Map();
  for (const entry of user.projects || []) {
    const fields = fieldsOf(entry, dataKey);
    if (!fields) continue;
    for (const target of frontendTargets(fields)) byService.set(target.serviceId, target);
  }
  const targets = [...byService.values()];
  if (!targets.length) return { ok: false, error: "No " + FRONTEND_SERVICE + " service is linked to the Stashr project." };
  const results = await P.applyToTargets(targets, frontendValue(urls), {
    request: renderOps.renderRequest,
    apiKeyFor: (accountId) => renderOps.accountApiKey(user, dataKey, accountId),
    names: [FRONTEND_VAR],
    exact: true
  });
  return {
    ok: P.projectApplied(results),
    services: results.map(({ name, ok, deployed, error }) => ({ name, ok, deployed: Boolean(deployed), error: error || "" }))
  };
}

/** Moves each project's Server URLs (and its registry) from the old Stashr address to the new one. */
async function followProjects(user, dataKey, oldUrl, newUrl) {
  let updated = 0;
  for (const entry of user.projects || []) {
    const fields = fieldsOf(entry, dataKey);
    if (!fields) continue;
    const swapped = swapServerUrl(fields.serverUrls, oldUrl, newUrl);
    if (!swapped.changed) continue;
    const next = await saveProjectFields(user, entry, dataKey, { ...fields, serverUrls: swapped.list });
    if (next.registryApp) await publishToRegistry(next.registryApp, swapped.list, user);
    updated += 1;
  }
  return updated;
}

/** Runs after the Stashr server list is saved. Never throws: the list is already saved, so each part reports its own error. */
async function onStashrListSaved(user, { oldMain, urls }) {
  const dataKey = await user.getDataKey();
  const newMain = (urls || [])[0] || "";
  const result = { frontend: null, projectsUpdated: 0 };
  try {
    result.frontend = await updateFrontend(user, dataKey, urls);
  } catch {
    result.frontend = { ok: false, error: "Could not update the Stashr frontend. Save the list again to retry." };
  }
  if (oldMain && newMain && oldMain !== newMain) {
    try {
      result.projectsUpdated = await followProjects(user, dataKey, oldMain, newMain);
    } catch {
      result.projectsError = "Some projects still list the old Stashr address. Save the list again to retry.";
    }
  }
  return result;
}

module.exports = { frontendValue, frontendTargets, onStashrListSaved };
