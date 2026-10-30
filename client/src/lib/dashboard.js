/* Overview page: pure helpers so what the dashboard claims is testable. Nothing here sees a password value. */

export function greeting(hour = new Date().getHours()) {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/**
 * What needs attention, most serious first. Every entry links to the view that fixes it.
 * `breachChecked` is false until a Have I Been Pwned check has run on this device.
 */
export function attentionItems(health = {}, { breachChecked = false } = {}) {
  const list = [];
  if (health.breached) list.push({ id: "breached", tone: "danger", title: plural(health.breached, "password") + " found in data breaches", hint: "Change these first.", to: "/passwords?filter=breached" });
  if (health.weak) list.push({ id: "weak", tone: "danger", title: plural(health.weak, "weak password"), hint: "Easy to guess. Replace with a generated one.", to: "/passwords?filter=weak" });
  if (health.reused) list.push({ id: "reused", tone: "warn", title: plural(health.reused, "reused password"), hint: "One leak would open every account that shares it.", to: "/passwords?filter=reused" });
  if (health.old) list.push({ id: "old", tone: "info", title: plural(health.old, "password") + " older than 6 months", hint: "Worth rotating for important accounts.", to: "/passwords?filter=old" });
  if (health.total && !breachChecked) list.push({ id: "check", tone: "neutral", title: "Breach check not run yet", hint: "Checks your passwords against Have I Been Pwned without sending them.", to: "/security-center" });
  return list;
}

/** Most recently changed live items. */
export const recentItems = (items = [], n = 5) =>
  [...items].sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)).slice(0, n);

/** Favourites, alphabetically. */
export const favoriteItems = (items = [], n = 6) =>
  items.filter((i) => i.favorite).sort((a, b) => (a.name || "").localeCompare(b.name || "")).slice(0, n);

/** Projects split by lifecycle, plus the most recently touched active ones. */
export function projectSummary(projects = [], n = 4) {
  const active = projects.filter((p) => p.status !== "archived");
  return {
    total: projects.length,
    active: active.length,
    deployed: projects.filter((p) => p.status === "deployed").length,
    broken: projects.filter((p) => p.status === "broken").length,
    recent: [...active].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)).slice(0, n),
  };
}

/** Short relative time: "just now", "5m ago", "3h ago", "2d ago", or a date. */
export function ago(when, now = Date.now()) {
  const t = new Date(when || 0).getTime();
  if (!t) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 14) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString();
}

const pad2 = (n) => String(Math.max(0, n | 0)).padStart(2, "0");

/**
 * Rows for the split-flap departures board on the overview, from real state only.
 * Status strings stay within 12 characters so they fit the flaps.
 */
export function boardRows({ health = {}, breachChecked = false, favorites = 0, proj = null }) {
  const rows = [];
  const total = health.total || 0;
  const vault = !total ? ["BOARDING", "idle"]
    : health.breached ? [`${health.breached} BREACHED`, "danger"]
    : health.weak ? [`${health.weak} WEAK`, "danger"]
    : health.reused ? [`${health.reused} REUSED`, "warn"]
    : ["ON TIME", "ok"];
  rows.push({ code: `VLT${pad2(total)}`, dest: "PASSWORDS", status: vault[0], tone: vault[1], to: "/passwords" });
  const score = health.score ?? 100;
  const sec = !total ? ["STANDBY", "idle"] : score >= 80 ? ["ON TIME", "ok"] : score >= 55 ? ["DELAYED", "warn"] : ["GATE CHECK", "danger"];
  rows.push({ code: `SEC${pad2(Math.min(99, score))}`, dest: "SECURITY SCORE", status: sec[0], tone: sec[1], to: "/security-center" });
  const breach = !total ? ["STANDBY", "idle"] : !breachChecked ? ["NOT CHECKED", "warn"] : health.breached ? [`${health.breached} FOUND`, "danger"] : ["CLEARED", "ok"];
  rows.push({ code: "HIBP", dest: "BREACH CHECK", status: breach[0], tone: breach[1], to: "/security-center" });
  rows.push({ code: `FAV${pad2(favorites)}`, dest: "FAVOURITES", status: favorites ? `${favorites} READY` : "NONE YET", tone: favorites ? "ok" : "idle", to: "/passwords?section=__fav" });
  if (proj) {
    const p = proj.broken ? [`${proj.broken} BROKEN`, "danger"] : proj.deployed ? [`${proj.deployed} LIVE`, "ok"] : proj.active ? ["IN HANGAR", "idle"] : ["BOARDING", "idle"];
    rows.push({ code: `PRJ${pad2(proj.active)}`, dest: "PROJECTS", status: p[0], tone: p[1], to: "/projects" });
  }
  return rows;
}
