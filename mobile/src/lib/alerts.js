/* Incident helpers for the in-app alert bell (same rule as the server: the newest event per key decides). */
const keyOf = (e) => [e.groupId, e.serviceKey, e.type].join(":");
const stamp = (e) => Date.parse(e.at || e.openedAt || 0) || 0;

export function openIncidents(events) {
  const latest = new Map();
  [...(events || [])].sort((a, b) => stamp(a) - stamp(b)).forEach((e) => latest.set(keyOf(e), e));
  return [...latest.values()].filter((e) => e.state === "open").sort((a, b) => stamp(b) - stamp(a));
}

/** Open incidents whose id is not in `seen` (a Set) - used to decide what is new since the last check. */
export const newIncidents = (open, seen) => open.filter((e) => !seen.has(e.id));
