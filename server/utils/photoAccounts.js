/*
 * One Google account can end up with several connection entries: reconnecting used to add a new entry each time.
 * Entries are matched by email. The entry with the most files and imports linked to it is kept; the others are folded
 * into it: their indexed files and import links are moved onto the kept entry, then the extra entries are removed.
 * Nothing in Google Drive is touched.
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

/** Per account with more than one entry: the kept entry and the extra ones. */
function accountGroups(connections, linked) {
  const byEmail = new Map();
  for (const connection of connections) {
    const email = normEmail(connection.email);
    if (email) byEmail.set(email, [...(byEmail.get(email) || []), connection]);
  }
  const groups = [];
  for (const group of byEmail.values()) {
    if (group.length < 2) continue;
    const keep = pickPrimary(group, linked);
    groups.push({ keep, others: group.filter((connection) => connection !== keep) });
  }
  return groups;
}

/** Extra entries with nothing linked to them (safe to drop without moving anything). */
function duplicatesToRemove(connections, linked) {
  return accountGroups(connections, linked).flatMap((g) => g.others.filter((connection) => !linked.get(connection.id)));
}

/**
 * Folds extra entries into the kept one, in memory. Files indexed under an extra entry are re-pointed at the kept entry
 * (their ids follow the same `connectionId:fileId` pattern the Drive index uses); a file already present is kept once.
 */
function mergeAccounts(connections, media = [], batches = []) {
  const linked = linkCounts(media, batches);
  const into = new Map();
  for (const { keep, others } of accountGroups(connections, linked)) for (const other of others) into.set(other.id, keep.id);
  const target = (id) => into.get(id) || id;

  const seen = new Set();
  const merged = [];
  const moved = (item) => target(item.sourceConnectionId) !== item.sourceConnectionId;
  // Entries that already belong to the kept account come first, so they win over moved duplicates.
  for (const item of [...media].sort((a, b) => Number(moved(a)) - Number(moved(b)))) {
    const next = moved(item) ? { ...item, sourceConnectionId: target(item.sourceConnectionId), id: item.providerFileId ? `${target(item.sourceConnectionId)}:${item.providerFileId}` : item.id } : item;
    if (seen.has(next.id)) continue;
    seen.add(next.id);
    merged.push(next);
  }

  return {
    connections: connections.filter((connection) => !into.has(connection.id)),
    removable: [...into.keys()].map((id) => connections.find((connection) => connection.id === id)),
    media: merged,
    into,
    target,
  };
}

module.exports = { normEmail, linkCounts, pickPrimary, duplicatesToRemove, mergeAccounts };
