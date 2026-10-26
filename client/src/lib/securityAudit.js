/* Pure helpers for the Security checkpoint page: turn vault health + profile into rows. */

export const BREACH_AT_KEY = "stashr_breach_at";

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Names (never passwords) of items flagged by a health info key, sorted. */
export function affectedItems(items = [], health = {}, flag) {
  const info = health.info || {};
  return items
    .filter((i) => info[i.id] && (flag === "weak" ? info[i.id].score <= 1 : Boolean(info[i.id][flag])))
    .map((i) => ({ id: i.id, name: i.name || "Untitled" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function scoreBand(score, total) {
  if (!total) return { tone: "idle", label: "Nothing to scan yet" };
  if (score >= 85) return { tone: "ok", label: "Strong" };
  if (score >= 60) return { tone: "warn", label: "Fair" };
  return { tone: "danger", label: "Needs attention" };
}

/**
 * Checkpoint rows. tone: ok | warn | danger | idle.
 * opts.breachChecked: whether a breach check finished in this session.
 */
export function checkpointRows(items = [], health = {}, profile = {}, opts = {}) {
  const total = health.total || 0;
  const rows = [];
  const pw = (key, title, count, okText, badText, tone) => ({
    key, title, count,
    tone: !total ? "idle" : count ? tone : "ok",
    status: !total ? "No passwords" : count ? plural(count, "password") : "Clear",
    text: !total ? "Add a password to start scanning." : count ? badText : okText,
    affected: count ? affectedItems(items, health, key) : [],
  });
  rows.push(pw("weak", "Weak passwords", health.weak || 0,
    "No weak passwords found.", "Easy to guess. Replace them with long generated passwords.", "warn"));
  rows.push(pw("reused", "Reused passwords", health.reused || 0,
    "Every password is unique.", "One leak opens every account that shares it. Give each a unique password.", "warn"));
  rows.push(pw("old", "Old passwords", health.old || 0,
    "All passwords changed within the last 6 months.", "Not changed in over 6 months. Consider rotating important ones.", "warn"));
  if (!opts.breachChecked) {
    rows.push({ key: "breached", title: "Breached passwords", count: null, tone: "idle",
      status: total ? "Not checked" : "No passwords",
      text: total ? "Run a breach check to compare against known leaks. Only a 5-character SHA-1 hash prefix is sent." : "Add a password to start scanning.",
      affected: [] });
  } else {
    rows.push(pw("breached", "Breached passwords", health.breached || 0,
      "None found in known data breaches.", "Seen in known data breaches. Change these first.", "danger"));
  }
  const tfa = Boolean(profile && profile.twoFactorEnabled);
  const codes = profile && Number.isFinite(profile.recoveryCodesLeft) ? profile.recoveryCodesLeft : null;
  rows.push({ key: "twofactor", title: "Two-factor sign-in", count: null,
    tone: tfa ? (codes !== null && codes <= 2 ? "warn" : "ok") : "warn",
    status: tfa ? "On" : "Off",
    text: tfa
      ? `An authenticator code is required at sign-in.${codes !== null ? ` ${plural(codes, "recovery code")} left.` : ""}`
      : "Turn on an authenticator code so a stolen password alone can't sign in.",
    affected: [] });
  return rows;
}

/** Overall status line. "All clear" only when every row is ok. */
export function overallStatus(rows) {
  const issues = rows.filter((r) => r.tone === "warn" || r.tone === "danger").length;
  if (rows.some((r) => r.tone === "danger")) return { tone: "danger", text: `${plural(issues, "checkpoint")} need attention` };
  if (issues) return { tone: "warn", text: `${plural(issues, "checkpoint")} to review` };
  if (rows.some((r) => r.tone === "idle")) return { tone: "idle", text: "No issues found so far" };
  return { tone: "ok", text: "All clear" };
}

export function lastCheckedText(ms, now = Date.now()) {
  if (!ms) return "No breach check recorded on this device";
  const d = Math.floor((now - ms) / 86400000);
  return `Last breach check: ${d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`}`;
}
