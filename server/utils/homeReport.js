/**
 * The Home report: ONE Telegram message (HTML parse mode, under Telegram's 4096-character limit) that lists everything that
 * changed. `renderReport` is pure (no I/O) so it can be tested; `collectReport` reads the database.
 *
 *   🏠 STASHR HOME · Tue 4 Nov · 08:00        ← title
 *   🟢 All good  (or 🟡 n to check / 🔴 n problems)
 *   ━━━━━━━━━━━━━━━━━━━━
 *   👪 WHO IS HOME  ·  📺 TV  ·  🔔 NOTIFICATIONS  ·  💬 WHATSAPP  ·  📸 CAMERA
 *   📶 DEVICES  ·  🌐 SERVERS (optional)  ·  🚀 INTERNET  ·  💰 COST (optional)  ·  🆕 CHANGED
 */
const HomeEvent = require("../models/homeEvent");
const HomeSpeed = require("../models/homeSpeed");
const home = require("./home");

const LIMIT = 3900;
const esc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const BAR = "━━━━━━━━━━━━━━━━━━━━";
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

function clock(at, tz) {
    try { return new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz || "Asia/Kolkata" }); } catch (e) { return new Date(at).toISOString().slice(11, 16); }
}
function dayLabel(at, tz) {
    try { return new Date(at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: tz || "Asia/Kolkata" }); } catch (e) { return new Date(at).toISOString().slice(0, 10); }
}

/** A section is a heading plus lines; empty sections are dropped. Lines are cut so one section never eats the message. */
function section(title, lines, max = 6) {
    const l = (lines || []).filter(Boolean);
    if (!l.length) return null;
    const shown = l.slice(0, max);
    if (l.length > max) shown.push(`… +${l.length - max} more`);
    return [`<b>${title}</b>`, ...shown].join("\n");
}

/**
 * d = {
 *   at, tz, periodLabel,
 *   people:   [{ person, home, since?, where? }],
 *   tv:       [{ name, state: "on"|"standby"|"off" }],  tvMinutes, tvApps: {app: min}, tvPeak?: "21:00", tvLimit?: min,
 *   alerts:   [{ at, text, ok: true|false|null }],          // notifications sent to TV / phones / Telegram
 *   whatsapp: [{ at, text, status: "sent"|"failed"|"skipped" }],
 *   camera:   { photos, clips, movement, last? },
 *   devices:  { wifiUp, newOnes: [text], phones: [{ name, battery?, charging?, online }] },
 *   servers?: { total, up, down: [name], slowest?: {name, ms} },
 *   internet?: { down, up, ping, min?, max? },
 *   cost?:    { today, month, budget? },
 *   changes:  [text]                                          // the things that are new or different
 * }
 */
function renderReport(d) {
    const tz = d.tz || "Asia/Kolkata";
    const warn = [], bad = [];
    const alertsFailed = (d.alerts || []).filter((a) => a.ok === false);
    const wa = d.whatsapp || [];
    const waFailed = wa.filter((w) => w.status === "failed");
    if (alertsFailed.length) bad.push(plural(alertsFailed.length, "notification") + " failed");
    if (waFailed.length) bad.push(plural(waFailed.length, "WhatsApp message") + " failed");
    if (d.servers && d.servers.down && d.servers.down.length) bad.push(plural(d.servers.down.length, "server") + " down");
    const lowPhones = ((d.devices && d.devices.phones) || []).filter((p) => p.battery != null && p.battery <= 15 && !p.charging);
    if (lowPhones.length) warn.push("low battery: " + lowPhones.map((p) => p.name).join(", "));
    if (d.devices && d.devices.newOnes && d.devices.newOnes.length) warn.push(plural(d.devices.newOnes.length, "new device"));
    if (d.tvLimit && d.tvMinutes > d.tvLimit) warn.push("TV over the limit");
    const verdict = bad.length ? `🔴 <b>${bad.length > 1 ? bad.length + " problems" : "1 problem"}</b>: ${esc(bad.join(", "))}` : warn.length ? `🟡 <b>To check</b>: ${esc(warn.join(", "))}` : "🟢 <b>All good</b>";

    const out = [`🏠 <b>STASHR HOME</b> · ${esc(dayLabel(d.at, tz))} · ${esc(clock(d.at, tz))}`, `<i>${esc(d.periodLabel || "Last 24 hours")}</i>\n${verdict}`];
    if (d.headline) out[0] += `\n\n📣 <b>NOW</b>: ${esc(d.headline)}`;
    out[0] += "\n" + BAR;

    const people = (d.people || []).map((p) => `${p.home ? "🟢" : "⚪"} ${esc(p.person)} — ${p.home ? "home" : "away"}${p.since ? " since " + esc(clock(p.since, tz)) : ""}${p.where && !p.home ? " (" + esc(p.where) + ")" : ""}`);
    out.push(section("👪 WHO IS HOME", people, 8));

    const tvLines = (d.tv || []).map((t) => `${t.state === "on" ? "🟢" : t.state === "standby" ? "🟡" : "⚪"} ${esc(t.name)}: ${esc(t.state)}`);
    if (d.tvMinutes) {
        const apps = Object.entries(d.tvApps || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, m]) => `${esc(n)} ${fmtMin(m)}`).join(", ");
        tvLines.push(`⏱ <b>${fmtMin(d.tvMinutes)}</b>${d.tvLimit ? " / " + fmtMin(d.tvLimit) + " limit" : ""}${apps ? " · " + apps : ""}${d.tvPeak ? " · peak " + esc(d.tvPeak) : ""}`);
    } else if (tvLines.length) tvLines.push("⏱ No TV time");
    out.push(section("📺 TV", tvLines));

    const sent = (d.alerts || []).filter((a) => a.ok === true).length;
    const alertLines = (d.alerts || []).slice().sort((a, b) => (a.ok === false ? -1 : 0) - (b.ok === false ? -1 : 0)).map((a) => `${a.ok === false ? "❌" : a.ok === true ? "✅" : "▫️"} ${esc(clock(a.at, tz))} ${esc(a.text)}`);
    if (alertLines.length) alertLines.unshift(`${sent} sent · ${alertsFailed.length} failed · ${(d.alerts || []).length - sent - alertsFailed.length} logged`);
    out.push(section("🔔 NOTIFICATIONS", alertLines, 7));

    const ICON = { sent: "✅", failed: "❌", skipped: "⏭" };
    const waLines = wa.map((w) => `${ICON[w.status] || "▫️"} ${esc(clock(w.at, tz))} ${esc(w.text)}`);
    out.push(section("💬 WHATSAPP", waLines.length ? waLines : ["No messages"], 5));

    const c = d.camera || {};
    if (c.photos || c.clips || c.movement) out.push(section("📸 CAMERA", [`${plural(c.movement || 0, "movement")} · ${plural(c.photos || 0, "photo")} · ${plural(c.clips || 0, "clip")}${c.last ? " · last " + esc(clock(c.last, tz)) : ""}`]));

    const dv = d.devices || {};
    const devLines = [];
    if (dv.wifiUp != null) devLines.push(`📡 ${dv.wifiUp} on Wi-Fi`);
    (dv.phones || []).forEach((p) => devLines.push(`${p.online ? "🟢" : "⚪"} ${esc(p.name)}${p.battery != null ? ` 🔋${p.battery}%${p.charging ? "⚡" : ""}` : ""}`));
    (dv.newOnes || []).forEach((t) => devLines.push(`🆕 ${esc(t)}`));
    out.push(section("📶 DEVICES", devLines, 8));

    if (d.servers) {
        const s = d.servers;
        const l = [`${s.up}/${s.total} up${s.down && s.down.length ? " · ❌ " + esc(s.down.join(", ")) : ""}`];
        if (s.slowest) l.push(`🐢 slowest ${esc(s.slowest.name)} ${s.slowest.ms} ms`);
        out.push(section("🌐 SERVERS", l));
    }
    if (d.internet) {
        const n = d.internet;
        out.push(section("🚀 INTERNET", [`${n.down} ↓ / ${n.up} ↑ Mbit/s · ${n.ping} ms${n.min != null ? ` · low ${n.min}, peak ${n.max}` : ""}`]));
    }
    if (d.cost) out.push(section("💰 COST", [`Today ₹${d.cost.today} · month ₹${d.cost.month}${d.cost.budget ? " / ₹" + d.cost.budget : ""}`]));

    if ((d.changes || []).length) out.push(BAR, section("🆕 WHAT CHANGED", d.changes.map((t) => "• " + esc(t)), 6));

    let msg = out.filter(Boolean).join("\n\n");
    // The single-message promise: never longer than Telegram allows.
    if (msg.length > LIMIT) msg = msg.slice(0, LIMIT).replace(/<[^>]*$/, "").replace(/\n[^\n]*$/, "") + "\n… (shortened)";
    return msg;
}

const KIND_FAILED = new Set(["place_failed"]);
const ALERT_KINDS = ["home_arrived", "home_left", "arrived", "eta", "tv_limit", "tv_late", "empty_home", "lan_new", "camera", "online", "offline", "place_failed", "umbrella"];

/** Reads the last `hours` hours of one account. `summary` is { devices, people, wifiUp } from houseSummary. */
async function collectReport({ owner, settings, summary, now = Date.now(), hours = 24, localParts }) {
    const tz = settings.timezone || "Asia/Kolkata";
    const since = new Date(now - hours * 3600 * 1000);
    const events = await HomeEvent.find({ owner, at: { $gte: since } }).sort({ at: 1 }).limit(400).lean();
    const of = (...k) => events.filter((e) => k.includes(e.kind));

    const alerts = of(...ALERT_KINDS).filter((e) => e.kind !== "online" && e.kind !== "offline" || /tv|television/i.test(e.deviceName || ""))
        .map((e) => ({ at: e.at, text: e.text.slice(0, 70), ok: KIND_FAILED.has(e.kind) ? false : null }));
    const whatsapp = of("place", "place_failed", "place_skipped").map((e) => ({ at: e.at, text: e.text.slice(0, 90), status: e.kind === "place" ? "sent" : e.kind === "place_failed" ? "failed" : "skipped" }));
    const camEvents = of("camera");
    const photos = of("upload").length;

    const y = localParts(now, tz).date;
    const usage = (settings.usage || {})[y] || (settings.usage || {})[localParts(now - 24 * 3600 * 1000, tz).date] || {};
    const speeds = await HomeSpeed.find({ owner, at: { $gte: since } }).sort({ at: -1 }).lean();
    const last = speeds[0];

    return {
        at: now, tz, periodLabel: `Last ${hours} hours`,
        people: summary.people.map((p) => ({ person: p.person, home: Boolean(p.home) })),
        tv: summary.devices.filter((d) => d.kind === "tv").map((tv) => ({ name: tv.name, state: tv.online ? (tv.status && tv.status.screen === "off" ? "standby" : "on") : "off" })),
        tvMinutes: usage.minutes || 0, tvApps: usage.apps || {}, tvLimit: (settings.tvLimit && settings.tvLimit.minutes) || 0,
        alerts, whatsapp,
        camera: { movement: camEvents.length, photos: photos || camEvents.length, clips: 0, last: camEvents.length ? camEvents[camEvents.length - 1].at : null },
        devices: {
            wifiUp: summary.wifiUp,
            phones: summary.phones.map((p) => { const b = home.batteryOf(p.status); return { name: p.person || p.name, online: Boolean(p.online), battery: b ? b.pct : null, charging: b ? b.charging : false }; }),
            newOnes: of("lan_new").map((e) => e.text.replace(/^.*?: /, "").slice(0, 50)),
        },
        internet: last ? { down: last.down, up: last.up, ping: last.ping, min: speeds.length > 1 ? Math.min(...speeds.map((s) => s.down)) : null, max: speeds.length > 1 ? Math.max(...speeds.map((s) => s.down)) : null } : null,
        changes: of("lan_new", "lan_joined", "lan_left", "movie_added", "movie_removed", "paired", "unpaired", "place_failed").map((e) => `${clock(e.at, tz)} ${e.text.slice(0, 80)}`).slice(-6),
    };
}

module.exports = { renderReport, collectReport, section, esc, fmtMin };

/**
 * THE one way Stashr Home talks to Telegram: builds the full report and sends it as a single message.
 * `headline` is the update that caused this message ("Papa came home"); the briefs send none.
 * Never throws; returns true when Telegram accepted it.
 */
async function sendReport(owner, { headline = "", hours = 24, now = Date.now() } = {}) {
    try {
        const automation = require("./homeAutomation");
        const settings = await automation.settingsOf(owner);
        const summary = await automation.houseSummary(owner, now);
        const data = await collectReport({ owner, settings, summary, now, hours, localParts: automation.localParts });
        data.headline = headline;
        data.periodLabel = hours === 168 ? "Last 7 days" : `Last ${hours} hours`;
        return await automation.sendTelegram(owner, renderReport(data));
    } catch (e) {
        console.log("[home] report failed:", e.message);
        return false;
    }
}

module.exports.sendReport = sendReport;
