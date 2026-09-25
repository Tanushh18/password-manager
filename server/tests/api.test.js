const { describe, test, before: beforeAll, after: afterAll, beforeEach } = require("node:test");
const expect = require("./expect");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const request = require("supertest");

process.env.SECRET_KEY = "test-secret";
process.env.CRYPTO_SECRET_KEY = "test-crypto-secret";
process.env.RATE_LIMIT_MAX = "1000";

const app = require("../app");
const User = require("../models/schema");
const totp = require("../utils/totp");
const { encrypt } = require("../models/EncDecManager");

let mongo;
beforeAll(async () =>
{
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
});
afterAll(async () =>
{
    await mongoose.disconnect();
    await mongo.stop();
});
beforeEach(async () => { await User.deleteMany({}); });

// Any syntactically valid blob works: the server never reads e2e data.
const blob = (tag = "x") => `v1:${Buffer.from(`iv-${tag}`).toString("base64")}:${Buffer.from(`ct-${tag}-payload`).toString("base64")}`;
const KDF = { salt: Buffer.from("0123456789abcdef").toString("base64"), iterations: 600000 };

const register = (body = {}) =>
    request(app).post("/register").send({ name: "Ana", email: "Ana@Example.com", password: "master-pass", cpassword: "master-pass", kdf: KDF, keyCheck: blob("check"), ...body });

const login = async (body = {}) =>
{
    const res = await request(app).post("/login").send({ email: "ana@example.com", password: "master-pass", client: "mobile", ...body });
    return res;
};
const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe("health", () =>
{
    test("GET /health is public", async () =>
    {
        const res = await request(app).get("/health");
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("ok");
        expect(res.headers["x-powered-by"]).toBeUndefined();
    });
});

describe("auth", () =>
{
    test("register validates input", async () =>
    {
        expect((await register({ password: "short", cpassword: "short" })).status).toBe(400);
        expect((await register({ cpassword: "different" })).status).toBe(400);
        expect((await register({ kdf: { salt: "!!", iterations: 5 } })).status).toBe(400);
        expect((await register()).status).toBe(201);
        expect((await register()).status).toBe(400); // duplicate
    });

    test("login returns vault settings and a token only for mobile", async () =>
    {
        await register();
        const bad = await login({ password: "nope" });
        expect(bad.status).toBe(400);

        const res = await login();
        expect(res.status).toBe(200);
        expect(res.body.token).toBeTruthy();
        expect(res.body.vault.kdf).toEqual(KDF);

        const web = await request(app).post("/login").send({ email: "ana@example.com", password: "master-pass" });
        expect(web.body.token).toBeUndefined();
        expect(web.headers["set-cookie"][0]).toMatch(/jwtoken=.*HttpOnly/);
    });

    test("/authenticate never exposes secrets", async () =>
    {
        await register();
        const { body } = await login();
        const me = await request(app).get("/authenticate").set(auth(body.token));
        expect(me.status).toBe(200);
        const text = JSON.stringify(me.body);
        expect(text).not.toMatch(/\$2[aby]\$/); // bcrypt hash
        expect(me.body.tokens).toBeUndefined();
        expect(me.body.twoFactor).toBeUndefined();
    });

    test("logout revokes the token", async () =>
    {
        await register();
        const { body } = await login();
        await request(app).get("/logout").set(auth(body.token));
        expect((await request(app).get("/authenticate").set(auth(body.token))).status).toBe(401);
    });
});

describe("end-to-end vault", () =>
{
    test("create, update, bulk import and delete blobs", async () =>
    {
        await register();
        const { token } = (await login()).body;

        expect((await request(app).post("/vault/items").set(auth(token)).send({ data: "plain text" })).status).toBe(400);

        const created = await request(app).post("/vault/items").set(auth(token)).send({ data: blob("a") });
        expect(created.status).toBe(201);
        const id = created.body.item._id;

        const updated = await request(app).put(`/vault/items/${id}`).set(auth(token)).send({ data: blob("b") });
        expect(updated.status).toBe(200);

        const bulk = await request(app).post("/vault/items/bulk").set(auth(token)).send({ items: [{ data: blob("c") }, { data: blob("d") }] });
        expect(bulk.status).toBe(201);

        let me = await request(app).get("/authenticate").set(auth(token));
        expect(me.body.passwords).toHaveLength(3);
        expect(me.body.passwords.find((p) => p._id === id).data).toBe(blob("b"));

        expect((await request(app).delete(`/vault/items/${id}`).set(auth(token))).status).toBe(200);
        expect((await request(app).delete(`/vault/items/${id}`).set(auth(token))).status).toBe(404);
        me = await request(app).get("/authenticate").set(auth(token));
        expect(me.body.passwords).toHaveLength(2);
    });

    test("another user cannot touch my items", async () =>
    {
        await register();
        const { token } = (await login()).body;
        const { item } = (await request(app).post("/vault/items").set(auth(token)).send({ data: blob("a") })).body;

        await register({ email: "eve@example.com" });
        const eve = (await login({ email: "eve@example.com" })).body.token;
        expect((await request(app).put(`/vault/items/${item._id}`).set(auth(eve)).send({ data: blob("z") })).status).toBe(404);
        expect((await request(app).delete(`/vault/items/${item._id}`).set(auth(eve))).status).toBe(404);
        expect((await request(app).post("/decrypt").set(auth(eve)).send({ id: item._id })).status).toBe(404);
    });

    test("legacy accounts: setup, decrypt and migrate", async () =>
    {
        await register({ kdf: undefined, keyCheck: undefined });
        const { token, vault } = (await login()).body;
        expect(vault.kdf).toBeNull();

        // Old client stores a server-encrypted password
        expect((await request(app).post("/addnewpassword").set(auth(token)).send({ platform: "Gmail", userPass: "hunter2" })).status).toBe(200);
        // ... and the oldest format (AES-CBC) still decrypts
        const user = await User.findOne({ email: "ana@example.com" });
        const crypto = require("crypto");
        const iv = crypto.randomBytes(16);
        const key = crypto.createHash("sha256").update(process.env.CRYPTO_SECRET_KEY).digest();
        const c = crypto.createCipheriv("aes-256-cbc", key, iv);
        user.passwords.push({ platform: "Old", password: c.update("cbc-secret", "utf8", "base64") + c.final("base64"), iv: iv.toString("hex") });
        await user.save();

        let me = (await request(app).get("/authenticate").set(auth(token))).body;
        const [gcm, cbc] = me.passwords;
        expect(gcm.enc).toBe("gcm");
        expect(cbc.enc).toBe("cbc");
        expect((await request(app).post("/decrypt").set(auth(token)).send({ id: gcm._id })).text).toBe("hunter2");
        expect((await request(app).post("/decrypt").set(auth(token)).send({ id: cbc._id })).text).toBe("cbc-secret");

        // e2e writes need a vault key first
        expect((await request(app).post("/vault/items").set(auth(token)).send({ data: blob() })).status).toBe(409);
        expect((await request(app).post("/vault/setup").set(auth(token)).send({ kdf: KDF, keyCheck: blob("k") })).status).toBe(200);
        expect((await request(app).post("/vault/setup").set(auth(token)).send({ kdf: KDF, keyCheck: blob("k") })).status).toBe(409);

        const mig = await request(app).post("/vault/migrate").set(auth(token)).send({ items: [{ id: gcm._id, data: blob("g") }, { id: cbc._id, data: blob("c") }] });
        expect(mig.status).toBe(200);
        expect(mig.body.migrated).toBe(2);

        const stored = await User.findOne({ email: "ana@example.com" }).lean();
        stored.passwords.forEach((p) =>
        {
            expect(p.enc).toBe("e2e");
            expect(p.password).toBeUndefined();
            expect(p.platform).toBeUndefined();
        });
        // Server can no longer decrypt migrated entries
        expect((await request(app).post("/decrypt").set(auth(token)).send({ id: gcm._id })).status).toBe(404);
    });

    test("GCM legacy ciphertext is tamper evident", () =>
    {
        const { decrypt } = require("../models/EncDecManager");
        const e = encrypt("secret");
        expect(decrypt(e.encryptedPassword, e.iv, e.tag)).toBe("secret");
        const bad = Buffer.from(e.encryptedPassword, "base64");
        bad[0] ^= 1;
        expect(() => decrypt(bad.toString("base64"), e.iv, e.tag)).toThrow();
    });
});

describe("account", () =>
{
    test("change master password re-keys atomically and signs out other devices", async () =>
    {
        await register();
        const phone = (await login()).body.token;
        const laptop = (await login()).body.token;
        const { item } = (await request(app).post("/vault/items").set(auth(phone)).send({ data: blob("a") })).body;

        const base = { currentPassword: "master-pass", newPassword: "new-master-pass", kdf: { ...KDF, salt: Buffer.from("fedcba9876543210").toString("base64") }, keyCheck: blob("k2"), client: "mobile" };

        expect((await request(app).post("/account/password").set(auth(phone)).send({ ...base, currentPassword: "wrong", items: [{ id: item._id, data: blob("n") }] })).status).toBe(400);
        expect((await request(app).post("/account/password").set(auth(phone)).send({ ...base, items: [] })).status).toBe(409);

        const ok = await request(app).post("/account/password").set(auth(phone)).send({ ...base, items: [{ id: item._id, data: blob("n") }] });
        expect(ok.status).toBe(200);
        expect(ok.body.token).toBeTruthy();

        expect((await request(app).get("/authenticate").set(auth(laptop))).status).toBe(401);
        expect((await login()).status).toBe(400);
        const fresh = await login({ password: "new-master-pass" });
        expect(fresh.status).toBe(200);
        expect(fresh.body.vault.keyCheck).toBe(blob("k2"));
        const me = (await request(app).get("/authenticate").set(auth(fresh.body.token))).body;
        expect(me.passwords[0].data).toBe(blob("n"));
    });

    test("logout-all keeps only the current session", async () =>
    {
        await register();
        const a = (await login()).body.token;
        const b = (await login()).body.token;
        expect((await request(app).post("/account/logout-all").set(auth(a))).status).toBe(200);
        expect((await request(app).get("/authenticate").set(auth(a))).status).toBe(200);
        expect((await request(app).get("/authenticate").set(auth(b))).status).toBe(401);
    });

    test("delete account needs the password", async () =>
    {
        await register();
        const token = (await login()).body.token;
        expect((await request(app).post("/account/delete").set(auth(token)).send({ password: "nope" })).status).toBe(400);
        expect((await request(app).post("/account/delete").set(auth(token)).send({ password: "master-pass" })).status).toBe(200);
        expect(await User.countDocuments()).toBe(0);
    });
});

describe("two-factor login", () =>
{
    test("setup, login with code, replay blocked, recovery code, disable", async () =>
    {
        await register();
        const token = (await login()).body.token;

        expect((await request(app).post("/2fa/setup").set(auth(token)).send({ password: "bad" })).status).toBe(400);
        const setup = await request(app).post("/2fa/setup").set(auth(token)).send({ password: "master-pass" });
        expect(setup.status).toBe(200);
        expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\/Aurelia:/);
        const { secret } = setup.body;

        expect((await request(app).post("/2fa/enable").set(auth(token)).send({ code: "000000" })).status).toBe(400);
        const now = Date.now();
        const enable = await request(app).post("/2fa/enable").set(auth(token)).send({ code: totp.codeAt(secret, totp.currentStep(now)) });
        expect(enable.status).toBe(200);
        expect(enable.body.recoveryCodes).toHaveLength(10);

        const stored = await User.findOne({ email: "ana@example.com" }).lean();
        expect(JSON.stringify(stored.twoFactor)).not.toContain(secret);

        // Password alone is no longer enough
        const noCode = await login();
        expect(noCode.status).toBe(401);
        expect(noCode.body.twoFactorRequired).toBe(true);
        expect(noCode.body.token).toBeUndefined();

        // The code used for enabling cannot be replayed
        expect((await login({ code: totp.codeAt(secret, totp.currentStep(now)) })).status).toBe(401);
        const next = await login({ code: totp.codeAt(secret, totp.currentStep(now) + 1) });
        expect(next.status).toBe(200);

        // Recovery codes work once
        const rc = enable.body.recoveryCodes[0];
        expect((await login({ code: rc })).status).toBe(200);
        expect((await login({ code: rc })).status).toBe(401);

        const me = (await request(app).get("/authenticate").set(auth(next.body.token))).body;
        expect(me.twoFactorEnabled).toBe(true);
        expect(me.recoveryCodesLeft).toBe(9);

        expect((await request(app).post("/2fa/disable").set(auth(next.body.token)).send({ password: "master-pass", code: "123" })).status).toBe(401);
        expect((await request(app).post("/2fa/disable").set(auth(next.body.token)).send({ password: "master-pass", code: enable.body.recoveryCodes[1] })).status).toBe(200);
        expect((await login()).status).toBe(200);
    });
});

describe("totp util", () =>
{
    test("RFC 6238 SHA-1 vector", () =>
    {
        const secret = totp.base32Encode(Buffer.from("12345678901234567890"));
        // RFC gives 8 digits (94287082); we use the last 6.
        expect(totp.codeAt(secret, Math.floor(59 / 30))).toBe("287082");
    });
});
