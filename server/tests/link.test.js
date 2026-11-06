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
const LinkChallenge = require("../models/linkChallenge");
const WallToken = require("../models/wallToken");
const { buildBoard } = require("../router/link");

let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => { await User.deleteMany({}); await LinkChallenge.deleteMany({}); await WallToken.deleteMany({}); });

const signUp = async (email = "ana@example.com") => {
    await request(app).post("/register").send({ name: "Ana", email, password: "master-pass", cpassword: "master-pass" });
    const res = await request(app).post("/login").send({ email, password: "master-pass", client: "mobile" });
    return { Authorization: `Bearer ${res.body.token}` };
};
const start = (b) => request(app).post("/link/start").send({ client: "mobile", ...b });
const poll = (r) => request(app).post("/link/poll").send({ id: r.id, secret: r.secret, client: "mobile" });

describe("link: QR sign-in (phone to TV)", () => {
    test("the phone scans, approves, and the TV gets a working session once", async () => {
        const phone = await signUp();
        const s = (await start({ purpose: "login", label: "Living room TV" })).body;
        expect(s.qr).toMatch(/^stashr:\/\/link\/[a-f0-9]{16}\.[a-f0-9]{24}$/);
        expect((await poll(s)).body.status).toBe("pending");
        const code = s.qr.split(".")[1];
        expect((await request(app).post(`/link/${s.id}/approve`).set(phone).send({ code })).status).toBe(200);
        const done = await poll(s);
        expect(done.body.status).toBe("approved");
        expect((await request(app).get("/authenticate").set({ Authorization: `Bearer ${done.body.token}` })).status).toBe(200);
        expect((await poll(s)).body.status).toBe("expired");  // handed over only once
    });

    test("a wrong code is refused and five wrong codes kill the request", async () => {
        const phone = await signUp();
        const s = (await start({ purpose: "login" })).body;
        for (let i = 0; i < 5; i++) expect((await request(app).post(`/link/${s.id}/approve`).set(phone).send({ code: "nope" })).status).toBe(400);
        expect((await request(app).post(`/link/${s.id}/approve`).set(phone).send({ code: s.qr.split(".")[1] })).status).toBe(404);
    });

    test("approving needs a signed-in phone, and the poll needs the secret", async () => {
        const s = (await start({ purpose: "login" })).body;
        expect((await request(app).post(`/link/${s.id}/approve`).send({ code: s.qr.split(".")[1] })).status).toBe(401);
        expect((await request(app).post("/link/poll").send({ id: s.id, secret: "x".repeat(48) })).status).toBe(404);
    });
});

describe("link: push approval (phone as a hardware key)", () => {
    test("the phone sees the request and must match the number", async () => {
        const phone = await signUp();
        const s = (await start({ purpose: "login", email: "ana@example.com", label: "Work laptop" })).body;
        expect(s.number).toMatch(/^\d{2}$/);
        expect(s.qr).toBeUndefined();
        const list = (await request(app).get("/link/pending").set(phone)).body.requests;
        expect(list.length).toBe(1);
        expect(JSON.stringify(list)).not.toContain(s.secret);
        // the phone is not told the number (checked on the fields: a two-digit number can appear by chance inside an id or a time)
        expect(list.every((r) => !Object.prototype.hasOwnProperty.call(r, "number") && !Object.values(r).some((v) => v === s.number))).toBe(true);
        const wrong = String((Number(s.number) % 90) + 10);
        expect((await request(app).post(`/link/${s.id}/approve`).set(phone).send({ number: wrong })).status).toBe(400);
        expect((await request(app).post(`/link/${s.id}/approve`).set(phone).send({ number: s.number })).status).toBe(200);
        expect((await poll(s)).body.token).toBeTruthy();
    });

    test("deny ends it, and another account cannot see or approve it", async () => {
        const phone = await signUp();
        const other = await signUp("bo@example.com");
        const s = (await start({ purpose: "login", email: "ana@example.com" })).body;
        expect((await request(app).get("/link/pending").set(other)).body.requests.length).toBe(0);
        expect((await request(app).post(`/link/${s.id}/approve`).set(other).send({ number: s.number })).status).toBe(404);
        await request(app).post(`/link/${s.id}/deny`).set(phone);
        expect((await poll(s)).body.status).toBe("denied");
    });

    test("an unknown email looks the same but can never be approved", async () => {
        const phone = await signUp();
        const s = await start({ purpose: "login", email: "ghost@example.com" });
        expect(s.status).toBe(201);
        expect(s.body.number).toMatch(/^\d{2}$/);
        expect((await request(app).post(`/link/${s.body.id}/approve`).set(phone).send({ number: s.body.number })).status).toBe(404);
    });
});

describe("link: wall display (cast a dashboard to the TV)", () => {
    test("QR-link a display, read the board with its key, revoke it", async () => {
        const phone = await signUp();
        const s = (await start({ purpose: "wall", label: "Hall TV" })).body;
        await request(app).post(`/link/${s.id}/approve`).set(phone).send({ code: s.qr.split(".")[1] });
        const done = (await poll(s)).body;
        expect(done.wallKey).toMatch(/^[a-f0-9]{64}$/);
        expect(done.token).toBeUndefined();   // a wall key is not a session
        const board = await request(app).get("/wall").set({ Authorization: `Bearer ${done.wallKey}` });
        expect(board.status).toBe(200);
        expect(board.body.overall).toBeTruthy();
        expect((await request(app).get("/authenticate").set({ Authorization: `Bearer ${done.wallKey}` })).status).not.toBe(200);
        const keys = (await request(app).get("/wall/keys").set(phone)).body.displays;
        expect(keys.length).toBe(1);
        expect((await request(app).delete(`/wall/keys/${keys[0].id}`).set(phone)).status).toBe(200);
        expect((await request(app).get("/wall").set({ Authorization: `Bearer ${done.wallKey}` })).status).toBe(401);
    });

    test("no key, no board; wall cannot use push mode", async () => {
        expect((await request(app).get("/wall")).status).toBe(401);
        expect((await start({ purpose: "wall", email: "ana@example.com" })).status).toBe(400);
    });

    test("buildBoard keeps only names and states", () => {
        const b = buildBoard([{ service: { name: "api", url: "https://secret" }, health: { level: "red" } }, { health: { level: "green" }, github: { fullName: "a/b" } }], [{ name: "site", target: "https://x", ok: true, ms: 40 }]);
        expect(b.overall).toBe("degraded");
        expect(b.problems).toBe(1);
        expect(JSON.stringify(b)).not.toContain("secret");
        expect(buildBoard([], []).overall).toBe("unknown");
    });
});
