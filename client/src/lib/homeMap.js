/**
 * Draws the house map as plain SVG shapes. Pure (no React, no DOM), so the same maths is tested and can be rendered anywhere.
 * `shapes(map, mode)` takes what GET /home/map returns and gives { width, height, items } for mode "2d" (a floor diagram) or
 * "3d" (the same blocks pushed up into an isometric view). Nothing here is to scale: it is a diagram of zones, not a floor plan.
 */
const S2 = 120;                 // pixels per grid unit in 2D
const S3 = 84;                  // in 3D
const COS = Math.cos(Math.PI / 6), SIN = 0.5;
const PAD = 28;
const BLOCK_H = 0.55;           // how tall a zone block is in 3D (grid units)

/** Grid position (x, y, height z) -> isometric pixel position. */
export const iso = (x, y, z = 0, s = S3) => ({ x: (x - y) * COS * s, y: (x + y) * SIN * s - z * s });

const pts = (list) => list.map((p) => `${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`).join(" ");

function extent(blocks) {
  if (!blocks.length) return { w: 2, h: 2 };
  return { w: Math.max(...blocks.map((b) => b.x + b.w)), h: Math.max(...blocks.map((b) => b.y + b.h)) };
}

/** What sits in a block, as little markers: the tablet, devices (green = on the Wi-Fi now), people. */
function markers(b) {
  const out = [];
  if (b.hub) out.push({ kind: "hub", label: "Tablet" });
  for (const d of b.devices || []) out.push({ kind: d.up ? "device-up" : "device-down", label: d.label });
  for (const p of b.people || []) out.push({ kind: "person", label: p.person });
  return out;
}

export function shapes(map, mode = "2d", withPlan = true) {
  const blocks = (map && map.zones) || [];
  const ex = extent(blocks);
  const items = [];
  if (mode === "2d") {
    const width = ex.w * S2 + PAD * 2, height = ex.h * S2 + PAD * 2;
    if (withPlan && map && map.plan) items.push({ type: "plan", href: map.plan, x: PAD, y: PAD, w: ex.w * S2, h: ex.h * S2 });
    for (const b of blocks) {
      const x = PAD + b.x * S2, y = PAD + b.y * S2, w = b.w * S2, h = b.h * S2;
      items.push({ type: "rect", id: b.id, x, y, w, h, cls: b.labelOnly ? "label" : "zone", plan: Boolean(map.plan) });
      items.push({ type: "text", x: x + 10, y: y + 20, text: b.name, cls: "title" });
      if (b.hint && b.auto) items.push({ type: "text", x: x + 10, y: y + 36, text: b.hint, cls: "hint" });
      markers(b).forEach((m, i) => items.push({ type: "dot", x: x + 22 + (i % 5) * 34, y: y + h - 38 - Math.floor(i / 5) * 34, r: 11, kind: m.kind, label: m.label }));
    }
    return { width, height, items };
  }
  // 3D: faces back to front so nearer blocks cover farther ones
  const ordered = [...blocks].sort((a, b) => (a.x + a.y) - (b.x + b.y));
  const corners = (b, z) => ({ n: iso(b.x, b.y, z), e: iso(b.x + b.w, b.y, z), s: iso(b.x + b.w, b.y + b.h, z), w: iso(b.x, b.y + b.h, z) });
  const all = [];
  for (const b of ordered) { const t = corners(b, BLOCK_H), g = corners(b, 0); all.push(t.n, t.e, t.s, t.w, g.s, g.w, g.e); }
  const minX = Math.min(...all.map((p) => p.x), 0), minY = Math.min(...all.map((p) => p.y), 0), maxX = Math.max(...all.map((p) => p.x), 1), maxY = Math.max(...all.map((p) => p.y), 1);
  const ox = PAD - minX, oy = PAD + 18 - minY;
  const mv = (p) => ({ x: p.x + ox, y: p.y + oy });
  for (const b of ordered) {
    const t = corners(b, BLOCK_H), g = corners(b, 0), cls = b.labelOnly ? "label" : "zone";
    items.push({ type: "poly", cls: cls + "-left", points: pts([t.w, t.s, g.s, g.w].map(mv)), id: b.id });
    items.push({ type: "poly", cls: cls + "-right", points: pts([t.s, t.e, g.e, g.s].map(mv)), id: b.id });
    items.push({ type: "poly", cls: cls + "-top", points: pts([t.n, t.e, t.s, t.w].map(mv)), id: b.id });
    const c = mv(iso(b.x + b.w / 2, b.y + b.h / 2, BLOCK_H));
    items.push({ type: "text", x: c.x, y: c.y - 12, text: b.name, cls: "title-c" });
    markers(b).forEach((m, i, arr) => { const p = mv(iso(b.x + 0.35 + (i % 4) * 0.42, b.y + 1.45 + Math.floor(i / 4) * 0.34, BLOCK_H + 0.12)); items.push({ type: "dot", x: p.x, y: p.y, r: 9, kind: m.kind, label: m.label, last: i === arr.length - 1 }); });
  }
  return { width: Math.ceil(maxX - minX + PAD * 2), height: Math.ceil(maxY - minY + PAD * 2 + 36), items };
}

/** The "away" people as a line of text under the map. */
export function awayLine(map) {
  const a = (map && map.away) || [];
  return a.length ? `Bahar: ${a.map((p) => p.person + (p.distanceKm != null ? ` (${p.distanceKm} km)` : "")).join(", ")}` : "";
}
