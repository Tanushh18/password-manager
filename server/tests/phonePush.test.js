const { describe, test, before: beforeAll, after: afterAll, beforeEach } = require("node:test");
const expect = require("./expect");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const request = require("supertest");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const fcm = require("../utils/fcm");
const phonePush = require("../utils/phonePush");
const HomeDevice = require("../models/homeDevice");
const HomeSettings = require("../models/homeSettings");

const crypto = require("crypto");
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" });
const KEY = { type: "service_account", project_id: "stashr-home", client_email: "x@stashr-home.iam.gserviceaccount.com", private_key: PEM };
const TOKEN = "f".repeat(60) + ":APA91b" + "x".repeat(100);

describe("Firebase key from the environment", () => {
    test("plain JSON, base64 JSON and either variable name are all read; \\n in the key becomes a newline", () => {
        expect(fcm.readKey({ STASHR_FIREBASE_KEY: JSON.stringify(KEY) }).client_email).toBe(KEY.client_email);
        expect(fcm.readKey({ stashr_firebase_key: Buffer.from(JSON.stringify(KEY)).toString("base64") }).client_email).toBe(KEY.client_email);
        // a key pasted into a host's settings page often has literal \n instead of line breaks
        const flat = JSON.stringify({ ...KEY, private_key: PEM.replace(/\n/g, "\\n") });
        expect(fcm.readKey({ FIREBASE_SERVICE_ACCOUNT: flat }).private_key).toBe(PEM);
    });
    test("nothing, rubbish or a key without a private key means off", () => {
        expect(fcm.readKey({})).toBeNull();
        expect(fcm.readKey({ STASHR_FIREBASE_KEY: "not json" })).toBeNull();
        expect(fcm.readKey({ STASHR_FIREBASE_KEY: JSON.stringify({ client_email: "a" }) })).toBeNull();
    });
});

describe("waking phones by push", () => {
    let mongo;
    const sent = [];          // FCM requests that went out
    let tokenCalls = 0, fcmStatus = 200, fcmBody = "{}", jwtOk = null;
    const reply = (status, body) => ({ ok: status < 400, status, json: async () => (typeof body === "string" ? JSON.parse(body) : body), text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
    const fakeFetch = async (url, opts) => {
        if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
            tokenCalls++;
            const jwt = new URLSearchParams(opts.body).get("assertion").split(".");
            jwtOk = crypto.verify("RSA-SHA256", Buffer.from(jwt[0] + "." + jwt[1]), publicKey, Buffer.from(jwt[2], "base64url"));
            return reply(200, { access_token: "ya29.fake", expires_in: 3600 });
        }
        const msg = JSON.parse(opts.body).message;
        if (fcmStatus >= 400) return reply(fcmStatus, fcmBody);
        sent.push({ url: String(url), auth: opts.headers.Authorization, ...msg });
        return reply(200, { name: "projects/stashr-home/messages/1" });
    };
    beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
    afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); delete process.env.STASHR_FIREBASE_KEY; });
    beforeEach(async () => {
        await HomeDevice.deleteMany({}); await HomeSettings.deleteMany({});
        sent.length = 0; tokenCalls = 0; fcmStatus = 200; jwtOk = null;
        process.env.STASHR_FIREBASE_KEY = JSON.stringify(KEY);
        fcm._reset({ fetch: fakeFetch });
    });

    const owner = new mongoose.Types.ObjectId();
    const now = Date.now();
    const phone = async (over = {}) => HomeDevice.create({ owner, name: "Mukta", kind: "phone", person: "Mukta", tokenHash: Math.random().toString(36), lastSeen: new Date(now - 60 * 60_000), status: { agent: "stashr-where", location: { lat: 28.6, lon: 77.2, acc: 20, at: now - 60 * 60_000 } }, fcmToken: TOKEN, ...over });
    const homeSet = () => HomeSettings.create({ owner, homeSpot: { lat: 28.6139, lon: 77.209, radius: 200 } });

    test("a phone quiet for an hour gets one high-priority data push, and not a second one a minute later", async () => {
        await homeSet(); await phone();
        expect(await phonePush.nudgeStale(now)).toBe(1);
        expect(sent).toHaveLength(1);
        expect(sent[0].token).toBe(TOKEN);
        expect(sent[0].data).toEqual({ type: "locate" });
        expect(sent[0].android.priority).toBe("HIGH");
        expect(sent[0].url).toBe("https://fcm.googleapis.com/v1/projects/stashr-home/messages:send");
        expect(sent[0].auth).toBe("Bearer ya29.fake");
        expect(jwtOk).toBe(true);          // the sign-in token really is signed with the service account's key
        expect(await phonePush.nudgeStale(now + 60_000)).toBe(0);
        expect(sent).toHaveLength(1);
    });

    test("a phone that reported recently, or an account without a home spot, is left alone", async () => {
        await phone({ lastSeen: new Date(now - 60_000), status: { agent: "stashr-where", location: { lat: 28.6, lon: 77.2, at: now - 5 * 60_000 } } });
        await homeSet();
        expect(await phonePush.nudgeStale(now)).toBe(0);
        await HomeSettings.deleteMany({}); await HomeDevice.deleteMany({}); await phone();
        expect(await phonePush.nudgeStale(now)).toBe(0);
    });

    test("a phone that never answers is asked less and less often", async () => {
        await homeSet(); const p = await phone();
        expect(await phonePush.nudgeStale(now)).toBe(1);
        let t = now;
        for (let i = 0; i < 4; i++) { t += 16 * 60_000; await phonePush.nudgeStale(t); }
        const d = await HomeDevice.findById(p._id).lean();
        expect(d.fcmMisses >= 3).toBe(true);
        const before = sent.length;
        expect(await phonePush.nudgeStale(t + 16 * 60_000)).toBe(0);   // now it waits an hour
        expect(sent).toHaveLength(before);
        expect(await phonePush.nudgeStale(t + 61 * 60_000)).toBe(1);
    });

    test("a phone that answered between asks starts again from zero", async () => {
        await homeSet(); const p = await phone();
        await phonePush.nudgeStale(now);
        await HomeDevice.updateOne({ _id: p._id }, { $set: { "status.location.at": now + 2 * 60_000, lastSeen: new Date(now + 2 * 60_000) } });
        await phonePush.nudgeStale(now + 40 * 60_000);
        expect((await HomeDevice.findById(p._id).lean()).fcmMisses).toBe(0);
    });

    test("the Google sign-in is fetched once and reused for the next pushes", async () => {
        await homeSet(); await phone(); await phone({ name: "Parveen", person: "Parveen", tokenHash: "z" + Math.random() });
        expect(await phonePush.nudgeStale(now)).toBe(2);
        expect(tokenCalls).toBe(1);
    });

    test("an auth failure is not mistaken for a dead phone token", async () => {
        await homeSet(); const p = await phone();
        fcmStatus = 403; fcmBody = JSON.stringify({ error: { status: "PERMISSION_DENIED", message: "Firebase Cloud Messaging API has not been used in project" } });
        expect(await phonePush.nudgeStale(now)).toBe(0);
        expect((await HomeDevice.findById(p._id).select("+fcmToken").lean()).fcmToken).toBe(TOKEN);
    });

    test("Refresh location asks every phone of the account for a real fix, even a fresh one, but not twice in 20 seconds", async () => {
        await phone({ lastSeen: new Date(now), status: { agent: "stashr-where", location: { lat: 28.6, lon: 77.2, at: now } } });
        await phone({ name: "Parveen", person: "Parveen", fcmToken: "" });
        expect(await phonePush.nudgeOwner(owner, now)).toBe(1);
        expect(sent[0].data).toEqual({ type: "now" });
        expect(await phonePush.nudgeOwner(owner, now + 5000)).toBe(0);
    });

    test("a token Firebase says is dead is forgotten; an unconfigured server does nothing", async () => {
        await homeSet(); const p = await phone();
        fcmStatus = 404; fcmBody = JSON.stringify({ error: { status: "NOT_FOUND", message: "Requested entity was not found.", details: [{ errorCode: "UNREGISTERED" }] } });
        expect(await phonePush.nudgeStale(now)).toBe(0);
        expect((await HomeDevice.findById(p._id).select("+fcmToken").lean()).fcmToken).toBe("");
        delete process.env.STASHR_FIREBASE_KEY; fcm._reset({ fetch: fakeFetch });
        expect(await phonePush.nudgeStale(now + 3600_000)).toBe(0);
        expect(sent).toHaveLength(0);
    });
});
