/* Pure: deploying the client of a monorepo (e.g. "client/") to a host that has no root-directory setting. */
const FOLDER_RE = /^(?!\/)(?!.*(^|\/)\.\.?(\/|$))(?!.*\/\/)[A-Za-z0-9._\/-]{1,200}$/;

/**
 * Returns { buildCommand, outputDir } with the folder applied: the build runs inside it and the output is read
 * from it. Blank input passes through unchanged. Returns { error } for a folder that could escape the repo.
 */
function applyClientFolder({ folder = "", buildCommand = "", outputDir = "" } = {}) {
  const dir = String(folder || "").trim().replace(/\/+$/, "");
  if (!dir) return { buildCommand, outputDir };
  if (!FOLDER_RE.test(dir)) return { error: "The client folder must be a path inside the repository, such as client." };
  const build = "cd " + dir + " && " + (buildCommand || "npm install && npm run build");
  const out = outputDir
    ? (outputDir === dir || outputDir.startsWith(dir + "/") ? outputDir : dir + "/" + outputDir.replace(/^\/+/, ""))
    : dir + "/dist";
  return { buildCommand: build, outputDir: out };
}

module.exports = { applyClientFolder };
