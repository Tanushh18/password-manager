/* Pure helpers for the incident log. Events are appended (open, later resolved); the newest event per
   (group, service, type) decides whether an incident is still open. No I/O. */
const keyOf = (e) => [e.groupId, e.serviceKey, e.type].join(":");
const stamp = (e) => Date.parse(e.at || e.openedAt || 0) || 0;

/** Events that are the newest for their key and still "open". */
function openEvents(events) {
  const latest = new Map();
  [...(events || [])].sort((a, b) => stamp(a) - stamp(b)).forEach((e) => latest.set(keyOf(e), e));
  return [...latest.values()].filter((e) => e.state === "open");
}

/**
 * Open incidents that can never resolve on their own: the monitoring group was removed, the service left the
 * group, or its Render account is no longer connected. `groups` = [{ id, serviceKeys }], `accountIds` = Set.
 */
function orphanedOpen(events, groups, accountIds) {
  const byId = new Map((groups || []).map((g) => [g.id, new Set(g.serviceKeys || [])]));
  return openEvents(events).filter((e) => {
    const members = byId.get(e.groupId);
    if (!members) return true;
    if (e.serviceKey === "group-budget") return false;
    if (!members.has(e.serviceKey)) return true;
    return !accountIds.has(String(e.serviceKey).split(":")[0]);
  });
}

/** A resolved event that closes `open` (same key, so it supersedes it). */
function closingEvent(open, { id, message, by, at }) {
  return {
    id, groupId: open.groupId, groupName: open.groupName, serviceKey: open.serviceKey, serviceName: open.serviceName,
    type: open.type, severity: open.severity || "warning", state: "resolved", message,
    openedAt: open.openedAt || open.at, at, resolvedBy: by
  };
}

module.exports = { openEvents, orphanedOpen, closingEvent };
