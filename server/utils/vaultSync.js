/*
 * Delta sync for the vault. A client that already holds the vault asks for what changed since its last sync:
 *   - `items` / `projects`: only entries written after `since` (these are the only ones decrypted), and
 *   - `itemIds` / `projectIds`: the ids that exist now, so the client can drop anything deleted elsewhere.
 * Sending ids instead of keeping delete tombstones means every delete path (including background syncs that
 * remove projects) is covered without extra bookkeeping.
 */
const SKEW_MS = 2000; // overlap so a write that landed during the previous response is never missed

const stamp = (entry) => Date.parse(entry.updatedAt || entry.createdAt || 0) || 0;

/** Parses the `since` query value; returns null when it is missing or not a usable time. */
function parseSince(value, now = Date.now()) {
  if (!value) return null;
  const ms = Date.parse(String(value));
  if (!Number.isFinite(ms) || ms <= 0 || ms > now + 60000) return null;
  return Math.max(0, ms - SKEW_MS);
}

/**
 * `entries` are the stored documents, `toPublic` decrypts one. Returns the changed ones plus every current id.
 * With `sinceMs === null` every entry counts as changed (a full load).
 */
function diffEntries(entries, sinceMs, toPublic) {
  const list = entries || [];
  return {
    changed: list.filter((e) => sinceMs === null || stamp(e) > sinceMs).map(toPublic),
    ids: list.map((e) => String(e._id)),
  };
}

function buildChanges(user, sinceMs, toPublic, now = Date.now()) {
  const items = diffEntries(user.passwords, sinceMs, toPublic);
  const projects = diffEntries(user.projects, sinceMs, toPublic);
  return {
    serverTime: new Date(now).toISOString(),
    full: sinceMs === null,
    items: items.changed,
    projects: projects.changed,
    itemIds: items.ids,
    projectIds: projects.ids,
  };
}

module.exports = { parseSince, diffEntries, buildChanges, SKEW_MS };
