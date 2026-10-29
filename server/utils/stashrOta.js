/* After Stashr's main server URL has been written to an app's Render env, publish the app's OTA so installed phones
   get it too: save the URL as the repo's Actions variable STASHR_SERVER_URL (the workflows pass it to the build as
   EXPO_PUBLIC_STASHR_SERVER_URL), then start the repo's OTA workflow. Only repos listed here; needs a saved GitHub
   token that can write Actions variables and run workflows (classic: repo + workflow). */
const { parseGithubRepo } = require("./github");

const VARIABLE = "STASHR_SERVER_URL";
// repo ("owner/repo", lower case) -> OTA workflow file. Edit when an app is added or its workflow is renamed.
const OTA_WORKFLOWS = {
  "tanushh18/deal_radar": "eas-update.yml",
  "tanushh18/tasks": "publish-ota.yml"
};

const otaWorkflowFor = (repoUrl) => {
  const parsed = parseGithubRepo(repoUrl);
  return parsed ? OTA_WORKFLOWS[(parsed.owner + "/" + parsed.repo).toLowerCase()] || "" : "";
};

/** Returns { ok, message }. Never throws. `deps` lets tests replace the GitHub calls. */
async function publishOta(user, dataKey, repoUrl, mainUrl, deps = {}) {
  const workflow = otaWorkflowFor(repoUrl);
  if (!workflow) return { skipped: true };
  // Loaded here, not at the top, so the pure parts above can be used and tested without the database models.
  const client = deps.githubSend ? {} : require("./githubClient");
  const send = deps.githubSend || client.githubSend;
  const resolve = deps.resolveRepo || client.resolveRepo;
  try {
    const target = parseGithubRepo(repoUrl);
    const accounts = (deps.loadAccounts || client.loadGithubAccounts)(user, dataKey);
    if (!accounts.length) return { ok: false, message: "No GitHub connection saved." };
    const found = await resolve(accounts, target);
    if (found.error) return { ok: false, message: found.error.message || "GitHub access failed." };
    const token = found.used.token, base = found.base;
    const vars = base + "/actions/variables";
    let saved = await send(token, "PATCH", vars + "/" + VARIABLE, { name: VARIABLE, value: mainUrl });
    if (saved.status === 404) saved = await send(token, "POST", vars, { name: VARIABLE, value: mainUrl });
    if (!saved.ok) return { ok: false, message: "Could not save the repo variable (token needs repo access)." };
    const ref = (found.repo && found.repo.default_branch) || "main";
    const run = await send(token, "POST", base + "/actions/workflows/" + workflow + "/dispatches", { ref });
    if (!run.ok) return { ok: false, message: "Could not start " + workflow + " (token needs the workflow scope)." };
    return { ok: true, message: workflow + " started" };
  } catch { return { ok: false, message: "OTA publish failed." }; }
}

module.exports = { OTA_WORKFLOWS, VARIABLE, otaWorkflowFor, publishOta };
