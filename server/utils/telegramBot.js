const crypto = require("crypto");
const mongoose = require("mongoose");
const User = require("../models/schema");
const renderOps = require("./renderOps");
const { openEvents } = require("./incidentFold");
const { pingResults } = require("./pings");
const T = require("./telegramText");

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
const DIGEST_CHOICES = [0, 5, 10, 15, 30, 60];

async function tg(token, method, body) {
  try {
    const res = await fetch(API + token + "/" + method, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(15000) });
    const json = await res.json().catch(() => ({}));
    return json.ok ? { ok: true, result: json.result } : { ok: false, error: json.description || "Telegram error " + res.status };
  } catch { return { ok: false, error: "Telegram did not answer." }; }
}
const send = (token, chatId, text, extra = {}) => tg(token, "sendMessage", { chat_id: chatId, text: String(text).slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true, ...extra });

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
  digestMinutes: s.digestMinutes ?? 10, digestQuietWhenOk: Boolean(s.digestQuietWhenOk),
  passwordsAllowed: Boolean(s.passwordsAllowed), pinSet: Boolean(s.pinHash), lastDigestAt: s.lastDigestAt || null
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
  const hook = await tg(token, "setWebhook", { url: base + "/telegram/webhook/" + state.hookId, secret_token: state.hookSecret, allowed_updates: ["message"], drop_pending_updates: true });
  if (!hook.ok) throw Object.assign(new Error("Could not register the bot webhook: " + hook.error), { status: 502 });
  await tg(token, "setMyCommands", { commands: [["status", "Everything in one message"], ["servers", "Every server and its health"], ["incidents", "Open incidents"], ["projects", "Your projects"], ["project", "One project: /project name"], ["pass", "A password: /pass name PIN"], ["help", "What I can do"]].map(([command, description]) => ({ command, description })) });
  await writeState(user, state);
  if (state.chatId) await syncAlertChannel(user, token, state.chatId);
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
  if (input.digestMinutes !== undefined) state.digestMinutes = DIGEST_CHOICES.includes(Number(input.digestMinutes)) ? Number(input.digestMinutes) : 10;
  if (input.digestQuietWhenOk !== undefined) state.digestQuietWhenOk = input.digestQuietWhenOk === true;
  if (input.pin !== undefined) {
    if (!/^\d{4,8}$/.test(String(input.pin))) throw Object.assign(new Error("The PIN must be 4 to 8 digits."), { status: 400 });
    state.pinSalt = crypto.randomBytes(16).toString("hex");
    state.pinHash = hashPin(input.pin, state.pinSalt);
    state.pinFails = 0; state.pinLockedUntil = 0;
  }
  if (input.passwordsAllowed !== undefined) {
    if (input.passwordsAllowed === true && !state.pinHash) throw Object.assign(new Error("Set a PIN first."), { status: 400 });
    state.passwordsAllowed = input.passwordsAllowed === true;
  }
  await writeState(user, state);
  return publicState(state);
}

/* ---------- the data the bot reports ---------- */
async function snapshot(user) {
  const dataKey = await user.getDataKey();
  const listed = (user.renderAccounts || []).length ? await renderOps.listEveryService(user, dataKey) : { services: [] };
  const services = listed.services.map((s) => ({ ...s, key: s.accountId + ":" + s.id }));
  const health = new Map();
  const history = renderOps.encryptedList(user, "renderMetricHistory", dataKey, 200).sort((a, b) => Date.parse(a.sampledAt) - Date.parse(b.sampledAt));
  for (const sample of history) for (const r of sample.services || []) if (r?.key) health.set(r.key, { state: r.health?.state, status: r.health?.status, at: sample.sampledAt, deploy: r.latestDeploy?.status || "" });
  const incidents = openEvents(renderOps.encryptedList(user, "renderIncidents", dataKey, 200));
  const projects = (user.projects || []).filter((e) => e.enc === "udk").map((e) => User.publicEntry(e, dataKey)).filter((p) => !p.broken);
  return { services, health, incidents, pings: pingResults(user._id), projects, lastTick: history.length ? history[history.length - 1].sampledAt : null };
}

/* ---------- incoming messages ---------- */
async function handleUpdate(hookId, secret, update) {
  if (!/^[a-f0-9]{32}$/.test(String(hookId))) return;
  const user = await User.findOne({ telegramHookId: hookId });
  if (!user) return;
  const state = await readState(user);
  if (!state || !state.hookSecret || typeof secret !== "string" || secret.length !== state.hookSecret.length || !crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(state.hookSecret))) return;
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
      await syncAlertChannel(user, token, chatId);
      await send(token, chatId, "✅ <b>Connected to Stashr.</b>\nYou will get incident alerts here and a status update every " + (state.digestMinutes || 10) + " minutes.\n\n" + T.HELP);
    } else await send(token, chatId, "This bot is private. Open the link from Stashr → Settings → Telegram to connect it.");
    return;
  }
  if (String(chatId) !== String(state.chatId)) { await send(token, chatId, "This bot is private."); return; }

  try {
    if (cmd === "start" || cmd === "help" || !cmd) return void (await send(token, chatId, T.HELP));
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
    if (cmd === "pass") return void (await handlePassword(user, state, msg, args));
    await send(token, chatId, "I don't know that command.\n\n" + T.HELP);
  } catch { await send(token, chatId, "Something went wrong reading your data. Try again in a minute."); }
}

async function handlePassword(user, state, msg, args) {
  const { botToken: token, chatId } = state;
  const wipe = (messageId, ms = 0) => setTimeout(() => { void tg(token, "deleteMessage", { chat_id: chatId, message_id: messageId }); }, ms).unref?.();
  wipe(msg.message_id, 1000); // the message may contain the PIN: never leave it in the chat
  if (!state.passwordsAllowed || !state.pinHash) return void (await send(token, chatId, "🔒 Passwords over Telegram are off. Turn them on (with a PIN) in Stashr → Settings → Telegram."));
  if (Date.now() < (state.pinLockedUntil || 0)) return void (await send(token, chatId, "🔒 Too many wrong PINs. Try again after " + new Date(state.pinLockedUntil).toISOString().slice(11, 16) + " UTC."));
  const pin = args.length > 1 && /^\d{4,8}$/.test(args[args.length - 1]) ? args[args.length - 1] : "";
  const query = (pin ? args.slice(0, -1) : args).join(" ");
  if (!query || !pin) return void (await send(token, chatId, "Usage: /pass <i>name</i> <i>PIN</i> — for example /pass gmail 1234"));
  const good = crypto.timingSafeEqual(Buffer.from(hashPin(pin, state.pinSalt), "hex"), Buffer.from(state.pinHash, "hex"));
  if (!good) {
    state.pinFails = (state.pinFails || 0) + 1;
    if (state.pinFails >= PIN_MAX_FAILS) { state.pinLockedUntil = Date.now() + PIN_LOCK_MS; state.pinFails = 0; }
    await writeState(user, state);
    return void (await send(token, chatId, "❌ Wrong PIN." + (state.pinLockedUntil > Date.now() ? " Passwords are locked for 15 minutes." : "")));
  }
  if (state.pinFails) { state.pinFails = 0; await writeState(user, state); }
  const dataKey = await user.getDataKey();
  const items = (user.passwords || []).filter((e) => e.enc === "udk").map((e) => User.publicEntry(e, dataKey)).filter((i) => !i.broken);
  const hits = T.findByName(items, query);
  if (!hits.length) return void (await send(token, chatId, "No saved login matches “" + T.esc(query) + "”."));
  if (hits.length > 1) return void (await send(token, chatId, "Several match — be more specific:\n" + hits.slice(0, 10).map((i) => "• " + T.esc(i.name) + (i.username ? " (" + T.esc(i.username) + ")" : "")).join("\n")));
  const item = hits[0];
  const reply = await send(token, chatId, "🔑 <b>" + T.esc(item.name) + "</b>" + (item.url ? "\n" + T.esc(item.url) : "") + (item.username ? "\nUser: <code>" + T.esc(item.username) + "</code>" : "") + "\nPassword: <tg-spoiler><code>" + T.esc(item.password) + "</code></tg-spoiler>\n\n<i>This message deletes itself in 60 seconds.</i>", { protect_content: true });
  if (reply.ok) wipe(reply.result.message_id, PASSWORD_TTL_MS);
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

async function runAllDigests() {
  const users = await User.find({ telegramHookId: { $type: "string" } }).limit(500);
  let sent = 0, errors = 0;
  for (const user of users) {
    try {
      const state = await readState(user);
      if (!state?.chatId || !state.digestMinutes) continue;
      if (state.lastDigestAt && Date.now() - Date.parse(state.lastDigestAt) < state.digestMinutes * 60000 - 60000) continue;
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

module.exports = { connect, disconnect, updateSettings, readState, publicState, handleUpdate, runAllDigests, sendTest, DIGEST_CHOICES, isValidHookId: (id) => mongoose.isValidObjectId(id) || /^[a-f0-9]{32}$/.test(String(id)) };
