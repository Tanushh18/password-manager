const { describe, test, before: beforeAll, after: afterAll, beforeEach } = require("node:test");
const expect = require("./expect");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const request = require("supertest");

process.env.SECRET_KEY = "test-secret";
process.env.CRYPTO_SECRET_KEY = "test-crypto-secret";
process.env.RATE_LIMIT_MAX = "1000";
process.env.ALLOW_SIGNUP = "true";

const app = require("../app");
const User = require("../models/schema");
const MpinDevice = require("../models/mpinDevice");

let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => { await User.deleteMany({}); await MpinDevice.deleteMany({}); });

const signUp = async (email = "ana@example.com") => {
    await request(app).post("/register").send({ name: "Ana", email, password: "master-pass", cpassword: "master-pass" });
    const res = await request(app).post("/login").send({ email, password: "master-pass", client: "mobile" });
    return { Authorization: `Bearer ${res.body.token}` };
};
const setUp = async (auth, pin = "1805") => (await request(app).post("/mpin").set(auth).send({ pin })).body;
const mpinLogin = (d, pin) => request(app).post("/mpin-login").send({ deviceId: d.deviceId, deviceSecret: d.deviceSecret, pin, client: "mobile" });

describe("mpin: setting it up", () => {
    test("a 4-digit MPIN gives the device an id and a secret, once", async () => {
        const auth = await signUp();
        const res = await request(app).post("/mpin").set(auth).send({ pin: "1805" });
        expect(res.status).toBe(201);
        expect(res.body.deviceId).toMatch(/^[a-f0-9]{24}$/);
        expect(res.body.deviceSecret).toMatch(/^[a-f0-9]{48}$/);
        const list = await request(app).get("/mpin").set(auth);
        expect(list.body.devices.length).toBe(1);
        expect(JSON.stringify(list.body)).not.toContain(res.body.deviceSecret);
        const row = await MpinDevice.findOne({ deviceId: res.body.deviceId });
        expect(row.pinHash).not.toContain("1805");        // only a hash is kept
        expect(row.secretHash).not.toBe(res.body.deviceSecret);
    });

    test("it must be 4 digits and not trivially guessable", async () => {
        const auth = await signUp();
        for (const bad of ["123", "12345", "abcd", "", "12 4", "1234", "1111", "0000", "4321"]) {
            expect((await request(app).post("/mpin").set(auth).send({ pin: bad })).status).toBe(400);
        }
        expect((await request(app).post("/mpin").set(auth).send({ pin: "1805" })).status).toBe(201);
    });

    test("it needs a signed-in session", async () => {
        expect((await request(app).post("/mpin").send({ pin: "1805" })).status).toBe(401);
        expect((await request(app).get("/mpin")).status).toBe(401);
    });

    test("at most five devices; the oldest makes room", async () => {
        const auth = await signUp();
        const first = await setUp(auth, "1805");
        for (let i = 0; i < 5; i++) await setUp(auth, "2580");
        expect((await request(app).get("/mpin").set(auth)).body.devices.length).toBe(5);
        expect((await mpinLogin(first, "1805")).status).toBe(401);       // the first one was pushed out
    });
});

describe("mpin: signing in", () => {
    test("the right MPIN on the right device gives a working session", async () => {
        const auth = await signUp();
        const d = await setUp(auth);
        const res = await mpinLogin(d, "1805");
        expect(res.status).toBe(200);
        expect(res.body.email).toBe("ana@example.com");
        expect(res.body.token).toBeTruthy();
        const me = await request(app).get("/authenticate").set({ Authorization: `Bearer ${res.body.token}` });
        expect(me.status).toBe(200);
    });

    test("the MPIN alone is worth nothing: no secret, a wrong secret or an unknown device are all refused alike", async () => {
        const auth = await signUp();
        const d = await setUp(auth);
        const a = await request(app).post("/mpin-login").send({ deviceId: d.deviceId, pin: "1805" });
        const b = await request(app).post("/mpin-login").send({ deviceId: d.deviceId, deviceSecret: "0".repeat(48), pin: "1805" });
        const c = await request(app).post("/mpin-login").send({ deviceId: "f".repeat(24), deviceSecret: d.deviceSecret, pin: "1805" });
        for (const r of [a, b, c]) expect([400, 401]).toContain(r.status);
        expect(b.status).toBe(401);
        expect(b.body.error).toBe(c.body.error);
        expect((await MpinDevice.findOne({ deviceId: d.deviceId })).fails).toBe(0);   // guessing without the secret cannot lock the real device
    });

    test("a wrong MPIN counts down and the fifth wipes the device, even for the right MPIN after", async () => {
        const auth = await signUp();
        const d = await setUp(auth);
        const first = await mpinLogin(d, "9999");
        expect(first.status).toBe(401);
        expect(first.body.error).toMatch(/4 tries left/);
        for (let i = 0; i < 3; i++) await mpinLogin(d, "9999");
        const last = await mpinLogin(d, "9999");
        expect(last.status).toBe(401);
        expect(last.body.mpinGone).toBe(true);
        expect((await mpinLogin(d, "1805")).status).toBe(401);      // gone for good
        expect(await MpinDevice.countDocuments({})).toBe(0);
    });

    test("a right MPIN resets the count", async () => {
        const auth = await signUp();
        const d = await setUp(auth);
        await mpinLogin(d, "9999"); await mpinLogin(d, "9999");
        expect((await mpinLogin(d, "1805")).status).toBe(200);
        expect((await MpinDevice.findOne({ deviceId: d.deviceId })).fails).toBe(0);
    });

    test("the email and password sign-in still works exactly as before", async () => {
        await signUp();
        const res = await request(app).post("/login").send({ email: "ana@example.com", password: "master-pass", client: "mobile" });
        expect(res.status).toBe(200);
        expect((await request(app).post("/login").send({ email: "ana@example.com", password: "nope", client: "mobile" })).status).toBe(400);
    });
});

describe("mpin: managing it", () => {
    test("change the MPIN of a device, and only your own", async () => {
        const ana = await signUp(), bob = await signUp("bob@example.com");
        const d = await setUp(ana, "1805");
        expect((await request(app).put(`/mpin/${d.deviceId}`).set(bob).send({ pin: "2580" })).status).toBe(404);
        expect((await request(app).put(`/mpin/${d.deviceId}`).set(ana).send({ pin: "1111" })).status).toBe(400);
        expect((await request(app).put(`/mpin/${d.deviceId}`).set(ana).send({ pin: "2580" })).status).toBe(200);
        expect((await mpinLogin(d, "1805")).status).toBe(401);
        expect((await mpinLogin(d, "2580")).status).toBe(200);
    });

    test("turn it off for a device, and only your own", async () => {
        const ana = await signUp(), bob = await signUp("bob@example.com");
        const d = await setUp(ana);
        expect((await request(app).delete(`/mpin/${d.deviceId}`).set(bob)).status).toBe(404);
        expect((await request(app).delete(`/mpin/${d.deviceId}`).set(ana)).status).toBe(200);
        expect((await mpinLogin(d, "1805")).status).toBe(401);
    });

    test("changing the account password forgets every MPIN device", async () => {
        const auth = await signUp();
        const d = await setUp(auth);
        const res = await request(app).post("/account/password").set(auth).send({ password: "master-pass", newPassword: "another-pass-9" });
        expect(res.status).toBe(200);
        expect(await MpinDevice.countDocuments({})).toBe(0);
        expect((await mpinLogin(d, "1805")).status).toBe(401);
    });
});
