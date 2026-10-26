/*
 * In-process pub/sub for live sync: each open /vault/events stream registers here, and vault writes call notify().
 * One instance only (a second server instance would not see the other's writes; clients still poll as a fallback).
 */
const MAX_STREAMS_PER_USER = 5;
const streams = new Map(); // userId -> Set<res>

function subscribe(userId, res) {
  const key = String(userId);
  let set = streams.get(key);
  if (!set) { set = new Set(); streams.set(key, set); }
  if (set.size >= MAX_STREAMS_PER_USER) {
    const oldest = set.values().next().value;
    try { oldest.end(); } catch (e) { /* already closed */ }
    set.delete(oldest);
  }
  set.add(res);
  return () => {
    set.delete(res);
    if (!set.size) streams.delete(key);
  };
}

/** Tells every open stream of this account that something changed. `source` lets a client ignore its own writes. */
function notify(userId, type = "vault", source = "") {
  const set = streams.get(String(userId));
  if (!set) return 0;
  const line = `event: change\ndata: ${JSON.stringify({ type, source, at: Date.now() })}\n\n`;
  let sent = 0;
  for (const res of set) {
    try { res.write(line); sent += 1; } catch (e) { set.delete(res); }
  }
  return sent;
}

const count = (userId) => (streams.get(String(userId)) || new Set()).size;

module.exports = { subscribe, notify, count, MAX_STREAMS_PER_USER };
