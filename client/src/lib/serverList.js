/* Pure edits to one app's ordered server URL list. The first URL is the primary; the rest are backups. */

export function normalizeUrl(raw) {
  return String(raw || "").trim().replace(/\/+$/, "");
}

/** Validate and append a URL. Returns { urls, error? }; the list is unchanged on error. */
export function addUrl(urls, raw) {
  const url = normalizeUrl(raw);
  if (!url) return { urls, error: "Enter a server address." };
  if (!/^https:\/\//i.test(url)) return { urls, error: "Use a full https:// address." };
  try { new URL(url); } catch { return { urls, error: "That is not a valid address." }; }
  if (urls.some((u) => u.toLowerCase() === url.toLowerCase())) return { urls, error: "That URL is already in the list." };
  return { urls: [...urls, url] };
}

/** Move the item at `index` by `by` positions. Out-of-range moves return the same list. */
export function moveUrl(urls, index, by) {
  const to = index + by;
  if (index < 0 || index >= urls.length || to < 0 || to >= urls.length) return urls;
  const next = [...urls];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** Put the item at `index` first; the previous order of the rest is kept. */
export function setPrimary(urls, index) {
  if (index <= 0 || index >= urls.length) return urls;
  const next = [...urls];
  const [chosen] = next.splice(index, 1);
  return [chosen, ...next];
}

export function isDirty(draft, saved) {
  return draft.length !== saved.length || draft.some((u, i) => u !== saved[i]);
}

/** Short description of what saving would change, for the unsaved-changes bar. */
export function describeChanges(draft, saved) {
  const added = draft.filter((u) => !saved.includes(u)).length;
  const removed = saved.filter((u) => !draft.includes(u)).length;
  const primaryChanged = draft.length > 0 && saved.length > 0 && draft[0] !== saved[0];
  const parts = [];
  if (added) parts.push(`${added} added`);
  if (removed) parts.push(`${removed} removed`);
  if (primaryChanged) parts.push("primary changed");
  if (!parts.length && isDirty(draft, saved)) parts.push("order changed");
  return parts.join(" · ");
}
