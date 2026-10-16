/*
 * Pure: one robot mood per page, from that page's own data. Each returns
 * { mood, title, line, stats: [[label, value, tone]] } for <RobotBanner>.
 */

const plural = (n, one, many = one + "s") => n + " " + (n === 1 ? one : many);

/** Passwords: the vault's health. */
export function vaultMood(health, count) {
  const h = health || {};
  const stats = [["SCORE", (h.score ?? 0) + "%", h.score >= 85 ? "ok" : h.score >= 60 ? "mid" : "bad"], ["STRONG", h.strong ?? 0, "ok"], ["WEAK", h.weak ?? 0, h.weak ? "mid" : "ok"], ["REUSED", h.reused ?? 0, h.reused ? "mid" : "ok"], ["LEAKED", h.breached ?? 0, h.breached ? "bad" : "ok"]];
  if (!count) return { mood: "bored", title: "Vault Bot", line: "Vault khaali hai 😐 Pehla password add karo, main pehra dunga.", stats: [] };
  if (h.breached) return { mood: "scared", title: "Vault Bot", line: "😨 " + plural(h.breached, "password") + " kisi leak mein mil gaye! Inhe abhi badlo.", stats };
  if (h.reused >= 3 && (h.score ?? 100) < 70) return { mood: "dizzy", title: "Vault Bot", line: "😵‍💫 " + plural(h.reused, "password") + " baar-baar repeat ho rahe hain — ek leak, sab khatam.", stats };
  if (h.weak) return { mood: "sweaty", title: "Vault Bot", line: "😅 " + plural(h.weak, "kamzor password") + " — thoda mazboot bana do.", stats };
  if ((h.score ?? 0) >= 90) return { mood: "starstruck", title: "Vault Bot", line: "🤩 Vault ekdum tight hai! Score " + h.score + "% — hacker ro dega.", stats };
  return { mood: "chill", title: "Vault Bot", line: "😎 " + plural(count, "password") + " safe hain. Sab control mein.", stats };
}

/** Projects: live health of every project. statuses: { id: { health: { level } } } */
export function projectsMood(projects, statuses) {
  const list = Object.values(statuses || {});
  const level = (st) => st?.health?.level || st?.level || "unknown";
  const red = list.filter((st) => level(st) === "red").length;
  const amber = list.filter((st) => level(st) === "amber").length;
  const green = list.filter((st) => level(st) === "green").length;
  const stats = [["PROJECTS", projects.length, "idle"], ["HEALTHY", green, "ok"], ["WATCH", amber, amber ? "mid" : "ok"], ["CRITICAL", red, red ? "bad" : "ok"]];
  if (!projects.length) return { mood: "bored", title: "Project Bot", line: "Koi project nahi 😐 GitHub ya Render connect karo, main khud bana dunga.", stats: [] };
  if (red) return { mood: "fire", title: "Project Bot", line: "🔥 " + plural(red, "project") + " ki halat kharab hai — red wale pehle dekho.", stats };
  if (amber) return { mood: "sweaty", title: "Project Bot", line: "😅 " + plural(amber, "project") + " pe nazar rakho (CI ya deploy drift).", stats };
  if (green && green === list.length) return { mood: "celebrating", title: "Project Bot", line: "🥳 Saare " + plural(green, "project") + " green! Party time.", stats };
  return { mood: list.length ? "chill" : "confused", title: "Project Bot", line: list.length ? "😎 Projects theek chal rahe hain." : "🤔 Health check ho raha hai…", stats };
}

/** Cron: the ping jobs' latest results. results: { key: { ok, missingRoute } } */
export function cronMood(webCount, results) {
  const rs = Object.values(results || {});
  const ok = rs.filter((r) => r.ok).length, missing = rs.filter((r) => r.missingRoute).length, bad = rs.filter((r) => !r.ok && !r.missingRoute).length;
  const stats = [["SERVERS", webCount, "idle"], ["ANSWERING", ok, "ok"], ["NO /health", missing, missing ? "mid" : "ok"], ["FAILING", bad, bad ? "bad" : "ok"]];
  if (!webCount) return { mood: "bored", title: "Cron Bot", line: "Ping karne ko koi server nahi 😐", stats: [] };
  if (bad) return { mood: "angry", title: "Cron Bot", line: "😠 " + plural(bad, "server") + " ping ka jawab nahi de rahe!", stats };
  if (missing) return { mood: "confused", title: "Cron Bot", line: "🤔 " + plural(missing, "server") + " pe /health route nahi hai — “Fix all” dabao.", stats };
  if (rs.length && ok === rs.length) return { mood: "starstruck", title: "Cron Bot", line: "🤩 Saare servers jaage hue hain aur jawab de rahe hain.", stats };
  return { mood: "chill", title: "Cron Bot", line: "😎 Main har 10 minute mein sabko jagata rehta hoon.", stats };
}

/** Security: the latest scan run. */
export function securityMood({ loading, failed, passed, active, hasRun }) {
  const stats = [["PASSED", passed, "ok"], ["FAILED", failed, failed ? "bad" : "ok"], ["RUNNING", active, active ? "mid" : "idle"]];
  if (loading) return { mood: "transforming", title: "Security Bot", line: "⚡ Scan results la raha hoon…", stats };
  if (!hasRun) return { mood: "confused", title: "Security Bot", line: "🤔 Abhi koi scan nahi chala. Ek chala ke dekho.", stats };
  if (active) return { mood: "transforming", title: "Security Bot", line: "⚡ Scan chal raha hai… code ki talaashi ho rahi hai.", stats };
  if (failed) return { mood: "scared", title: "Security Bot", line: "😨 " + plural(failed, "check") + " fail hue — vulnerabilities mili hain!", stats };
  return { mood: "starstruck", title: "Security Bot", line: "🤩 Saare security checks pass! Code saaf hai.", stats };
}

/** Settings / account: two-factor and sessions. */
export function accountMood(profile) {
  const twoFa = Boolean(profile?.twoFactorEnabled);
  const sessions = profile?.sessions ?? 0;
  const stats = [["2FA", twoFa ? "ON" : "OFF", twoFa ? "ok" : "bad"], ["SESSIONS", sessions, sessions > 5 ? "mid" : "ok"]];
  if (!twoFa) return { mood: "scared", title: "Guard Bot", line: "😨 Two-factor band hai! Ek minute mein on karo, main shanti se so paunga.", stats };
  if (sessions > 5) return { mood: "sweaty", title: "Guard Bot", line: "😅 " + sessions + " jagah se sign-in hai — purane devices hata do.", stats };
  return { mood: "starstruck", title: "Guard Bot", line: "🤩 Account ekdum surakshit. 2FA on, sab badhiya.", stats };
}

/** Server URLs (registry): how many app servers are listed. */
export function registryMood(apps) {
  const list = apps || [];
  const urls = list.reduce((n, a) => n + (a.urls || []).length, 0);
  const single = list.filter((a) => (a.urls || []).length === 1).length;
  const stats = [["APPS", list.length, "idle"], ["URLS", urls, "ok"], ["NO BACKUP", single, single ? "mid" : "ok"]];
  if (!list.length) return { mood: "confused", title: "Router Bot", line: "🤔 Server list load ho rahi hai…", stats: [] };
  if (single) return { mood: "sweaty", title: "Router Bot", line: "😅 " + plural(single, "app") + " ke paas sirf ek server hai — backup URL daal do.", stats };
  return { mood: "chill", title: "Router Bot", line: "😎 Har app ke paas backup server hai. Ek gire to doosra sambhalega.", stats };
}
