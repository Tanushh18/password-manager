import { domainOf, typeOf } from "./items.js";

/* Built-in vault sections. Anything else is a folder name. */
export const SECTIONS = {
  all: "__all", // every live item
  logins: "__logins",
  fav: "__fav",
  note: "__note",
  card: "__card",
  identity: "__identity",
  trash: "__trash",
};

const TYPE_SECTIONS = { __logins: "login", __note: "note", __card: "card", __identity: "identity" };

export const isBuiltinSection = (s) => typeof s === "string" && s.startsWith("__");

/** Does an item belong in `section`? Trash is handled by the caller (different list). */
export function inSection(item, section) {
  if (section === SECTIONS.all || section === SECTIONS.trash) return true;
  if (section === SECTIONS.fav) return Boolean(item.favorite);
  if (TYPE_SECTIONS[section]) return typeOf(item) === TYPE_SECTIONS[section];
  return item.folder === section;
}

export function matchesSearch(item, term) {
  const t = (term || "").trim().toLowerCase();
  if (!t) return true;
  return [item.name, item.username, item.url, item.folder, item.notes].some((v) => (v || "").toLowerCase().includes(t)) || domainOf(item.url).includes(t);
}

export function matchesHealth(info, filter) {
  if (!filter || filter === "all") return true;
  if (!info) return false;
  if (filter === "weak") return info.score <= 1;
  if (filter === "reused") return info.reused;
  if (filter === "old") return info.old;
  if (filter === "breached") return info.breached > 0;
  if (filter === "strong") return info.score >= 3 && !info.reused && !info.breached;
  return true;
}

/** The list shown for the current section, search, health filter and sort. */
export function visibleItems({ items = [], trash = [], section = SECTIONS.all, search = "", filter = "all", sort = "recent", info = {} }) {
  return (section === SECTIONS.trash ? trash : items)
    .filter((i) => inSection(i, section))
    .filter((i) => matchesSearch(i, search))
    .filter((i) => matchesHealth(info[i.id], filter))
    .sort((a, b) => {
      if (a.favorite !== b.favorite && sort !== "az") return a.favorite ? -1 : 1;
      if (sort === "az") return (a.name || "").localeCompare(b.name || "");
      if (sort === "weakest") return (info[a.id]?.score ?? 5) - (info[b.id]?.score ?? 5);
      return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
    });
}

/** Item counts for every sidebar entry. */
export function sectionCounts(items = [], trash = []) {
  const counts = { __all: items.length, __logins: 0, __fav: 0, __note: 0, __card: 0, __identity: 0, __trash: trash.length, folders: {} };
  items.forEach((i) => {
    counts["__" + (typeOf(i) === "login" ? "logins" : typeOf(i))] += 1;
    if (i.favorite) counts.__fav += 1;
    if (i.folder) counts.folders[i.folder] = (counts.folders[i.folder] || 0) + 1;
  });
  return counts;
}

/** Sorted folder names. */
export const folderNames = (items = []) => [...new Set(items.map((i) => i.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b));

/** A short, honest status line from computed health. */
export function securityStatus(health, breachChecked = false) {
  const h = health || {};
  if (!h.total) return { tone: "idle", label: "No passwords yet" };
  if (h.breached) return { tone: "danger", label: `${h.breached} breached` };
  if (h.weak || (h.score ?? 100) < 45) return { tone: "danger", label: `${h.weak} weak` };
  if (h.reused) return { tone: "warn", label: `${h.reused} reused` };
  if ((h.score ?? 0) < 70) return { tone: "warn", label: "Needs care" };
  return { tone: "ok", label: breachChecked ? "All clear" : "Healthy" };
}
