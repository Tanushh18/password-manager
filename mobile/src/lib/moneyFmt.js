/* Pure helpers for the Money screens. */

/** 1234567.5 -> "₹12,34,567.5" (Indian grouping, no Intl needed). */
export function inr(n, { sign = false } = {}) {
  const v = Number(n) || 0;
  const neg = v < 0;
  const [whole, frac] = Math.abs(v).toFixed(2).split(".");
  let g = whole.length > 3 ? whole.slice(-3) : whole;
  let rest = whole.length > 3 ? whole.slice(0, -3) : "";
  while (rest.length > 2) { g = rest.slice(-2) + "," + g; rest = rest.slice(0, -2); }
  if (rest) g = rest + "," + g;
  const f = frac === "00" ? "" : "." + frac.replace(/0$/, "");
  return `${neg ? "−" : sign ? "+" : ""}₹${g}${f}`;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (m) => { const [y, mo] = String(m || "").split("-"); return MON[Number(mo) - 1] ? `${MON[Number(mo) - 1]} ${y}` : String(m || ""); };
export const dayLabel = (d) => { const [y, mo, da] = String(d || "").split("-"); return MON[Number(mo) - 1] ? `${Number(da)} ${MON[Number(mo) - 1]} ${y}` : String(d || ""); };

/** Months at the top of the month switcher: the server's list, plus the one being looked at. */
export const monthList = (months, current) => [...new Set([...(months || []), current].filter(Boolean))].sort().reverse();

/** Rows -> [{ date, total (debits that day), rows }] newest day first, newest time first inside a day. Doubtful rows are not counted. */
export function groupByDay(rows) {
  const by = new Map();
  for (const t of rows || []) {
    const g = by.get(t.date) || { date: t.date, total: 0, rows: [] };
    g.rows.push(t);
    if (t.type === "Debit" && t.status !== "Flagged") g.total += t.amount;
    by.set(t.date, g);
  }
  return [...by.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).map((g) => ({ ...g, total: Math.round(g.total * 100) / 100, rows: g.rows.sort((a, b) => String(b.time).localeCompare(String(a.time))) }));
}

export const sharePct = (amount, total) => (total > 0 ? Math.round((amount / total) * 100) : 0);

/** "2026-10-21" N months back from today (first day of that month for 0), in IST. */
export function startChoice(kind, now = Date.now()) {
  const ist = new Date(now + 5.5 * 3600 * 1000);
  const y = ist.getUTCFullYear(), m = ist.getUTCMonth(), d = ist.getUTCDate();
  const back = { month: 0, m3: 3, m6: 6, y1: 12 }[kind];
  if (back === undefined) return "";
  const t = new Date(Date.UTC(y, m - back, back === 0 ? 1 : Math.min(d, 28)));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
export const validYmd = (s, now = Date.now()) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00+05:30")) && Date.parse(s + "T00:00:00+05:30") <= now + 86400000;

export const STATUS_TONE = { Verified: "ok", Confirmed: "ok", Unverified: "mute", Flagged: "bad", Mismatch: "bad", "Not in statement": "warn" };
