/*
 * One Google account can end up with several connection entries: reconnecting used to add a new entry each time.
 * Entries are matched by email. The one with the most files and imports linked to it is the one that is kept;
 * an extra entry with nothing linked to it can be removed.
 */
const normEmail = (value) => String(value || "").trim().toLowerCase();

/** How many media items and import batches point at each connection id. */
function linkCounts(media = [], batches = []) {
  const counts = new Map();
  const add = (id) => { if (id) counts.set(id, (counts.get(id) || 0) + 1); };
  media.forEach((item) => add(item.sourceConnectionId));
  batches.forEach((batch) => { add(batch.sourceConnectionId); (batch.destinationIds || []).forEach(add); });
  return counts;
}

const rank = (connection, linked) => (linked.get(connection.id) || 0) * 1000 + (connection.oauthMode === "connected" ? 100 : 0) + (connection.status === "connected" ? 10 : 0) + (connection.accessToken ? 1 : 0);

/** The entry to keep among entries for the same account. */
function pickPrimary(connections, linked) {
  return [...connections].sort((a, b) => rank(b, linked) - rank(a, linked))[0] || null;
}

/** Entries that repeat an account already kept and have nothing linked to them. */
function duplicatesToRemove(connections, linked) {
  const byEmail = new Map();
  for (const connection of connections) {
    const email = normEmail(connection.email);
    if (email) byEmail.set(email, [...(byEmail.get(email) || []), connection]);
  }
  const removable = [];
  for (const group of byEmail.values()) {
    if (group.length < 2) continue;
    const keep = pickPrimary(group, linked);
    for (const connection of group) if (connection !== keep && !linked.get(connection.id)) removable.push(connection);
  }
  return removable;
}

module.exports = { normEmail, linkCounts, pickPrimary, duplicatesToRemove };
