/* Pure: choose which connected Google account receives a new upload. */
const GB = 1024 ** 3;

/**
 * connections: decoded connections ({ id, status, eligible, priority, usedGb, limitGb })
 * Skips ineligible, disconnected and excluded accounts. A known limit must leave `bufferGb` free after the upload;
 * an unknown limit is treated as unknown, not unlimited: such accounts rank after accounts known to have room.
 * The default account (if any) is tried first, then by priority.
 */
function pickDestination(connections, sizeBytes, { bufferGb = 2, defaultId = "", excludeIds = [] } = {}) {
  const need = Math.max(0, Number(sizeBytes) || 0) / GB;
  const usable = (connections || []).filter((c) => c && c.status === "connected" && c.eligible !== false && !excludeIds.includes(c.id) && c.accessToken);
  const room = (c) => (c.limitGb == null ? null : Number(c.limitGb) - Number(c.usedGb || 0) - bufferGb - need);
  const known = usable.filter((c) => room(c) !== null && room(c) >= 0);
  const unknown = usable.filter((c) => room(c) === null);
  const order = (list) => [...list].sort((a, b) => (a.id === defaultId ? -1 : b.id === defaultId ? 1 : 0) || (Number(a.priority) || 99) - (Number(b.priority) || 99));
  return order(known)[0] || order(unknown)[0] || null;
}

const round = (n) => Math.round(n * 10) / 10;

/** Combined storage across connected accounts. Accounts that report no limit are counted separately, never as unlimited. */
function storageTotals(connections) {
  const list = (connections || []).filter((c) => c && c.status === "connected");
  const known = list.filter((c) => c.limitGb != null);
  const usedGb = list.reduce((n, c) => n + Number(c.usedGb || 0), 0);
  const limitGb = known.reduce((n, c) => n + Number(c.limitGb), 0);
  const knownUsed = known.reduce((n, c) => n + Number(c.usedGb || 0), 0);
  return { accounts: list.length, usedGb: round(usedGb), limitGb: round(limitGb), freeGb: round(Math.max(0, limitGb - knownUsed)), unknownLimit: list.length - known.length };
}

/**
 * Which account the next uploads should go to, with a plain-language reason.
 * Picks the eligible account with the most free space; the current default is kept unless it is nearly full.
 */
function suggestAccount(connections, { bufferGb = 2, defaultId = "" } = {}) {
  const usable = (connections || []).filter((c) => c && c.status === "connected" && c.eligible !== false && c.accessToken !== "");
  const free = (c) => (c.limitGb == null ? null : Math.max(0, Number(c.limitGb) - Number(c.usedGb || 0)));
  const withRoom = usable.filter((c) => free(c) !== null && free(c) > bufferGb).sort((a, b) => free(b) - free(a));
  if (!usable.length) return { none: true, reason: "No account is available for uploads. Connect one or allow uploads on a paused account." };
  if (!withRoom.length) {
    const unknown = usable.find((c) => c.limitGb == null);
    if (unknown) return { accountId: unknown.id, label: unknown.label, freeGb: null, reason: "Google did not report this account's space, so it is used cautiously." };
    return { none: true, reason: "Every connected account is full or within the safety margin. Connect another account to keep backing up." };
  }
  const def = usable.find((c) => c.id === defaultId);
  const best = withRoom[0];
  const keep = def && withRoom.includes(def) && (free(def) >= 0.15 * Number(def.limitGb) || free(def) >= free(best));
  const pick = keep ? def : best;
  const reason = keep && def !== best ? `Your default account, ${round(free(pick))} GB free.` : !keep && def ? `${def.label} is nearly full. ${pick.label} has the most space (${round(free(pick))} GB free).` : `${round(free(pick))} GB free, the most of your accounts.`;
  return { accountId: pick.id, label: pick.label, freeGb: round(free(pick)), reason };
}

module.exports = { pickDestination, storageTotals, suggestAccount };
