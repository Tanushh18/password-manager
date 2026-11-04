const crypto = require("crypto");
const { without } = require("./projection");
const mongoose = require("mongoose");
const User = require("../models/schema");
const renderOps = require("./renderOps");
const { openEvents } = require("./incidentFold");
const { pingResults } = require("./pings");
const T = require("./telegramText");
const catalog = require("./telegramCatalog");
const { runTelegramRead } = require("./telegramRead");
const TelegramNotification = require("../models/TelegramNotification");
const { probeService } = require("./healthProbe");

/*
 * Personal Telegram bot. You paste your bot token in Stashr; Stashr registers a webhook, you press Start in the
 * bot once (with a one-time code) and from then on only that chat is answered. It sends incident alerts, a short
 * status digest every few minutes and answers commands. Passwords are off by default; when turned on they need a
 * PIN, and the reply (and your message with the PIN) is deleted after 60 seconds.
 */
const API = "https://api.telegram.org/bot";
const PASSWORD_TTL_MS = 60 * 1000;
const PIN_MAX_FAILS = 5;
const PIN_LOCK_MS = 15 * 60 * 1000;
const DIGEST_CHOICES = [5, 10, 15, 30, 60];
const MODES = ["ask", "alerts", "timer"];
/* When the bot messages on its own. Timed updates are off unless chosen ("timer"); older settings count as "alerts". */
const modeOf = (s) => (MODES.includes(s?.updates) ? s.updates : "alerts");
const COMMANDS = catalog.BOT_COMMANDS;
const SHORTCUTS = {
  who: () => "kaun ghar par hai", coming: () => "kab aayenge", locate: () => "location refresh", screenoff: () => "tablet screen off", today: () => "today updates",
  photo: () => "camera photo", clip: () => "camera clip", watch: () => "camera on", unwatch: () => "camera off", live: () => "camera live",
  pause: () => "pause the tv", play: () => "play the tv", next: () => "next", prev: () => "previous", mute: () => "mute the tv",
  volume: (a) => (a.length ? "volume " + a.join(" ") : ""), tvhome: () => "tv home", netflix: () => "open netflix",
  youtube: (a) => (a.length ? a.join(" ") + " song on tv" : ""), music: (a) => (a.length ? "play " + a.join(" ") + " song" : ""),
  scene: (a) => a.join(" "), speed: () => "speed test", scan: () => "scan wifi", sync: () => "sync movies",
  camera: (a) => "camera " + a.join(" "), tv: (a) => a.join(" ") + " tv"
};
const setCommands = (token) => tg(token, "setMyCommands", { commands: COMMANDS });

async function tg(token, method, body) {
  try {
    const res = await fetch(API + token + "/" + method, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(15000) });
    const json = await res.json().catch(() => ({}));
    return json.ok ? { ok: true, result: json.result } : { ok: false, error: json.description || "Telegram error " + res.status };
  } catch { return { ok: false, error: "Telegram did not answer." }; }
}
const { AsyncLocalStorage } = require("node:async_hooks");
/** The command being answered right now: its "working on it" note, so the first reply can replace it. */
const progress = new AsyncLocalStorage();

const send = async (token, chatId, text, extra = {}) => {
  const p = progress.getStore();
  if (p && !p.used && String(p.chatId) === String(chatId)) {
    await p.ready;
    // An inline keyboard can be put on an edited message; the big menu keyboard needs a message of its own.
    if (p.noteId && !(extra.reply_markup && !extra.reply_markup.inline_keyboard)) {
      p.used = true;
      const r = await tg(token, "editMessageText", { chat_id: chatId, message_id: p.noteId, text: String(text).slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true, ...(extra.reply_markup ? { reply_markup: extra.reply_markup } : {}) });
      if (r.ok) return r;
      p.used = false;      // Telegram refused the edit (same text, too old…): send it as a new message below
    }
  }
  return tg(token, "sendMessage", { chat_id: chatId, text: String(text).slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true, ...extra });
};

/**
 * Runs one command so that the person can SEE the server working: the "typing…" sign from the first moment, and when it takes
 * more than about 2 seconds a "⏳ Working on it…" message that the answer then replaces (an error replaces it too). A command never
 * ends silently: a note nobody used is turned into "✅ Done".
 */
async function withProgress(token, chatId, work) {
  const p = { chatId, used: false, noteId: null, done: false, ready: Promise.resolve() };
  const typing = () => { tg(token, "sendChatAction", { chat_id: chatId, action: "typing" }); };
  typing();
  const keep = setInterval(typing, 4000);
  const slow = setTimeout(() => {
    p.ready = (async () => {
      if (p.done) return;
      const r = await tg(token, "sendMessage", { chat_id: chatId, text: "⏳ Working on it…" });
      if (r.ok && r.result) p.noteId = r.result.message_id;
    })();
  }, 1800);
  try { return await progress.run(p, work); }
  finally {
    p.done = true; clearTimeout(slow); clearInterval(keep);
    await p.ready;
    if (p.noteId && !p.used) await tg(token, "editMessageText", { chat_id: chatId, message_id: p.noteId, text: "✅ Done." });
  }
}

/* ---------- state ---------- */
async function readState(user) {
  const entry = (user.telegram || [])[0];
  if (!entry || entry.enc !== "udk") return null;
  const fields = User.publicEntry(entry, await user.getDataKey());
  return fields && !fields.broken ? fields : null;
}
async function writeState(user, state) {
  const dataKey = await user.getDataKey();
  const clean = { ...state };
  ["_id", "createdAt", "updatedAt", "broken"].forEach((k) => delete clean[k]);
  const entry = { enc: "udk", data: User.sealEntry(dataKey, clean), createdAt: new Date(), updatedAt: new Date() };
  await User.updateOne({ _id: user._id }, { $set: { telegram: [entry], telegramHookId: clean.hookId || null } });
  user.telegram = [entry];
}
const publicState = (s) => s ? {
  connected: Boolean(s.chatId), botUsername: s.botUsername || "", chatName: s.chatName || "", linkedAt: s.linkedAt || null,
  linkUrl: !s.chatId && s.linkCode && Date.now() < (s.linkExpires || 0) ? "https://t.me/" + s.botUsername + "?start=" + s.linkCode : "",
  updates: modeOf(s), digestMinutes: DIGEST_CHOICES.includes(s.digestMinutes) ? s.digestMinutes : 10, digestQuietWhenOk: Boolean(s.digestQuietWhenOk),
  passwordsAllowed: Boolean(s.passwordsAllowed), pinSet: Boolean(s.pinHash), notificationCategories: catalog.normalizeNotificationCategories(s.notificationCategories), lastDigestAt: s.lastDigestAt || null
} : { connected: false };

/* Alerts (incidents) go through the Render ops config, so keep its Telegram fields in step. */
async function syncAlertChannel(user, token, chatId) {
  const prior = await renderOps.readConfig(user);
  const next = renderOps.normalizeConfig({ notifications: token ? { telegramBotToken: token, telegramChatId: String(chatId) } : { clearTelegramToken: true, clearTelegramChatId: true }, ...(token ? { monitor: { ...prior.monitor, enabled: true } } : {}) }, prior);
  await renderOps.saveConfig(user, next);
}

const publicBase = () => {
  const raw = String(process.env.SELF_URL || process.env.RENDER_EXTERNAL_URL || "").trim().replace(/\/+$/, "");
  return raw ? (/^https?:\/\//.test(raw) ? raw : "https://" + raw) : "";
};

/* Alerts reach the chat unless the user chose "only when I ask". */
async function applyMode(user, state) {
  if (!state?.chatId || modeOf(state) === "ask") await syncAlertChannel(user, null, null);
  else await syncAlertChannel(user, state.botToken, state.chatId);
}

/* ---------- connect / settings ---------- */
async function connect(user, token) {
  if (!/^\d{5,15}:[A-Za-z0-9_-]{30,60}$/.test(String(token || "").trim())) throw Object.assign(new Error("That does not look like a bot token (it looks like 123456789:ABC…, from @BotFather)."), { status: 400 });
  token = token.trim();
  const me = await tg(token, "getMe");
  if (!me.ok) throw Object.assign(new Error("Telegram rejected this token: " + me.error), { status: 400 });
  const base = publicBase();
  if (!base) throw Object.assign(new Error("The server does not know its public address (set SELF_URL)."), { status: 500 });
  const prior = await readState(user);
  const state = {
    ...(prior || {}), botToken: token, botUsername: me.result.username, botName: me.result.first_name,
    hookId: crypto.randomBytes(16).toString("hex"), hookSecret: crypto.randomBytes(24).toString("hex"),
    linkCode: crypto.randomBytes(9).toString("base64url"), linkExpires: Date.now() + 30 * 60 * 1000,
    chatId: prior?.botToken === token ? prior.chatId : null, chatName: prior?.botToken === token ? prior.chatName : "",
    digestMinutes: prior?.digestMinutes ?? 10
  };
  const hook = await tg(token, "setWebhook", { url: base + "/telegram/webhook/" + state.hookId, secret_token: state.hookSecret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
  if (!hook.ok) throw Object.assign(new Error("Could not register the bot webhook: " + hook.error), { status: 502 });
  await setCommands(token);
  await writeState(user, state);
  if (state.chatId) await applyMode(user, state);
  return publicState(state);
}

async function disconnect(user) {
  const state = await readState(user);
  if (state?.botToken) await tg(state.botToken, "deleteWebhook", { drop_pending_updates: true });
  await User.updateOne({ _id: user._id }, { $set: { telegram: [], telegramHookId: null } });
  user.telegram = [];
  await syncAlertChannel(user, null, null);
  return { connected: false };
}

const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString("hex");

async function updateSettings(user, input) {
  const state = await readState(user);
  if (!state) throw Object.assign(new Error("Connect the bot first."), { status: 400 });
  const before = modeOf(state);
  if (input.updates !== undefined) state.updates = MODES.includes(input.updates) ? input.updates : "alerts";
  if (input.digestMinutes !== undefined) state.digestMinutes = DIGEST_CHOICES.includes(Number(input.digestMinutes)) ? Number(input.digestMinutes) : 10;
  if (input.digestQuietWhenOk !== undefined) state.digestQuietWhenOk = input.digestQuietWhenOk === true;
  if (input.pin !== undefined) {
    if (!/^\d{4,8}$/.test(String(input.pin))) throw Object.assign(new Error("The PIN must be 4 to 8 digits."), { status: 400 });
    state.pinSalt = crypto.randomBytes(16).toString("hex");
    state.pinHash = hashPin(input.pin, state.pinSalt);
    state.pinFails = 0; state.pinLockedUntil = 0;
  }
  if (input.notificationCategories !== undefined) state.notificationCategories = catalog.normalizeNotificationCategories(input.notificationCategories);
  if (input.notifications === "all") state.notificationCategories = catalog.normalizeNotificationCategories("all");
  if (input.passwordsAllowed !== undefined) {
    if (input.passwordsAllowed === true && !state.pinHash) throw Object.assign(new Error("Set a PIN first."), { status: 400 });
    state.passwordsAllowed = input.passwordsAllowed === true;
  }
  await writeState(user, state);
  if (modeOf(state) !== before) await applyMode(user, state);
  return publicState(state);
}

/* ---------- the data the bot reports ---------- */
async function snapshot(user) {
  const dataKey = await user.getDataKey();
  const listed = (user.renderAccounts || []).length ? await renderOps.listEveryService(user, dataKey) : { services: [] };
  const services = listed.services.map((s) => ({ ...s, key: s.accountId + ":" + s.id }));
  const health = new Map();
  const history = renderOps.encryptedList(user, "renderMetricHistory", dataKey, 200).sort((a, b) => Date.parse(a.sampledAt) - Date.parse(b.sampledAt));
  for (const sample of history) for (const r of sample.services || []) if (r?.key) health.set(r.key, { state: r.health?.state, verdict: r.verdict, status: r.health?.status, at: sample.sampledAt, deploy: r.latestDeploy?.status || "" });
  const incidents = openEvents(renderOps.encryptedList(user, "renderIncidents", dataKey, 200));
  const projects = (user.projects || []).filter((e) => e.enc === "udk").map((e) => User.publicEntry(e, dataKey)).filter((p) => !p.broken);
  return { services, health, incidents, pings: pingResults(user._id), projects, lastTick: history.length ? history[history.length - 1].sampledAt : null };
}

/* ---------- incident buttons: Check / Restart / Resolve right under the alert ---------- */
async function audit(user, action, serviceKey, details = {}) {
  try {
    const dataKey = await user.getDataKey();
    const now = new Date();
    const entry = { _id: new mongoose.Types.ObjectId(), enc: "udk", data: User.sealEntry(dataKey, { action, accountId: String(serviceKey).split(":")[0], serviceId: String(serviceKey).split(":").slice(1).join(":"), details: { ...details, via: "telegram" }, at: now.toISOString() }), createdAt: now, updatedAt: now };
    await User.updateOne({ _id: user._id }, { $push: { renderAudit: { $each: [entry], $slice: -100 } } });
  } catch { /* the action already happened: never fail on the audit trail */ }
}

const NO_KEYBOARD = { inline_keyboard: [] };

/* The /updates message: the current choice and one button per option. */
function updatesMessage(state) {
  const mode = modeOf(state), every = DIGEST_CHOICES.includes(state.digestMinutes) ? state.digestMinutes : 10;
  const mark = (on) => (on ? "✅ " : "");
  return {
    parse_mode: "HTML",
    text: "<b>When should I message you on my own?</b>\nNow: " + T.UPDATE_MODES[mode] + (mode === "timer" ? " (" + every + " min)" : "") + "\n\nYou can always ask with the buttons below the chat box.",
    reply_markup: { inline_keyboard: [
      [{ text: mark(mode === "ask") + "🔕 Only when I ask", callback_data: "u:ask" }],
      [{ text: mark(mode === "alerts") + "🚨 Alerts only", callback_data: "u:alerts" }],
      [10, 30, 60].map((n) => ({ text: mark(mode === "timer" && every === n) + "⏱ " + n + " min", callback_data: "u:timer:" + n }))
    ] }
  };
}

async function handleButton(user, state, query) {
  const token = state.botToken;
  const chatId = query?.message?.chat?.id;
  const messageId = query?.message?.message_id;
  const answer = (text, alert = false) => tg(token, "answerCallbackQuery", { callback_query_id: query.id, text: String(text).slice(0, 190), show_alert: alert });
  // Only the linked chat may press anything.
  if (!chatId || String(chatId) !== String(state.chatId)) return void (await answer("This bot is private.", true));
  const actionPick = /^a:([yn]):([a-f0-9]{24})$/.exec(String(query.data || ""));
  if (actionPick) {
    const pending = state.pendingAction;
    if (!pending || pending.token !== actionPick[2] || Date.now() > Number(pending.expiresAt || 0)) {
      state.pendingAction = null; await writeState(user, state);
      return void (await answer("This confirmation expired. Send the command again.", true));
    }
    state.pendingAction = null; await writeState(user, state);
    if (actionPick[1] === "n") {
      await answer("Cancelled.");
      return void (await tg(token, "editMessageText", { chat_id: chatId, message_id: messageId, text: "✖ Action cancelled.", reply_markup: NO_KEYBOARD }));
    }
    await answer("Confirmed. Executing…");
    let reply = null;
    try { reply = await homeSay(user, pending.sentence); } catch { reply = "The action failed. Check Stashr Home for the current device state."; }
    return void (await tg(token, "editMessageText", { chat_id: chatId, message_id: messageId, text: "✅ <b>Confirmed</b>\\n" + (reply || "The assistant did not return a result."), parse_mode: "HTML", reply_markup: NO_KEYBOARD }));
  }
  const resolvePick = /^ir:([yn]):([0-9a-f-]{36})$/.exec(String(query.data || ""));
  if (resolvePick) {
    const pending = state.pendingIncidentResolve;
    if (!pending || pending.incidentId !== resolvePick[2] || Date.now() > Number(pending.expiresAt || 0)) {
      state.pendingIncidentResolve = null; await writeState(user, state);
      return void (await answer("This confirmation expired.", true));
    }
    state.pendingIncidentResolve = null; await writeState(user, state);
    if (resolvePick[1] === "n") {
      await answer("Cancelled.");
      return void (await tg(token, "editMessageText", { chat_id: chatId, message_id: messageId, text: "✖ Incident resolution cancelled.", reply_markup: NO_KEYBOARD }));
    }
    try {
      const dataKey = await user.getDataKey();
      const incident = openEvents(renderOps.encryptedList(user, "renderIncidents", dataKey, renderOps.INCIDENT_LIMIT)).find((e) => e.id === resolvePick[2]);
      if (!incident) { await answer("Incident already closed."); return void (await tg(token, "editMessageText", { chat_id: chatId, message_id: messageId, text: "Incident already closed.", reply_markup: NO_KEYBOARD })); }
      await renderOps.resolveIncidents(user, { ids: [resolvePick[2]], reason: "Resolved from Telegram after confirmation.", by: "manual" });
      await audit(user, "incident_resolved", incident.serviceKey, { type: incident.type });
      await answer("Incident resolved.");
      return void (await tg(token, "editMessageText", { chat_id: chatId, message_id: messageId, text: "✓ Incident resolved from Telegram.", reply_markup: NO_KEYBOARD }));
    } catch { await answer("Could not resolve the incident. Try again from Stashr.", true); return; }
  }
  const u = /^u:(ask|alerts|timer)(?::(\d{1,2}))?$/.exec(String(query.data || ""));
  if (u) {
    state.updates = u[1];
    if (u[2] && DIGEST_CHOICES.includes(Number(u[2]))) state.digestMinutes = Number(u[2]);
    await writeState(user, state);
    await applyMode(user, state);
    await answer("Saved");
    return void (await tg(token, "editMessageText", { chat_id: chatId, message_id: messageId, ...updatesMessage(state) }));
  }
  const pick = /^p:([0-9a-f]{24})$/.exec(String(query.data || ""));
  if (pick) {
    if (passwordsOff(state)) return void (await answer("Passwords over Telegram are off.", true));
    const item = (await savedLogins(user)).find((i) => i._id === pick[1]);
    if (!item) return void (await answer("That login is gone."));
    await setPending(user, state, { kind: "pin", itemId: item._id });
    await answer("Now send your PIN");
    return void (await send(token, chatId, "🔐 <b>" + T.esc(item.name) + "</b> — send your PIN now. I delete it right away."));
  }
  const m = /^i:([cxyrn]):([0-9a-f-]{36})$/.exec(String(query.data || ""));
  if (!m) return void (await answer("That button is no longer valid."));
  const [, action, incidentId] = m;
  const original = String(query.message.text || "");
  const edit = (note, keyboard) => tg(token, "editMessageText", { chat_id: chatId, message_id: messageId, text: (original + (note ? "\n\n" + note : "")).slice(0, 4000), disable_web_page_preview: true, reply_markup: keyboard || NO_KEYBOARD });

  const dataKey = await user.getDataKey();
  const incident = openEvents(renderOps.encryptedList(user, "renderIncidents", dataKey, renderOps.INCIDENT_LIMIT)).find((e) => e.id === incidentId);
  if (!incident) { await answer("Already closed."); return void (await edit("Already closed.")); }
  const mainKeyboard = { inline_keyboard: renderOps.incidentButtons(incident) };

  try {
    if (action === "r") {
      state.pendingIncidentResolve = { incidentId, expiresAt: Date.now() + 2 * 60 * 1000 };
      await writeState(user, state);
      await answer("Confirm incident resolution.");
      return void (await edit("Resolve this incident? This will close it in Stashr.", { inline_keyboard: [[{ text: "✅ Yes, resolve", callback_data: "ir:y:" + incidentId }, { text: "✖ Cancel", callback_data: "ir:n:" + incidentId }]] }));
    }
    const [accountId, ...rest] = String(incident.serviceKey).split(":");
    const serviceId = rest.join(":");
    const apiKey = accountId ? renderOps.accountApiKey(user, dataKey, accountId) : null;
    if (action === "x") { // ask first: a restart interrupts live traffic
      state.pendingIncidentRestart = { incidentId, expiresAt: Date.now() + 2 * 60 * 1000 };
      await writeState(user, state);
      await answer("Confirm the restart.");
      return void (await edit("Restart " + incident.serviceName + "? Live requests will be interrupted for a moment.", { inline_keyboard: [[{ text: "✅ Yes, restart", callback_data: "i:y:" + incidentId }, { text: "✖ Cancel", callback_data: "i:n:" + incidentId }]] }));
    }
    if (action === "n") { state.pendingIncidentRestart = null; await writeState(user, state); await answer("Cancelled."); return void (await edit("", mainKeyboard)); }
    if (action === "y" && (state.pendingIncidentRestart?.incidentId !== incidentId || Date.now() > Number(state.pendingIncidentRestart?.expiresAt || 0))) { await answer("Restart confirmation expired. Open the incident again.", true); return; }
    if (!apiKey || !/^[A-Za-z0-9_-]{1,160}$/.test(serviceId)) { await answer("This service is not connected any more.", true); return; }
    if (action === "y") {
      state.pendingIncidentRestart = null; await writeState(user, state);
      await renderOps.renderRequest(apiKey, "/v1/services/" + encodeURIComponent(serviceId) + "/restart", { method: "POST" });
      await audit(user, "service_restart", incident.serviceKey, { incident: incident.type });
      await answer("Restart requested.");
      return void (await edit("🔄 Restart requested. Press Check in a minute to verify it is healthy.", mainKeyboard));
    }
    if (action === "c") {
      await answer("Checking…");
      const raw = await renderOps.renderRequest(apiKey, "/v1/services/" + encodeURIComponent(serviceId));
      const service = raw?.service || raw;
      if (incident.type === "health") {
        const probe = await probeService(service);
        if (probe.state === "healthy") {
          await renderOps.resolveIncidents(user, { ids: [incidentId], reason: "Verified healthy by a check from Telegram" + (probe.status ? " (HTTP " + probe.status + ")" : "") + ".", by: "check" });
          return void (await edit("✅ Verified healthy" + (probe.status ? " (HTTP " + probe.status + ")" : "") + ". Incident closed."));
        }
        return void (await edit("❌ Still failing: " + (probe.message || probe.state) + " (" + new Date().toISOString().slice(11, 16) + " UTC)", mainKeyboard));
      }
      if (incident.type === "deploy_failure") {
        const deploys = await renderOps.renderRequest(apiKey, "/v1/services/" + encodeURIComponent(serviceId) + "/deploys?limit=1");
        const latest = (Array.isArray(deploys) ? deploys : []).map((d) => d?.deploy || d)[0];
        if (latest?.status === "live") {
          await renderOps.resolveIncidents(user, { ids: [incidentId], reason: "Verified by a check from Telegram: the latest deploy is live.", by: "check" });
          return void (await edit("✅ The latest deploy is live. Incident closed."));
        }
        return void (await edit("❌ Latest deploy: " + (latest?.status || "unknown"), mainKeyboard));
      }
      return void (await edit("ℹ️ This kind of alert closes itself when the next monitor round sees normal load. Press Resolve to close it now.", mainKeyboard));
    }
  } catch (error) {
    await answer("That did not work: " + (error?.message || "Render did not answer."), true);
  }
}

/* ---------- incoming messages ---------- */
async function handleUpdate(hookId, secret, update) {
  if (!/^[a-f0-9]{32}$/.test(String(hookId))) return;
  const user = await User.findOne({ telegramHookId: hookId });
  if (!user) return;
  const state = await readState(user);
  if (!state || !state.hookSecret || typeof secret !== "string" || secret.length !== state.hookSecret.length || !crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(state.hookSecret))) return;
  if (update?.callback_query) return void (await handleButton(user, state, update.callback_query));
  const msg = update?.message;
  if (!msg?.chat?.id || typeof msg.text !== "string") return;
  const chatId = msg.chat.id;
  const { cmd, args } = T.parseCommand(msg.text);
  const token = state.botToken;

  // Linking: /start <one-time code> from the chat that should receive everything.
  if (!state.chatId) {
    if (cmd === "start" && args[0] && state.linkCode && args[0] === state.linkCode && Date.now() < (state.linkExpires || 0)) {
      state.chatId = chatId; state.chatName = [msg.chat.first_name, msg.chat.last_name].filter(Boolean).join(" ") || msg.chat.title || "";
      state.linkedAt = new Date().toISOString(); state.linkCode = null;
      await writeState(user, state);
      await applyMode(user, state);
      await send(token, chatId, "✅ <b>Connected to Stashr.</b>\n" + T.UPDATE_MODES[modeOf(state)] + ". Change it any time with /updates.\n\n" + T.HELP, { reply_markup: T.MENU_KEYBOARD });
    } else await send(token, chatId, "This bot is private. Open the link from Stashr → Settings → Telegram to connect it.");
    return;
  }
  if (String(chatId) !== String(state.chatId)) { await send(token, chatId, "This bot is private."); return; }

  await withProgress(token, chatId, async () => {
  try {
    // Plain text while the bot is waiting for something: a PIN, or the name of a login.
    const text = msg.text.trim();
    const pend = pendingOf(state);
    if (!cmd && /^\d{4,8}$/.test(text)) {
      if (pend?.kind === "pin") return void (await completePassword(user, state, msg, pend));
      wipe(state, msg.message_id, 500); // a PIN typed by itself is never left in the chat
      return void (await send(token, chatId, "I wasn't waiting for a PIN. Tap 🔑 Passwords to look up a login."));
    }
    if (!cmd && pend?.kind === "name") return void (await startPassword(user, state, text));
    if (cmd && cmd !== "pass" && pend) await setPending(user, state, null);
    if (cmd === "start" || cmd === "help" || cmd === "menu") { setCommands(token); return void (await send(token, chatId, T.HELP, { reply_markup: T.MENU_KEYBOARD })); }
    if (cmd === "notifications") return void (await send(token, chatId, "<b>Telegram notifications</b>\\nEnabled categories: " + catalog.normalizeNotificationCategories(state.notificationCategories).map(T.esc).join(", ") + "\\nChange category preferences in Stashr → Settings → Telegram."));
    if (cmd === "report" || cmd === "week") {
      await send(token, chatId, "📊 Building your report…");
      const ok = await require("./homeReport").sendReport(user._id, { hours: cmd === "week" ? 168 : 24 });
      return void (ok || await send(token, chatId, "⚠️ Could not build the report right now."));
    }
    if (cmd === "events") return void (await send(token, chatId, await eventsText(user)));
    if (cmd === "devices" || cmd === "phones") return void (await send(token, chatId, await devicesText(user, cmd === "phones")));
    if (cmd === "home" || SHORTCUTS[cmd] || !cmd) {
      const sentence = cmd === "home" ? args.join(" ") : cmd ? SHORTCUTS[cmd](args) : text;
      if (cmd && !sentence.trim()) return void (await send(token, chatId, cmd === "scene" ? "Which scene? e.g. /scene movie night" : "Say what to do, e.g. /home pause the tv, /photo, /who, /volume 30."));
      const mutating = catalog.ACTION_COMMANDS.has(cmd) || (cmd === "home" && isLikelyHomeAction(sentence)) || (!cmd && isLikelyHomeAction(sentence));
      if (mutating) return void (await requestHomeAction(user, state, token, chatId, sentence));
      const said = await homeSay(user, sentence);
      if (said) return void (await send(token, chatId, said));
      if (!cmd) return void (await send(token, chatId, T.HELP, { reply_markup: T.MENU_KEYBOARD }));
    }
    if (cmd === "updates") return void (await send(token, chatId, "", updatesMessage(state)));
    if (cmd === "status") { const s = await snapshot(user); return void (await send(token, chatId, T.digestText(T.summarize(s), { projects: s.projects.filter((p) => p.status !== "archived").length, lastTick: s.lastTick }))); }
    if (cmd === "servers") { const s = await snapshot(user); return void (await send(token, chatId, T.serversText(s.services, s.health, s.pings))); }
    if (cmd === "incidents") { const s = await snapshot(user); return void (await send(token, chatId, T.incidentsText(s.incidents))); }
    if (cmd === "projects" || cmd === "project") {
      const s = await snapshot(user);
      const projects = s.projects.map((p) => ({ ...p, servers: Math.max((p.renderServices || []).length, p.renderServiceId ? 1 : 0) }));
      if (cmd === "projects" || !args.length) return void (await send(token, chatId, T.projectsText(projects)));
      const hits = T.findByName(projects, args.join(" "));
      if (!hits.length) return void (await send(token, chatId, "No project matches “" + T.esc(args.join(" ")) + "”."));
      if (hits.length > 1) return void (await send(token, chatId, "Which one?\n" + hits.slice(0, 10).map((p) => "• " + T.esc(p.name)).join("\n")));
      return void (await send(token, chatId, T.projectText(hits[0])));
    }
    const readReply = await runTelegramRead(user, cmd, args);
    if (readReply) return void (await send(token, chatId, readReply));
    if (cmd === "pass") return void (await handlePassword(user, state, msg, args));
    await send(token, chatId, "I don't know that command.\n\n" + T.HELP);
  } catch (err) {
    console.error("[telegram] command failed:", cmd || "(text)", err && err.message);
    await send(token, chatId, "⚠️ <b>That did not work.</b>\nThe server answered with an error" + (cmd ? " for /" + T.esc(cmd) : "") + ". Try again in a minute; /status tells you if the server itself is healthy.");
  }
  });
}

/**
 * Stashr Home from Telegram: the same assistant as the website and the tablet's microphone. Returns the reply text,
 * or null when this account has no home devices or the sentence was not understood (the caller then shows the help).
 */
async function eventsText(user) {
  const HomeEvent = require("../models/homeEvent");
  const list = await HomeEvent.find({ owner: user._id }).sort({ at: -1 }).limit(10).lean();
  if (!list.length) return "Nothing has happened at home yet.";
  const clock = (at) => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
  return "<b>🕑 Last 10 things at home</b>\n" + list.map((e) => clock(e.at) + " " + T.esc(e.text.slice(0, 100))).join("\n");
}

async function devicesText(user, phonesOnly) {
  const HomeDevice = require("../models/homeDevice");
  const home = require("./home");
  const list = (await HomeDevice.find({ owner: user._id }).lean()).filter((d) => !phonesOnly || d.kind === "phone");
  if (!list.length) return "No devices added to Stashr Home yet.";
  const icon = { tv: "📺", hub: "📟", phone: "📱" };
  const lines = list.map((d) => {
    const on = d.kind === "phone" ? Boolean(d.lastSeen) && Date.now() - new Date(d.lastSeen).getTime() < 75 * 60000 : Boolean(d.online) && home.isOnline(d);
    const b = home.batteryOf(d.status);
    const cam = d.kind === "hub" && d.status && d.status.camera ? ` · 📷 ${d.status.camera.error ? "⚠️ " + T.esc(String(d.status.camera.error).slice(0, 80)) : d.status.camera.armed ? "watching" : "off"}` : "";
    return `${on ? "🟢" : "⚪"} ${icon[d.kind] || "▫️"} ${T.esc(d.person || d.name)}${b ? ` 🔋${b.pct}%${b.charging ? "⚡" : ""}` : ""}${cam}${on ? "" : " — not reporting"}`;
  });
  return "<b>" + (phonesOnly ? "📱 Phones" : "🏠 Devices") + "</b>\n" + lines.join("\n");
}

async function requestHomeAction(user, state, token, chatId, sentence) {
  const actionToken = crypto.randomBytes(12).toString("hex");
  state.pendingAction = { token: actionToken, sentence: String(sentence).slice(0, 200), expiresAt: Date.now() + 2 * 60 * 1000 };
  await writeState(user, state);
  return send(token, chatId, "⚠️ <b>Confirm this Stashr Home action</b>\\n" + T.esc(sentence) + "\\n\\nThis request expires in 2 minutes.", {
    reply_markup: { inline_keyboard: [[{ text: "✅ Confirm and run", callback_data: "a:y:" + actionToken }, { text: "✖ Cancel", callback_data: "a:n:" + actionToken }]] }
  });
}
function isReadOnlyNatural(sentence) {
  return /^(who|who is|kaun|kaun ghar|kab aay|coming|today|aaj|status|devices|phones|battery|events|report|what|how|show|list|tell|where|kya|papa kab|mummy kab|internet speed|speed test)\b/i.test(String(sentence || "").trim());
}
function isLikelyHomeAction(sentence) {
  return /^(pause|play|resume|stop|start|turn|switch|set|open|close|mute|unmute|volume|next|previous|prev|take|record|camera|scan|sync|run|launch|netflix|youtube|music|scene|tv|light|fan|ac|pankha|batti|gaana|video|photo|chala|band|on|off|awaaz)\b/i.test(String(sentence || "").trim());
}

async function homeSay(user, sentence) {
  const HomeDevice = require("../models/homeDevice");
  if (!await HomeDevice.exists({ owner: user._id })) return null;
  const homeRouter = require("../router/home");
  const automation = require("./homeAutomation");
  if (/^\s*(stashr\s+)?(today|aaj)\b/i.test(sentence) || /\btoday updates?\b/i.test(sentence)) {
    const t = await automation.todayLines(user._id, await automation.settingsOf(user._id));
    return "<b>" + T.esc(t.title) + "</b>\n" + t.lines.map((l) => T.esc(l.icon + " " + l.text)).join("\n");
  }
  const out = await homeRouter.runSentence(user._id, String(sentence).slice(0, 200));
  if (out.error) return "⚠️ " + T.esc(out.error);
  if (/^I did not understand/.test(out.reply || "")) return null;
  return "🏠 " + T.esc(out.reply || "Done.") + (out.sent && out.sent.length ? "\nSent to " + T.esc(out.sent.map((x) => x.device).join(", ")) + "." : "");
}

/*
 * Passwords, in three taps: 🔑 Passwords -> type a name -> pick the login (if several) -> send your PIN.
 * The bot remembers what it is waiting for ("pending", 3 minutes), so the name and the PIN never share a message.
 * `/pass name PIN` in one line still works. The PIN message and the reply are deleted.
 */
const PENDING_MS = 3 * 60 * 1000;
const pendingOf = (state) => (state.pending && Date.now() < state.pending.expires ? state.pending : null);
async function setPending(user, state, pending) {
  state.pending = pending ? { ...pending, expires: Date.now() + PENDING_MS } : null;
  await writeState(user, state);
}
const wipe = (state, messageId, ms = 0) => setTimeout(() => { void tg(state.botToken, "deleteMessage", { chat_id: state.chatId, message_id: messageId }); }, ms).unref?.();
const passwordsOff = (state) => !state.passwordsAllowed || !state.pinHash;
const OFF_TEXT = "🔒 Passwords over Telegram are off. Turn them on (with a PIN) in Stashr → Settings → Telegram.";

async function savedLogins(user) {
  const dataKey = await user.getDataKey();
  return (user.passwords || []).filter((e) => e.enc === "udk").map((e) => ({ ...User.publicEntry(e, dataKey), _id: String(e._id) })).filter((i) => !i.broken);
}

/** True when the PIN is right. Wrong tries are counted and lock passwords for 15 minutes after five. */
async function checkPin(user, state, pin) {
  const { botToken: token, chatId } = state;
  if (Date.now() < (state.pinLockedUntil || 0)) { await send(token, chatId, "🔒 Too many wrong PINs. Try again after " + new Date(state.pinLockedUntil).toISOString().slice(11, 16) + " UTC."); return false; }
  const good = crypto.timingSafeEqual(Buffer.from(hashPin(pin, state.pinSalt), "hex"), Buffer.from(state.pinHash, "hex"));
  if (!good) {
    state.pinFails = (state.pinFails || 0) + 1;
    if (state.pinFails >= PIN_MAX_FAILS) { state.pinLockedUntil = Date.now() + PIN_LOCK_MS; state.pinFails = 0; }
    await writeState(user, state);
    await send(token, chatId, "❌ Wrong PIN." + (state.pinLockedUntil > Date.now() ? " Passwords are locked for 15 minutes." : ""));
    return false;
  }
  if (state.pinFails) { state.pinFails = 0; await writeState(user, state); }
  return true;
}

async function revealLogin(state, item) {
  const reply = await send(state.botToken, state.chatId, "🔑 <b>" + T.esc(item.name) + "</b>" + (item.url ? "\n" + T.esc(item.url) : "") + (item.username ? "\nUser: <code>" + T.esc(item.username) + "</code>" : "") + "\nPassword: <tg-spoiler><code>" + T.esc(item.password) + "</code></tg-spoiler>\n\n<i>This message deletes itself in 60 seconds.</i>", { protect_content: true });
  if (reply.ok) wipe(state, reply.result.message_id, PASSWORD_TTL_MS);
}

/** A name was given: no match, a button per match, or straight to asking for the PIN. */
async function startPassword(user, state, query) {
  const { botToken: token, chatId } = state;
  const hits = T.findByName(await savedLogins(user), query);
  if (!hits.length) { await setPending(user, state, { kind: "name" }); return void (await send(token, chatId, "No saved login matches “" + T.esc(query) + "”. Try another name:")); }
  if (hits.length > 1) {
    await setPending(user, state, { kind: "name" });
    return void (await send(token, chatId, "Which one?", { reply_markup: { inline_keyboard: hits.slice(0, 8).map((i) => [{ text: i.name + (i.username ? " · " + i.username : ""), callback_data: "p:" + i._id }]) } }));
  }
  await setPending(user, state, { kind: "pin", itemId: hits[0]._id });
  await send(token, chatId, "🔐 <b>" + T.esc(hits[0].name) + "</b> — send your PIN now. I delete it right away.");
}

/** The PIN arrived while a login was chosen. */
async function completePassword(user, state, msg, pend) {
  wipe(state, msg.message_id, 500);
  const pin = msg.text.trim();
  if (passwordsOff(state)) return void (await send(state.botToken, state.chatId, OFF_TEXT));
  if (!(await checkPin(user, state, pin))) return;
  const item = (await savedLogins(user)).find((i) => i._id === pend.itemId);
  await setPending(user, state, null);
  if (!item) return void (await send(state.botToken, state.chatId, "That login is gone. Tap 🔑 Passwords to search again."));
  await revealLogin(state, item);
}

/** 🔑 Passwords or /pass [name] [PIN]. */
async function handlePassword(user, state, msg, args) {
  const { botToken: token, chatId } = state;
  if (passwordsOff(state)) { wipe(state, msg.message_id, 1000); return void (await send(token, chatId, OFF_TEXT)); }
  const pin = args.length > 1 && /^\d{4,8}$/.test(args[args.length - 1]) ? args[args.length - 1] : "";
  const query = (pin ? args.slice(0, -1) : args).join(" ").trim();
  if (!query) { await setPending(user, state, { kind: "name" }); return void (await send(token, chatId, "🔑 Which login? Type a name, for example <i>gmail</i>.")); }
  if (!pin) return void (await startPassword(user, state, query));
  // One-line form: /pass name PIN
  wipe(state, msg.message_id, 1000);
  if (!(await checkPin(user, state, pin))) return;
  const hits = T.findByName(await savedLogins(user), query);
  if (!hits.length) return void (await send(token, chatId, "No saved login matches “" + T.esc(query) + "”."));
  if (hits.length > 1) return void (await send(token, chatId, "Several match — be more specific:\n" + hits.slice(0, 10).map((i) => "• " + T.esc(i.name) + (i.username ? " (" + T.esc(i.username) + ")" : "")).join("\n")));
  await revealLogin(state, hits[0]);
}

/* ---------- digests (scheduler) ---------- */
async function sendDigest(user, state, { force = false } = {}) {
  const s = await snapshot(user);
  const sum = T.summarize(s);
  if (!force && state.digestQuietWhenOk && !sum.problems.length) return false;
  const text = T.digestText(sum, { projects: s.projects.filter((p) => p.status !== "archived").length, lastTick: s.lastTick });
  const r = await send(state.botToken, state.chatId, text, { disable_notification: !sum.problems.length });
  return r.ok;
}

/* Bots connected before buttons existed only listened for messages: re-register them once per process. */
let hooksRefreshed = false;
async function refreshWebhooks() {
  const base = publicBase();
  if (hooksRefreshed || !base) return;
  hooksRefreshed = true;
  const users = await User.find({ telegramHookId: { $type: "string" } }, without("passwords", "projects", "renderMetricHistory", "renderIncidents", "renderAudit", "usageHistory")).limit(500);
  for (const user of users) {
    try {
      const state = await readState(user);
      if (state?.botToken && state.hookId && state.hookSecret) {
        await tg(state.botToken, "setWebhook", { url: base + "/telegram/webhook/" + state.hookId, secret_token: state.hookSecret, allowed_updates: ["message", "callback_query"] });
        await setCommands(state.botToken);
      }
    } catch { /* retried on the next restart */ }
  }
}

async function runAllDigests() {
  await refreshWebhooks().catch(() => {});
  const users = await User.find({ telegramHookId: { $type: "string" } }, without("passwords", "renderAudit", "usageHistory")).limit(500);
  let sent = 0, errors = 0;
  for (const user of users) {
    try {
      const state = await readState(user);
      if (!state?.chatId) continue;
      await flushNotificationQueue(user, state).catch(() => {});
      if (modeOf(state) !== "timer") continue;
      const every = DIGEST_CHOICES.includes(state.digestMinutes) ? state.digestMinutes : 10;
      if (state.lastDigestAt && Date.now() - Date.parse(state.lastDigestAt) < every * 60000 - 60000) continue;
      if (await sendDigest(user, state)) sent += 1;
      state.lastDigestAt = new Date().toISOString();
      await writeState(user, state);
    } catch { errors += 1; }
  }
  return { sent, errors };
}

async function sendTest(user) {
  const state = await readState(user);
  if (!state?.chatId) throw Object.assign(new Error("Connect the bot first."), { status: 400 });
  return sendDigest(user, state, { force: true });
}

/* One short message to the user's connected bot, for things Stashr Home notices (the TV came online, a new device on the Wi-Fi). */
const redactNotification = value => String(value || "").replace(/(bot\d+:[A-Za-z0-9_-]+)/g, "[redacted bot token]").replace(/(password|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]").slice(0, 3500);
async function notifyEvent(user, event = {}) {
  try {
    const state = await readState(user);
    if (!state?.chatId || !state.botToken || modeOf(state) === "ask") return false;
    const category = catalog.NOTIFICATION_CATEGORIES.includes(String(event.category || "system").toLowerCase()) ? String(event.category || "system").toLowerCase() : "system";
    if (!catalog.notificationsEnabled(state, category)) return false;
    const title = redactNotification(event.title || ""), body = redactNotification(event.text || event.body || "");
    if (!body) return false;
    const dedupeKey = event.dedupeKey ? crypto.createHash("sha256").update(String(event.dedupeKey)).digest("hex") : undefined;
    let row;
    try { row = await TelegramNotification.create({ owner: user._id, category, title, body: (title ? "<b>" + T.esc(title) + "</b>\\n" : "") + (event.html === false ? T.esc(body) : body), dedupeKey, status: "pending", attempts: 0, nextAttemptAt: new Date() }); }
    catch (error) { if (error?.code === 11000) return false; throw error; }
    const result = await send(state.botToken, state.chatId, row.body);
    await TelegramNotification.updateOne({ _id: row._id }, { $set: { status: result.ok ? "sent" : "pending", attempts: 1, sentAt: result.ok ? new Date() : null, nextAttemptAt: new Date(Date.now() + 60000), lastError: result.ok ? "" : "Telegram delivery failed" } });
    return result.ok;
  } catch { return false; }
}
async function notifyUser(user, text, options = {}) { return notifyEvent(user, { category: options.category || "home", text, html: true, dedupeKey: options.dedupeKey }); }
async function notifySystemEvent(event = {}) {
  try { const users = await User.find({ telegramHookId: { $type: "string" } }, without("passwords","projects","renderMetricHistory","renderIncidents","renderAudit","usageHistory")).limit(500); let sent = 0; for (const user of users) if (await notifyEvent(user, event)) sent += 1; return { sent, users: users.length }; }
  catch { return { sent: 0, users: 0 }; }
}
async function flushNotificationQueue(user, state) {
  if (!state?.chatId || !state.botToken || modeOf(state) === "ask") return 0;
  const rows = await TelegramNotification.find({ owner: user._id, status: "pending", nextAttemptAt: { $lte: new Date() }, attempts: { $lt: 6 } }).sort({ createdAt: 1 }).limit(20);
  let sent = 0;
  for (const row of rows) {
    if (!catalog.notificationsEnabled(state, row.category)) continue;
    const result = await send(state.botToken, state.chatId, row.body), attempts = Number(row.attempts || 0) + 1;
    await TelegramNotification.updateOne({ _id: row._id }, { $set: { status: result.ok ? "sent" : (attempts >= 6 ? "failed" : "pending"), attempts, sentAt: result.ok ? new Date() : null, nextAttemptAt: new Date(Date.now() + Math.min(3600000, 2 ** attempts * 60000)), lastError: result.ok ? "" : "Telegram delivery failed" } });
    if (result.ok) sent += 1;
  }
  return sent;
}
async function notificationHistory(user) {
  const rows = await TelegramNotification.find({ owner: user._id }).sort({ createdAt: -1 }).limit(30).select("category title status attempts sentAt createdAt").lean();
  return rows.map(row => ({ category: row.category, title: row.title, status: row.status, attempts: row.attempts, sentAt: row.sentAt, createdAt: row.createdAt }));
}

/** A photo or a short video to your chat (the tablet camera saw movement). Never throws. */
async function notifyUserMedia(user, { kind, buffer, filename, caption, contentType }) {
  try {
    const s = await readState(user);
    if (!s || !s.chatId || !s.botToken) return false;
    const form = new FormData();
    form.append("chat_id", String(s.chatId));
    form.append("caption", String(caption || "").slice(0, 1000));
    form.append(kind === "video" ? "video" : "photo", new Blob([buffer], { type: contentType || (kind === "video" ? "video/mp4" : "image/jpeg") }), filename || (kind === "video" ? "clip.mp4" : "photo.jpg"));
    const res = await fetch(API + s.botToken + "/" + (kind === "video" ? "sendVideo" : "sendPhoto"), { method: "POST", body: form, signal: AbortSignal.timeout(60000) });
    const json = await res.json().catch(() => ({}));
    return Boolean(json.ok);
  } catch { return false; }
}

module.exports = { homeSay, notifyUser, notifyEvent, notifySystemEvent, notificationHistory, notifyUserMedia, modeOf, MODES, connect, disconnect, updateSettings, readState, publicState, handleUpdate, runAllDigests, sendTest, DIGEST_CHOICES, isValidHookId: (id) => mongoose.isValidObjectId(id) || /^[a-f0-9]{32}$/.test(String(id)), withProgress, send };
