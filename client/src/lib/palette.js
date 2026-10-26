/* Command palette: builds the list of jump targets and ranks them against a query. */

export function buildEntries({ items = [], projects = [], profile = null, signedIn = true }) {
  if (!signedIn) return [];
  const features = profile?.features || {};
  const pages = [
    { label: "Passwords", to: "/passwords" },
    { label: "Projects", to: "/projects" },
    { label: "New project", to: "/projects/new" },
    { label: "Services", to: "/services" },
    { label: "Render", to: "/render" },
    { label: "Cron", to: "/cron" },
    { label: "Settings", to: "/settings" },
    ...(features.photos ? [{ label: "Photo Cloud", to: "/photos" }] : []),
    ...(profile?.isAdmin ? [{ label: "Servers", to: "/servers" }, { label: "Security", to: "/security" }] : []),
  ].map((p) => ({ ...p, kind: "Page", hint: p.to }));
  const vault = items.map((i) => ({
    kind: "Item", label: i.name || "Untitled", hint: i.username || i.url || "",
    to: "/passwords?q=" + encodeURIComponent(i.name || i.username || ""),
    haystack: [i.name, i.username, i.url, i.folder].filter(Boolean).join(" ").toLowerCase(),
  }));
  const projs = projects.map((p) => ({ kind: "Project", label: p.name || "Untitled", hint: "Project", to: "/projects/" + p.id }));
  return [...pages, ...projs, ...vault];
}

/* Prefix matches rank above substring matches; every query word must appear somewhere. */
export function rank(entries, query, limit = 12) {
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return entries.filter((e) => e.kind === "Page").slice(0, limit);
  const scored = [];
  for (const e of entries) {
    const text = (e.haystack || (e.label + " " + (e.hint || ""))).toLowerCase();
    if (!words.every((w) => text.includes(w))) continue;
    const label = e.label.toLowerCase();
    const score = words.reduce((s, w) => s + (label.startsWith(w) ? 3 : label.includes(w) ? 2 : 1), 0);
    scored.push({ e, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.e.label.localeCompare(b.e.label)).slice(0, limit).map((x) => x.e);
}
