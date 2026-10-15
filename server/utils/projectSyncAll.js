const User = require("../models/schema");
const { duplicateGroups, pickPrimary, mergeProjects } = require("./projectMerge");
const { autoSyncProjects } = require("./projectAutoSync");

/*
 * "Sync with Render": make the Projects page match every connected Render account.
 *   1. merge projects that are the same app (same GitHub repo)
 *   2. the automatic GitHub + Render sync (see projectAutoSync)
 * Reads Render and GitHub only; never changes anything on either.
 */

async function syncAllProjects(user) {
  const dataKey = await user.getDataKey();
  const summary = { merged: 0, created: [], conflicts: [], refreshed: 0, archived: 0, revived: 0 };

  /* 1. merge duplicates */
  const read = () => (user.projects || []).filter((e) => e.enc === "udk").map((e) => ({ entry: e, fields: User.publicEntry(e, dataKey) }));
  const groups = duplicateGroups(read().map(({ fields }) => fields)).filter((g) => !g.key.startsWith("name:"));
  for (const group of groups) {
    const projects = read().filter(({ fields }) => group.ids.includes(String(fields._id))).map(({ fields }) => fields);
    if (projects.length < 2) continue;
    const primary = pickPrimary(projects);
    const others = projects.filter((p) => p !== primary);
    const { fields, conflicts } = mergeProjects(primary, others);
    await User.updateOne({ _id: user._id, "projects._id": primary._id }, { $set: { "projects.$.enc": "udk", "projects.$.data": User.sealEntry(dataKey, fields), "projects.$.updatedAt": new Date() } });
    await User.updateOne({ _id: user._id }, { $pull: { projects: { _id: { $in: others.map((p) => p._id) } } } });
    summary.merged += others.length;
    if (conflicts.length) summary.conflicts.push({ name: fields.name, vars: conflicts });
  }

  /* 2. GitHub + Render: create what is missing, follow Render links, archive what is gone */
  const auto = await autoSyncProjects(user, { force: true });
  summary.created = auto.created; summary.refreshed = auto.refreshed; summary.archived = auto.archived; summary.revived = auto.revived;
  return summary;
}

module.exports = { syncAllProjects };
