/* Pure: Telegram message text for Stashr (HTML parse mode). No I/O. */
const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const hhmm = (iso, tz) => { const d = new Date(iso || Date.now()); try { return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz || "Asia/Kolkata" }); } catch { return d.toISOString().slice(11, 16); } };
const host = (u) => String(u || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");

/** "/pass gmail 1234" -> { cmd: "pass", args: ["gmail", "1234"] }. Bot mentions (/status@MyBot) are stripped. */
function parseCommand(text) {
  const t = String(text || "").trim();
  if (MENU_BUTTONS[t]) return { cmd: MENU_BUTTONS[t], args: [] };
  if (!t.startsWith("/")) return { cmd: "", args: t ? t.split(/\s+/) : [] };
  const [head, ...args] = t.split(/\s+/);
  return { cmd: head.slice(1).split("@")[0].toLowerCase(), args };
}

/**
 * The health picture used by the digest and /status.
 * services: [{ key, name, url, suspended, type }], health: Map(key -> { state, status, at, deploy }),
 * incidents: open incident events, pings: { key: { ok, status, missingRoute } }
 */
/* Only a confirmed outage is red. A first failed check ("suspect"), a deploy in progress or an unknown result is not. */
const isDown = (h) => Boolean(h) && (h.verdict ? h.verdict === "down" : h.state === "unhealthy" || h.state === "timeout");

function summarize({ services = [], health = new Map(), incidents = [], pings = {} }) {
  const running = services.filter((s) => !s.suspended);
  const problems = [];
  for (const s of running) {
    const h = health.get(s.key);
    const p = pings[s.key];
    if (isDown(h)) problems.push({ name: s.name, text: h.state === "timeout" ? "not responding" : "down" + (h.status ? " (HTTP " + h.status + ")" : "") });
    else if (p && !p.ok && !p.missingRoute) problems.push({ name: s.name, text: "ping failed" + (p.status ? " (HTTP " + p.status + ")" : p.error ? " (" + p.error + ")" : "") });
    if (h?.deploy && /fail/i.test(h.deploy)) problems.push({ name: s.name, text: "last deploy failed" });
  }
  for (const i of incidents) if (!problems.some((p) => p.name === i.serviceName)) problems.push({ name: i.serviceName, text: i.message || i.type });
  const checked = running.filter((s) => health.has(s.key) || pings[s.key]);
  const healthy = checked.filter((s) => !problems.some((p) => p.name === s.name));
  return { running: running.length, suspended: services.length - running.length, checked: checked.length, healthy: healthy.length, problems, openIncidents: incidents.length };
}

function digestText(sum, { projects = 0, lastTick = null, at = new Date().toISOString(), tz } = {}) {
  const ok = !sum.problems.length;
  const lines = [(ok ? "🟢" : "🔴") + " <b>Stashr · " + (ok ? "all OK" : plural(sum.problems.length, "problem")) + "</b>  " + hhmm(at, tz)];
  for (const p of sum.problems.slice(0, 8)) lines.push("• <b>" + esc(p.name) + "</b> — " + esc(p.text));
  if (sum.problems.length > 8) lines.push("• …and " + (sum.problems.length - 8) + " more (/incidents)");
  lines.push("Servers " + sum.running + " running" + (sum.suspended ? " · " + sum.suspended + " suspended" : "") + " · healthy " + sum.healthy + "/" + sum.checked);
  lines.push("Incidents " + sum.openIncidents + " open · Projects " + projects + (lastTick ? " · checked " + hhmm(lastTick, tz) : ""));
  return lines.join("\n");
}

function serversText(services, health, pings, { tz } = {}) {
  if (!services.length) return "No Render services are connected.";
  const rows = [...services].sort((a, b) => Number(a.suspended) - Number(b.suspended) || a.name.localeCompare(b.name)).slice(0, 60).map((s) => {
    const h = health.get(s.key), p = pings[s.key];
    const icon = s.suspended ? "⏸" : isDown(h) ? "🔴" : p && !p.ok && !p.missingRoute ? "🟠" : "🟢";
    const bits = [s.suspended ? "suspended" : h?.state === "healthy" ? "healthy" + (h.status ? " " + h.status : "") : h?.state || (p ? (p.ok ? "ping ok" : "ping " + (p.status || p.error)) : "not checked yet")];
    if (h?.at) bits.push(hhmm(h.at, tz));
    return icon + " <b>" + esc(s.name) + "</b> — " + esc(bits.join(" · ")) + (s.url ? "\n     " + esc(host(s.url)) : "");
  });
  return "<b>Servers</b> (" + services.length + ")\n" + rows.join("\n") + (services.length > 60 ? "\n…" : "");
}

function incidentsText(open, { tz } = {}) {
  if (!open.length) return "✅ No open incidents.";
  return "<b>Open incidents</b> (" + open.length + ")\n" + open.slice(0, 30).map((i) => "🔴 <b>" + esc(i.serviceName) + "</b> — " + esc(i.message || i.type) + " · since " + hhmm(i.openedAt || i.at, tz)).join("\n");
}

function projectsText(projects) {
  const active = projects.filter((p) => p.status !== "archived");
  if (!active.length) return "No projects yet.";
  return "<b>Projects</b> (" + active.length + ")\n" + active.slice(0, 50).map((p) => "• <b>" + esc(p.name) + "</b> — " + esc(p.status || "—") + (p.servers ? " · " + plural(p.servers, "server") : "") + (p.liveUrl ? "\n   " + esc(host(p.liveUrl)) : "")).join("\n") + "\n\nDetails: /project <i>name</i>";
}

function projectText(p) {
  const lines = ["<b>" + esc(p.name) + "</b> — " + esc(p.status || "—")];
  if (p.description) lines.push(esc(p.description));
  if (p.liveUrl) lines.push("🌐 " + esc(p.liveUrl));
  if (p.repoUrl) lines.push("📦 " + esc(p.repoUrl));
  for (const s of p.renderServices || []) lines.push("🖥 " + esc(s.name || s.serviceId) + (s.url ? " · " + esc(host(s.url)) : "") + (s.suspended ? " · suspended" : ""));
  if ((p.databases || []).length) lines.push("🗄 " + p.databases.map((d) => esc([d.label, d.provider].filter(Boolean).join(" / "))).join(", "));
  const auto = (p.extraFields || []).find((f) => f.label === "Services used (auto)");
  if (auto?.value) lines.push("🔌 " + esc(auto.value));
  if ((p.envVars || []).length) lines.push("🔑 " + plural(p.envVars.length, "env var") + ": " + esc(p.envVars.slice(0, 25).map((v) => v.name).join(", ")) + (p.envVars.length > 25 ? ", …" : ""));
  return lines.join("\n");
}

/* Buttons of the menu under the chat box -> the command they run. */
const MENU_BUTTONS = { "📊 Status": "status", "🖥 Servers": "servers", "🚨 Incidents": "incidents", "📁 Projects": "projects", "🔔 Updates": "updates", "❓ Help": "help" };
const MENU_KEYBOARD = {
  keyboard: [["📊 Status", "🖥 Servers"], ["🚨 Incidents", "📁 Projects"], ["🔔 Updates", "❓ Help"]].map((row) => row.map((text) => ({ text }))),
  resize_keyboard: true, is_persistent: true, input_field_placeholder: "Tap a button or type /help"
};

/* What the bot sends on its own. "alerts" is the default: no timed updates. */
const UPDATE_MODES = {
  ask: "🔕 Only when I ask — no automatic messages, not even alerts",
  alerts: "🚨 Alerts only — a message when something breaks (no timed updates)",
  timer: "⏱ Alerts + a status update every few minutes"
};

const HELP = [
  "<b>Stashr bot</b>",
  "Use the buttons below the chat box, or:",
  "/status — everything in one message",
  "/servers — every server and its health",
  "/incidents — open incidents",
  "/projects — your projects",
  "/project <i>name</i> — one project in detail",
  "/pass <i>name</i> <i>PIN</i> — a saved password (if turned on in Stashr; the reply deletes itself after 60 s)",
  "/updates — choose when I message you on my own",
  "/menu — show the buttons again"
].join("\n");

/** Best matches for a name among items/projects: exact, then starts-with, then contains. */
function findByName(list, query, field = "name") {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const value = (x) => String(x?.[field] || "").toLowerCase();
  const exact = list.filter((x) => value(x) === q);
  if (exact.length) return exact;
  const starts = list.filter((x) => value(x).startsWith(q));
  if (starts.length) return starts;
  return list.filter((x) => value(x).includes(q) || String(x?.url || "").toLowerCase().includes(q));
}

module.exports = { MENU_BUTTONS, MENU_KEYBOARD, UPDATE_MODES, esc, parseCommand, summarize, digestText, serversText, incidentsText, projectsText, projectText, findByName, HELP };
