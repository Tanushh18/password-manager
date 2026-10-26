/* Helpers for delta sync and the live event stream. Pure, so they are unit tested. */

/**
 * Applies a /vault/changes answer to a local list.
 * `changed` are fresh entries from the server, `ids` is every id that exists there now, `make` turns an entry into a list item.
 * Returns the same array when nothing changed so React does not re-render.
 */
export function mergeDelta(list, changed, ids, make) {
  const alive = new Set((ids || []).map(String));
  const fresh = new Map((changed || []).map((e) => [String(e._id), e]));
  let touched = false;
  const kept = [];
  for (const item of list) {
    if (!alive.has(String(item.id))) { touched = true; continue; } // deleted somewhere else
    const entry = fresh.get(String(item.id));
    if (entry) {
      fresh.delete(String(item.id));
      if (String(entry.updatedAt) !== String(item.updatedAt)) { kept.push(make(entry)); touched = true; } else kept.push(item);
    } else kept.push(item);
  }
  const added = [...fresh.values()].map(make);
  if (added.length) touched = true;
  return touched ? [...added, ...kept] : list;
}

/**
 * Incremental parser for a Server-Sent Events stream. Feed it text chunks; it calls onEvent({ event, data })
 * for each complete event and ignores comment lines (": ping").
 */
export function createSseParser(onEvent) {
  let buffer = "";
  return (chunk) => {
    buffer += chunk.replace(/\r\n/g, "\n");
    let at;
    while ((at = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      let event = "message";
      const data = [];
      for (const line of block.split("\n")) {
        if (!line || line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
      }
      if (data.length || event !== "message") onEvent({ event, data: data.join("\n") });
    }
  };
}

/** Wait before reconnecting the event stream: 2s, 4s, 8s ... capped at 60s. */
export const reconnectDelay = (attempt) => Math.min(60000, 2000 * 2 ** Math.min(attempt, 5));
