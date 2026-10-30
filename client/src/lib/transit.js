/* Transit City on the overview: turns real vault and project state into trains, buses,
   buildings and announcements. Never reads or returns a password value, only the
   per-item health info computed on the device. */

import { typeOf } from "./items.js";

const LINES = [
  ["login", "Logins", "L1"],
  ["note", "Notes", "N2"],
  ["card", "Cards", "C3"],
  ["identity", "IDs", "I4"],
];

/** ok | warn | danger | idle for one item, from computeHealth().info. */
export function carState(info) {
  if (!info) return "idle"; // notes, cards and identities have no password to judge
  if (info.breached || info.score <= 1) return "danger";
  if (info.reused || info.old) return "warn";
  return "ok";
}

/** One train per non-empty item type; each car is an item (capped so trains fit the track). */
export function trains(items = [], info = {}, maxCars = 8) {
  return LINES.map(([type, label, code]) => {
    const list = items.filter((i) => typeOf(i) === type);
    const cars = list.slice(0, maxCars).map((i) => ({ id: i.id, name: i.name || "Untitled", state: carState(info[i.id]) }));
    return { type, label, code, total: list.length, extra: Math.max(0, list.length - maxCars), cars };
  }).filter((t) => t.total > 0);
}

/** One building per item (capped), height from password strength; items without a password get a mid-rise. */
export function skyline(items = [], info = {}, max = 28) {
  return items.slice(0, max).map((i, n) => {
    const h = info[i.id];
    const score = h ? h.score : 2;
    return { id: i.id, height: 34 + score * 16 + ((n * 7) % 11), state: carState(h), lit: n % 3 !== 1 };
  });
}

const BUS = { deployed: "ok", broken: "danger", in_progress: "info", paused: "warn", planning: "idle" };

/** Buses for active projects. */
export function buses(projects = [], max = 4) {
  return projects.filter((p) => p.status !== "archived").slice(0, max).map((p, n) => ({
    id: p.id, name: p.name || "Project", route: String(n + 1).padStart(2, "0"), state: BUS[p.status] || "idle",
  }));
}

/** The newest item lands as the plane. */
export function arrival(items = []) {
  const last = [...items].sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))[0];
  return last ? { id: last.id, name: last.name || "Untitled" } : null;
}

/** Station announcements for the LED ticker. */
export function announcements({ items = [], health = {}, projects = [] }) {
  const t = trains(items, health.info || {});
  const lines = t.map((tr, i) => {
    const ok = tr.cars.filter((c) => c.state === "ok").length;
    const bad = tr.cars.filter((c) => c.state === "danger").length;
    return `Platform ${i + 1}: ${tr.label} express, ${tr.total} car${tr.total === 1 ? "" : "s"}` + (tr.type === "login" ? `, ${ok} verified${bad ? `, ${bad} held for checks` : ""}` : "");
  });
  if (health.reused) lines.push(`Attention: ${health.reused} passengers share one ticket. Please give each account its own password.`);
  const live = projects.filter((p) => p.status === "deployed").length;
  const broken = projects.filter((p) => p.status === "broken").length;
  if (projects.length) lines.push(`Bus depot: ${live} route${live === 1 ? "" : "s"} live${broken ? `, ${broken} broken down` : ""}.`);
  const a = arrival(items);
  if (a) lines.push(`Now landing: ${a.name}.`);
  if (!lines.length) lines.push("Welcome to Stashr Central. The first train leaves when you save your first login.");
  return lines;
}
