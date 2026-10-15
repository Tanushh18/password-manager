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
