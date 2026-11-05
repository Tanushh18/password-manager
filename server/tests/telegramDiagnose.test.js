const { describe, test, before: beforeAll, after: afterAll, beforeEach } = require("node:test");
const expect = require("./expect");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const request = require("supertest");

process.env.SECRET_KEY = "test-secret"; process.env.CRYPTO_SECRET_KEY = "test-crypto-secret"; process.env.RATE_LIMIT_MAX = "1000"; process.env.ALLOW_SIGNUP = "true"; delete process.env.YOUTUBE_API_KEY; process.env.HOME_ROUTING = "off";
const app = require("../app");
const User = require("../models/schema");
const HomeSettings = require("../models/homeSettings");
const TelegramNotification = require("../models/TelegramNotification");
const bot = require("../utils/telegramBot");

describe("why Telegram updates do not arrive, and the one-press fix", () => {
    let mongo, realFetch, calls, tokenOk = true;
    beforeAll(async () => {
        mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
        realFetch = global.fetch;
        global.fetch = async (url, opts) => {
            const method = String(url).split("/").pop();
            calls.push({ method, body: JSON.parse((opts && opts.body) || "{}") });
            if (method === "getMe") return { status: tokenOk ? 200 : 401, json: async () => (tokenOk ? { ok: true, result: { username: "stashr_bot" } } : { ok: false, description: "Unauthorized" }) };
            return { status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
        };
    });
    afterAll(async () => { global.fetch = realFetch; await mongoose.disconnect(); await mongo.stop(); });
    beforeEach(async () => { calls = []; tokenOk = true; for (const M of [User, HomeSettings, TelegramNotification]) await M.deleteMany({}); });

    const signUp = async () => {
        await request(app).post("/register").send({ name: "Ana", email: "ana@example.com", password: "master-pass", cpassword: "master-pass" });
        const r = await request(app).post("/login").send({ email: "ana@example.com", password: "master-pass", client: "mobile" });
        return { auth: { Authorization: `Bearer ${r.body.token}` }, user: await User.findOne({ email: "ana@example.com" }) };
    };
    const connectBot = async (user, fields) => {
        const key = await user.getDataKey();
        const entry = { enc: "udk", data: User.sealEntry(key, { botToken: "123:abc", hookId: "a".repeat(32), hookSecret: "s".repeat(48), chatId: 777, chatName: "Tanush", botUsername: "stashr_bot", digestMinutes: 10, ...fields }), createdAt: new Date(), updatedAt: new Date() };
        await User.updateOne({ _id: user._id }, { $set: { telegram: [entry], telegramHookId: "a".repeat(32) } });
        return User.findById(user._id);
    };
    const failing = (r, id) => r.checks.find((c) => c.id === id);

    test("no bot connected says so", async () => {
        const { user } = await signUp();
        const r = await bot.diagnose(user);
        expect(r.ready).toBe(false);
        expect(r.checks[0].text).toMatch(/No Telegram bot is connected/);
    });

    test("'ask' mode, the home category off and the home switch off are each named; Fix it turns them on and sends a test", async () => {
        const { auth, user } = await signUp();
        const u = await connectBot(user, { updates: "ask", notificationCategories: ["system"] });
        await HomeSettings.create({ owner: user._id, alerts: { everything: false } });
        const before = await bot.diagnose(u);
        expect(before.ready).toBe(false);
        expect(failing(before, "mode").ok).toBe(false);
        expect(failing(before, "mode").text).toMatch(/OFF/);
        expect(failing(before, "category").ok).toBe(false);
        expect(failing(before, "everything").ok).toBe(false);
        expect(failing(before, "token").ok).toBe(true);
        const fixed = await request(app).post("/telegram/repair").set(auth);
        expect(fixed.status).toBe(200);
        expect(fixed.body.sent).toBe(true);
        expect(fixed.body.ready).toBe(true);
        expect(calls.some((c) => c.method === "sendMessage" && /Telegram updates are on/.test(c.body.text))).toBe(true);
        const after = await request(app).get("/telegram/diagnose").set(auth);
        expect(after.body.checks.every((c) => c.ok)).toBe(true);
        expect((await HomeSettings.findOne({ owner: user._id }).lean()).alerts.everything).toBe(true);
    });

    test("a token Telegram rejects and a failed delivery are shown with the reason", async () => {
        const { user } = await signUp();
        const u = await connectBot(user, { updates: "alerts" });
        tokenOk = false;
        await TelegramNotification.create({ owner: user._id, category: "home", body: "x", status: "pending", attempts: 3, lastError: "Telegram delivery failed" });
        const r = await bot.diagnose(u);
        expect(failing(r, "token").ok).toBe(false);
        expect(failing(r, "token").text).toMatch(/Unauthorized/);
        expect(failing(r, "delivery").ok).toBe(false);
        expect(failing(r, "delivery").text).toMatch(/1 not delivered \(Telegram delivery failed\)/);
    });

    test("only the owner can ask; repair without a connected chat is refused", async () => {
        const { auth } = await signUp();
        expect((await request(app).get("/telegram/diagnose")).status).toBe(401);
        expect((await request(app).post("/telegram/repair").set(auth)).status).toBe(400);
    });
});
