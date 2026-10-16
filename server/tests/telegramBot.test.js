const { describe, test, beforeEach } = require("node:test");
const expect = require("./expect");
const Module = require("node:module");
const crypto = require("crypto");

let stored, users, sent, deleted;
const UserStub = {
  publicEntry: (entry) => ({ ...(entry.data?.sealed ?? entry.fields), _id: entry._id }),
  sealEntry: (key, fields) => ({ sealed: JSON.parse(JSON.stringify(fields)) }),
  updateOne: async (filter, update) => { if (update.$set?.telegram) { stored = update.$set.telegram[0]; users[0].telegram = [stored]; } },
  findOne: async (q) => users.find((u) => u.telegramHookId === q.telegramHookId) || null,
  find: () => ({ limit: async () => users })
};
const originalLoad = Module._load;
Module._load = function (request) {
  if (request.endsWith("/models/schema")) return UserStub;
  if (request === "./renderOps") return { readConfig: async () => ({ monitor: {}, notifications: {} }), normalizeConfig: (a, b) => ({ ...b, ...a }), saveConfig: async () => {}, listEveryService: async () => ({ services: [] }), encryptedList: () => [] };
  if (request === "./pings") return { pingResults: () => ({}) };
  return originalLoad.apply(this, arguments);
};
const bot = require("../utils/telegramBot");
Module._load = originalLoad;

global.fetch = async (url, opts) => {
  const method = url.split("/").pop();
  const body = JSON.parse(opts.body || "{}");
  if (method === "sendMessage") sent.push(body);
  if (method === "deleteMessage") deleted.push(body.message_id);
  return { json: async () => ({ ok: true, result: { message_id: 99 } }), status: 200 };
};

const HOOK = "a".repeat(32), SECRET = "s".repeat(48);
const salt = "salt";
const pinHash = crypto.scryptSync("4321", salt, 32).toString("hex");
const makeUser = (state) => ({
  _id: "u1", telegramHookId: HOOK, getDataKey: async () => "k",
  telegram: [{ enc: "udk", fields: { botToken: "t", hookId: HOOK, hookSecret: SECRET, digestMinutes: 10, ...state } }],
  passwords: [{ enc: "udk", fields: { name: "Gmail", username: "me@x.com", password: "hunter2", url: "https://mail.google.com" } }],
  projects: [], renderAccounts: []
});
const msg = (text, chatId = 777) => ({ message: { message_id: 5, chat: { id: chatId, first_name: "T" }, text } });
const wait = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => { sent = []; deleted = []; stored = null; });

describe("telegram bot security", () => {
  test("a wrong secret header is ignored completely", async () => {
    users = [makeUser({ chatId: 777 })];
    await bot.handleUpdate(HOOK, "wrong-secret-wrong-secret-wrong-secret-wrong-se", msg("/status"));
    expect(sent.length).toBe(0);
  });

  test("linking needs the one-time code; afterwards other chats get nothing", async () => {
    users = [makeUser({ linkCode: "code123", linkExpires: Date.now() + 60000 })];
    await bot.handleUpdate(HOOK, SECRET, msg("/start nope", 1));
    expect(sent[0].text.includes("private")).toBe(true);
    await bot.handleUpdate(HOOK, SECRET, msg("/start code123", 777));
    expect(stored.data.sealed.chatId).toBe(777);
    expect(sent[1].text.includes("Connected")).toBe(true);
    await bot.handleUpdate(HOOK, SECRET, msg("/pass gmail 4321", 555));
    expect(sent[2].text).toBe("This bot is private.");
  });

  test("passwords: off by default, need the right PIN, the reply and the PIN message are deleted", async () => {
    users = [makeUser({ chatId: 777 })];
    await bot.handleUpdate(HOOK, SECRET, msg("/pass gmail 4321"));
    expect(sent[0].text.includes("off")).toBe(true);
    users = [makeUser({ chatId: 777, passwordsAllowed: true, pinHash, pinSalt: salt })];
    await bot.handleUpdate(HOOK, SECRET, msg("/pass gmail 0000"));
    expect(sent[1].text.includes("Wrong PIN")).toBe(true);
    expect(sent.some((m) => m.text.includes("hunter2"))).toBe(false);
    await bot.handleUpdate(HOOK, SECRET, msg("/pass gmail 4321"));
    const reply = sent[sent.length - 1];
    expect(reply.text.includes("hunter2")).toBe(true);
    expect(reply.protect_content).toBe(true);
    await new Promise((r) => setTimeout(r, 1100));
    expect(deleted.includes(5)).toBe(true); // the message that carried the PIN
  });

  test("five wrong PINs lock passwords for 15 minutes", async () => {
    users = [makeUser({ chatId: 777, passwordsAllowed: true, pinHash, pinSalt: salt })];
    for (let i = 0; i < 5; i++) { await bot.handleUpdate(HOOK, SECRET, msg("/pass gmail 1111")); }
    expect(stored.data.sealed.pinLockedUntil > Date.now()).toBe(true);
    await bot.handleUpdate(HOOK, SECRET, msg("/pass gmail 4321"));
    expect(sent[sent.length - 1].text.includes("locked") || sent[sent.length - 1].text.includes("Too many")).toBe(true);
    expect(sent.some((m) => m.text.includes("hunter2"))).toBe(false);
    await wait();
  });
});

describe("telegram: when the bot speaks on its own", () => {
  test("timed updates are off by default; only the 'timer' mode sends them", async () => {
    for (const updates of [undefined, "alerts", "ask"]) {
      users = [makeUser({ chatId: 777, ...(updates ? { updates } : {}) })];
      sent = [];
      const r = await bot.runAllDigests();
      expect(r.sent).toBe(0);
      expect(sent.length).toBe(0);
    }
    users = [makeUser({ chatId: 777, updates: "timer", digestMinutes: 30 })];
    sent = [];
    expect((await bot.runAllDigests()).sent).toBe(1);
    expect(sent.length).toBe(1);
    // not again inside the chosen interval (the first run recorded when it sent)
    expect((await bot.runAllDigests()).sent).toBe(0);
  });

  test("the mode is validated, and older settings read as 'alerts'", async () => {
    expect(bot.modeOf({})).toBe("alerts");
    expect(bot.modeOf({ updates: "nonsense" })).toBe("alerts");
    expect(bot.modeOf({ updates: "ask" })).toBe("ask");
    users = [makeUser({ chatId: 777 })];
    const s = await bot.updateSettings(users[0], { updates: "timer", digestMinutes: 17 });
    expect(s.updates).toBe("timer");
    expect(s.digestMinutes).toBe(10); // 17 is not a choice
    expect((await bot.updateSettings(users[0], { updates: "bogus" })).updates).toBe("alerts");
  });

  test("/updates shows the choices, and the buttons change the mode", async () => {
    users = [makeUser({ chatId: 777 })];
    await bot.handleUpdate(HOOK, SECRET, msg("/updates"));
    const kb = sent[0].reply_markup.inline_keyboard;
    expect(sent[0].text.includes("Alerts only")).toBe(true);
    expect(kb.flat().map((b) => b.callback_data)).toEqual(["u:ask", "u:alerts", "u:timer:10", "u:timer:30", "u:timer:60"]);
    await bot.handleUpdate(HOOK, SECRET, { callback_query: { id: "q1", data: "u:timer:30", message: { chat: { id: 777 }, message_id: 8, text: "x" } } });
    expect(stored.data.sealed.updates).toBe("timer");
    expect(stored.data.sealed.digestMinutes).toBe(30);
    // another chat cannot press them
    await bot.handleUpdate(HOOK, SECRET, { callback_query: { id: "q2", data: "u:ask", message: { chat: { id: 1 }, message_id: 8, text: "x" } } });
    expect(stored.data.sealed.updates).toBe("timer");
  });

  test("the menu buttons run their commands, and /menu brings the keyboard back", async () => {
    users = [makeUser({ chatId: 777 })];
    await bot.handleUpdate(HOOK, SECRET, msg("❓ Help"));
    expect(sent[0].reply_markup.keyboard.flat().map((b) => b.text)).toEqual(["📊 Status", "🖥 Servers", "🚨 Incidents", "📁 Projects", "🔑 Passwords", "🔔 Updates", "❓ Help"]);
    await bot.handleUpdate(HOOK, SECRET, msg("🔔 Updates"));
    expect(sent[1].text.includes("When should I message you")).toBe(true);
    await bot.handleUpdate(HOOK, SECRET, msg("/menu"));
    expect(sent[2].reply_markup.keyboard.length).toBe(4);
  });
});

describe("telegram: passwords in three taps", () => {
  const ready = (extra = {}) => makeUser({ chatId: 777, passwordsAllowed: true, pinHash, pinSalt: salt, ...extra });
  const two = () => { const u = ready(); u.passwords.push({ _id: "b".repeat(24), enc: "udk", fields: { name: "Gmail work", username: "w@x.com", password: "work-pass" } }); u.passwords[0]._id = "a".repeat(24); return u; };

  test("🔑 Passwords asks for a name, then for the PIN, then shows the login; the PIN message is deleted", async () => {
    users = [ready()]; users[0].passwords[0]._id = "a".repeat(24);
    await bot.handleUpdate(HOOK, SECRET, msg("🔑 Passwords"));
    expect(sent[0].text.includes("Which login")).toBe(true);
    await bot.handleUpdate(HOOK, SECRET, msg("gmail"));
    expect(sent[1].text.includes("send your PIN")).toBe(true);
    expect(sent.some((m) => m.text.includes("hunter2"))).toBe(false);
    await bot.handleUpdate(HOOK, SECRET, { message: { message_id: 42, chat: { id: 777 }, text: "4321" } });
    expect(sent[sent.length - 1].text.includes("hunter2")).toBe(true);
    expect(sent[sent.length - 1].protect_content).toBe(true);
    await new Promise((r) => setTimeout(r, 700));
    expect(deleted.includes(42)).toBe(true);
  });

  test("several matches become buttons, and tapping one asks for the PIN", async () => {
    users = [two()];
    await bot.handleUpdate(HOOK, SECRET, msg("/pass mail"));
    const buttons = sent[0].reply_markup.inline_keyboard.flat();
    expect(buttons.map((b) => b.callback_data)).toEqual(["p:" + "a".repeat(24), "p:" + "b".repeat(24)]);
    await bot.handleUpdate(HOOK, SECRET, { callback_query: { id: "q", data: "p:" + "b".repeat(24), message: { chat: { id: 777 }, message_id: 8, text: "x" } } });
    expect(sent[1].text.includes("Gmail work")).toBe(true);
    await bot.handleUpdate(HOOK, SECRET, msg("4321"));
    expect(sent[sent.length - 1].text.includes("work-pass")).toBe(true);
  });

  test("a wrong PIN shows nothing; a PIN sent with no login chosen is deleted and ignored; the old one-line form still works", async () => {
    users = [ready()]; users[0].passwords[0]._id = "a".repeat(24);
    await bot.handleUpdate(HOOK, SECRET, msg("/pass gmail"));
    await bot.handleUpdate(HOOK, SECRET, msg("0000"));
    expect(sent[sent.length - 1].text.includes("Wrong PIN")).toBe(true);
    expect(sent.some((m) => m.text.includes("hunter2"))).toBe(false);
    users = [ready()]; users[0].passwords[0]._id = "a".repeat(24); sent = []; deleted = [];
    await bot.handleUpdate(HOOK, SECRET, { message: { message_id: 61, chat: { id: 777 }, text: "4321" } });
    expect(sent[0].text.includes("wasn't waiting")).toBe(true);
    expect(sent.some((m) => m.text.includes("hunter2"))).toBe(false);
    await new Promise((r) => setTimeout(r, 700));
    expect(deleted.includes(61)).toBe(true);
    await bot.handleUpdate(HOOK, SECRET, msg("/pass gmail 4321"));
    expect(sent[sent.length - 1].text.includes("hunter2")).toBe(true);
  });

  test("with passwords off, the menu button just says so", async () => {
    users = [makeUser({ chatId: 777 })];
    await bot.handleUpdate(HOOK, SECRET, msg("🔑 Passwords"));
    expect(sent[0].text.includes("off")).toBe(true);
  });
});
