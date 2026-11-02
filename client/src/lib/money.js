/* Pure helpers for the Money page: rupee formatting, months, grouping by day, shares and quick start dates. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 123456.5 -> "₹1,23,456.50" (Indian grouping). Whole numbers keep two decimals only when they have paise. */
export function inr(value, { sign = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const hasPaise = Math.round(abs * 100) % 100 !== 0;
  const text = abs.toLocaleString("en-IN", { minimumFractionDigits: hasPaise ? 2 : 0, maximumFractionDigits: 2 });
  const s = n < 0 ? "−" : sign && n > 0 ? "+" : "";
  return `${s}₹${text}`;
}

/** "2026-10" -> "Oct 2026". */
export function monthLabel(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ""));
  return m ? `${MONTHS[Number(m[2]) - 1] || m[2]} ${m[1]}` : String(month || "");
}

/** The month before/after "YYYY-MM". */
export function shiftMonth(month, delta) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ""));
  if (!m) return month;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "2026-10-21" -> "Wed, 21 Oct". */
export function dayLabel(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ""));
  if (!m) return String(date || "");
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]}, ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
}

/** Rows (newest first) grouped by date: [{ date, debit, credit, rows }]. Flagged rows are not part of a day's total. */
export function groupByDay(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const g = map.get(r.date) || { date: r.date, debit: 0, credit: 0, rows: [] };
    g.rows.push(r);
    if (r.status !== "Flagged") { if (r.type === "Debit") g.debit += r.amount; else if (r.type === "Credit") g.credit += r.amount; }
    map.set(r.date, g);
  }
  const days = [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const g of days) {
    g.debit = Math.round(g.debit * 100) / 100;
    g.credit = Math.round(g.credit * 100) / 100;
    g.rows.sort((a, b) => ((b.time || "") < (a.time || "") ? -1 : (b.time || "") > (a.time || "") ? 1 : b.index - a.index));
  }
  return days;
}

/** Each category with its share of the total spent, in percent (one decimal). */
export function withShares(byCategory) {
  const total = (byCategory || []).reduce((a, c) => a + c.amount, 0);
  return (byCategory || []).map((c) => ({ ...c, share: total > 0 ? Math.round((c.amount / total) * 1000) / 10 : 0 }));
}

/** The date for a quick chip, as YYYY-MM-DD in local time: 0 = first of this month, otherwise that many months ago (same day). */
export function startDateChip(kind, now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (kind === "month") d.setDate(1);
  else d.setMonth(d.getMonth() - ({ "3m": 3, "6m": 6, "1y": 12 }[kind] || 0));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const STATUS_LABEL = { Verified: "Verified ✓", Unverified: "Unverified", Confirmed: "Confirmed", Mismatch: "Mismatch", "Not in statement": "Not in statement", Flagged: "Needs checking" };
/** CSS modifier for a status badge. */
export const statusTone = (s) => ({ Verified: "ok", Confirmed: "ok", Mismatch: "bad", Flagged: "bad", "Not in statement": "warn" }[s] || "mute");
