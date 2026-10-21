/* Pure: rules for the branch manager. Nothing here talks to GitHub. */
const BRANCH_RE = /^(?!-)(?!.*\.\.)[A-Za-z0-9._\/-]{1,200}$/;
const MAX_DELETE = 50;

/** URL path segments for a branch name ("feature/x" -> "feature/x" with each part encoded). */
const branchPath = (name) => String(name).split("/").map(encodeURIComponent).join("/");

/**
 * Splits the requested branch names into those that may be deleted and those that may not.
 * The default branch is never deleted; a name that is not a valid branch is refused outright.
 * `live` is the set of branches a Render service or host site currently deploys: they are allowed, but flagged
 * so the UI can warn before anything is removed.
 */
function planBranchDeletes(names, { defaultBranch = "", live = [] } = {}) {
  const liveSet = new Set(live);
  const seen = new Set();
  const allowed = [];
  const refused = [];
  for (const raw of Array.isArray(names) ? names : []) {
    const name = typeof raw === "string" ? raw.trim() : "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    if (!BRANCH_RE.test(name)) refused.push({ name, reason: "Not a valid branch name." });
    else if (name === defaultBranch) refused.push({ name, reason: "This is the default branch and is never deleted here." });
    else allowed.push({ name, live: liveSet.has(name) });
  }
  return { allowed: allowed.slice(0, MAX_DELETE), refused: refused.concat(allowed.slice(MAX_DELETE).map((a) => ({ name: a.name, reason: "Delete at most " + MAX_DELETE + " branches at a time." }))) };
}

module.exports = { BRANCH_RE, MAX_DELETE, branchPath, planBranchDeletes };
