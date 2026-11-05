const { describe, test, before: beforeAll, after: afterAll, beforeEach } = require("node:test");
const expect = require("./expect");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const request = require("supertest");

process.env.SECRET_KEY = "test-secret"; process.env.CRYPTO_SECRET_KEY = "test-crypto-secret"; process.env.RATE_LIMIT_MAX = "1000"; process.env.ALLOW_SIGNUP = "true"; delete process.env.YOUTUBE_API_KEY; process.env.HOME_ROUTING = "off";
const app = require("../app");
const User = require("../models/schema");
const HomeDevice = require("../models/homeDevice");
const HomeSettings = require("../models/homeSettings");
const HomeEvent = require("../models/homeEvent");
const HomeRoomSample = require("../models/homeRoomSample");
const live = require("../utils/roomLive");

describe("room location through the server", () => {
    let mongo;
    beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
    afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
    beforeEach(async () => { for (const M of [User, HomeDevice, HomeSettings, HomeEvent, HomeRoomSample]) await M.deleteMany({}); });

    const signUp = async () => {
        await request(app).post("/register").send({ name: "Ana", email: "ana@example.com", password: "master-pass", cpassword: "master-pass" });
        const r = await request(app).post("/login").send({ email: "ana@example.com", password: "master-pass", client: "mobile" });
        return { Authorization: `Bearer ${r.body.token}` };
    };
    const bearer = (t) => ({ Authorization: `Bearer ${t}` });
    // the phone's report is answered first and the room is worked out just after: wait for it (up to 3 s) instead of guessing a delay
    const until = async (fn) => { for (let i = 0; i < 30; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return null; };
    const link = async (auth, name = "Papa") => {
        const code = (await request(app).get("/home/location-code").set(auth)).body.code;
        return (await request(app).post("/home/agent/link").send({ code, name })).body;
    };

    // what the phone hears in each room (RSSI dBm), a little different on every scan
    const FP = { Bedroom: { r1: -45, n1: -60, n2: -85 }, Kitchen: { r1: -60, n1: -80, n2: -55 } };
    let seed = 11; const jit = () => { seed = (seed * 16807) % 2147483647; return Math.round((seed / 2147483647 - 0.5) * 6); };
    const scan = (room) => ({ wifi: Object.entries(FP[room] || FP.Bedroom).map(([b, r]) => ({ b: "aa:bb:cc:00:00:" + b, r: r + jit() })), ble: [] });
    const tap = (token, room, n = 8, session = room + Math.random()) => request(app).post("/home/agent/room/sample").set(bearer(token)).send({ room, session, scans: Array.from({ length: n }, () => scan(room)) });

    test("rooms are added from the phone or the website; a scan for an unknown room, or one that heard nothing, is refused", async () => {
        const auth = await signUp();
        const ph = await link(auth);
        expect((await request(app).post("/home/agent/room/add").set(bearer(ph.token)).send({ name: "Bedroom" })).body.rooms).toEqual(["Bedroom"]);
        await request(app).post("/home/agent/room/add").set(bearer(ph.token)).send({ name: "Bedroom" });
        expect((await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Kitchen", "x"] })).body.rooms).toEqual(["Bedroom", "Kitchen"]);   // "x" is too short
        expect((await tap(ph.token, "Garage")).status).toBe(400);
        expect((await request(app).post("/home/agent/room/sample").set(bearer(ph.token)).send({ room: "Bedroom", scans: [{ wifi: [], ble: [] }] })).status).toBe(400);
        expect((await request(app).get("/home/rooms")).status).toBe(401);
    });

    test("training two rooms gives an honest accuracy, hashes the ids, and turns room location on", async () => {
        const auth = await signUp();
        const ph = await link(auth);
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Kitchen"] });
        for (let i = 0; i < 4; i++) { await tap(ph.token, "Bedroom"); await tap(ph.token, "Kitchen"); }
        const last = await tap(ph.token, "Kitchen");
        expect(last.status).toBe(200);
        expect(last.body.counts).toEqual({ Bedroom: 32, Kitchen: 40 });
        expect(last.body.accuracy >= 85).toBe(true);
        expect(last.body.verdict).toMatch(/Good/);
        const raw = await HomeRoomSample.findOne({}).lean();
        expect(raw.wifi[0].b).toMatch(/^[0-9a-f]{12}$/);
        expect(JSON.stringify(raw)).not.toMatch(/aa:bb:cc/);                 // the real network address is never stored
        expect((await HomeDevice.findOne({ kind: "phone" }).lean()).roomOn).toBe(true);
        const site = (await request(app).get("/home/rooms").set(auth)).body;
        expect(site.phones[0].on).toBe(true);
        expect(site.phones[0].report.accuracy >= 85).toBe(true);
        expect(Object.keys(site.phones[0].report.perRoom).sort()).toEqual(["Bedroom", "Kitchen"]);
    });

    test("a live scan names the room, the room changes only after two agreeing scans, and the change is written to the timeline", async () => {
        const auth = await signUp();
        const ph = await link(auth);
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Kitchen"] });
        for (let i = 0; i < 4; i++) { await tap(ph.token, "Bedroom"); await tap(ph.token, "Kitchen"); }
        const now = Date.now();
        const asked = async (room, at) => { const d = await HomeDevice.findOne({ kind: "phone" }); await live.update(d.toObject(), scan(room), at); return (await HomeDevice.findOne({ kind: "phone" }).lean()).status.room; };
        expect((await asked("Bedroom", now)).name).toBe("Bedroom");          // the first answer is taken
        let r = await asked("Kitchen", now + 60000);
        expect(r.name).toBe("Bedroom"); expect(r.pending).toBe("Kitchen");   // one scan is not enough
        r = await asked("Kitchen", now + 120000);
        expect(r.name).toBe("Kitchen");
        const ev = await HomeEvent.find({ kind: "room_change" }).lean();
        expect(ev).toHaveLength(1);
        expect(ev[0].text).toMatch(/Papa: Bedroom → Kitchen/);
        expect(live.currentOf({ status: { room: r } }, now + 130000).name).toBe("Kitchen");
        expect(live.currentOf({ status: { room: r } }, now + 3600000)).toBeNull();       // an hour old: not trusted
    });

    test("the phone's normal report carries the scan: the room is found without a separate call; a phone with room location off ignores it", async () => {
        const auth = await signUp();
        const ph = await link(auth);
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Kitchen"] });
        for (let i = 0; i < 4; i++) { await tap(ph.token, "Bedroom"); await tap(ph.token, "Kitchen"); }
        const report = (room) => request(app).post("/home/agent/location").set(bearer(ph.token)).send({ lat: 28.6139, lon: 77.209, acc: 20, at: Date.now(), battery: { pct: 80, charging: false }, wifi: { connected: true, ip: "192.168.1.9", bssid: "aa:bb:cc:dd:ee:01" }, scan: scan(room) });
        await report("Kitchen");
        expect((await until(async () => (await HomeDevice.findOne({ kind: "phone" }).lean()).status.room)).name).toBe("Kitchen");
        await request(app).put(`/home/rooms/phone/${ph.deviceId}`).set(auth).send({ on: false });
        await HomeDevice.updateOne({}, { $unset: { "status.room": 1 } });
        await report("Bedroom");
        await new Promise((r) => setTimeout(r, 300));
        expect((await HomeDevice.findOne({ kind: "phone" }).lean()).status.room).toBeUndefined();
    });

    test("a wrong answer corrected from the phone adds a 'fix' sample; deleting a room removes its training; samples can be erased", async () => {
        const auth = await signUp();
        const ph = await link(auth);
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Kitchen"] });
        await tap(ph.token, "Bedroom"); await tap(ph.token, "Kitchen");
        const fixed = await request(app).post("/home/agent/room/fix").set(bearer(ph.token)).send({ room: "Kitchen", scans: [scan("Kitchen")] });
        expect(fixed.status).toBe(200);
        expect(await HomeRoomSample.countDocuments({ src: "fix" })).toBe(1);
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom"] });
        expect(await HomeRoomSample.countDocuments({ room: "Kitchen" })).toBe(0);
        expect((await request(app).delete("/home/rooms/samples").set(auth).send({})).body.deleted).toBe(8);
        expect(await HomeRoomSample.countDocuments({})).toBe(0);
    });

    test("with rooms made, the map's blocks are the rooms and each phone sits in the room the model names; an unsure phone is 'home, room unknown'", async () => {
        const auth = await signUp();
        const ph = await link(auth, "Papa");
        const ph2 = await link(auth, "Mom");
        await request(app).put("/home/settings").set(auth).send({ homeSpot: { lat: 28.6139, lon: 77.209, radius: 200 } });
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Kitchen"] });
        for (let i = 0; i < 4; i++) { await tap(ph.token, "Bedroom"); await tap(ph.token, "Kitchen"); }
        const now = Date.now();
        for (const t of [ph, ph2]) await request(app).post("/home/agent/location").set(bearer(t.token)).send({ lat: 28.6139, lon: 77.209, acc: 20, at: now, battery: { pct: 80, charging: false }, wifi: { connected: true, ip: "192.168.1.9", bssid: "aa:bb:cc:dd:ee:01" } });
        const d = await HomeDevice.findOne({ person: "Papa" });
        await live.update(d.toObject(), scan("Kitchen"), now);
        const map = (await request(app).get("/home/map").set(auth)).body;
        expect(map.zones.map((z) => z.name)).toEqual(["Bedroom", "Kitchen"]);
        expect(map.zones.find((z) => z.name === "Kitchen").people).toEqual([{ person: "Papa", by: "room" }]);
        expect(map.zones.find((z) => z.name === "Bedroom").people).toEqual([]);
        expect(map.homeNoZone.map((p) => p.person)).toEqual(["Mom"]);          // her phone has room location off: home, room unknown
        expect(map.stats.rooms).toBe(2);
        expect(map.note).toMatch(/2 kamre/);
    });

    test("'Papa kis room mein hai' is answered from the model: the room and how sure, 'not sure' with the two likely rooms, off, and stale", async () => {
        const auth = await signUp();
        const ph = await link(auth, "Papa");
        await link(auth, "Mom");
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Kitchen"] });
        for (let i = 0; i < 4; i++) { await tap(ph.token, "Bedroom"); await tap(ph.token, "Kitchen"); }
        const now = Date.now();
        const papa = await HomeDevice.findOne({ person: "Papa" });
        await live.update(papa.toObject(), scan("Kitchen"), now);
        const ask = async (text) => (await request(app).post("/home/assistant").set(auth).send({ text })).body.reply;
        expect(await ask("Papa kis room mein hai")).toMatch(/Papa abhi Kitchen mein hain \(\d+% pakka, 0 min pehle\)/);
        expect(await ask("kaun kis room mein hai")).toMatch(/Mom ka room location band hai/);
        await HomeDevice.updateOne({ _id: papa._id }, { $set: { "status.room.sure": false, "status.room.ranking": [{ room: "Kitchen", p: 0.52 }, { room: "Bedroom", p: 0.48 }] } });
        expect(await ask("papa kaun se room mein hai")).toMatch(/pakka nahi, shayad Kitchen \(52%\) ya Bedroom \(48%\)/);
        await HomeDevice.updateOne({ _id: papa._id }, { $set: { "status.room.at": now - 3 * 3600 * 1000 } });
        expect(await ask("papa kis room mein hai")).toMatch(/kamra abhi pata nahi \(aakhri scan 180 min purana\)/);
    });

    test("Start model: only trained phones start, an untrained one is told why, the phone's next answer carries roomOn, Stop turns it off", async () => {
        const auth = await signUp();
        const papa = await link(auth, "Papa");
        const mom = await link(auth, "Mom");
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Kitchen"] });
        for (let i = 0; i < 3; i++) { await tap(papa.token, "Bedroom"); await tap(papa.token, "Kitchen"); }
        await HomeDevice.updateMany({}, { $set: { roomOn: false } });
        const started = (await request(app).post("/home/room/model").set(auth).send({ on: true })).body;
        expect(started.running).toBe(true);
        expect(started.started).toEqual(["Papa"]);
        expect(started.blocked.map((b) => b.person)).toEqual(["Mom"]);
        expect(started.live.running).toBe(true);
        const ans = (token) => request(app).post("/home/agent/location").set(bearer(token)).send({ lat: 28.6, lon: 77.2, acc: 20, at: Date.now(), battery: { pct: 80, charging: false }, wifi: { connected: true, ip: "192.168.1.9" } });
        expect((await ans(papa.token)).body.roomOn).toBe(true);
        expect((await ans(mom.token)).body.roomOn).toBe(false);
        const tablet = await request(app).post("/home/pair-codes").set(auth).send({ kind: "hub", name: "Hall tablet" });
        const hub = (await request(app).post("/home/agent/pair").send({ code: tablet.body.code })).body;
        const stopped = (await request(app).post("/home/agent/room/model").set(bearer(hub.token)).send({ on: false })).body;     // the tablet can stop it too
        expect(stopped.running).toBe(false);
        expect(stopped.live.running).toBe(false);
        expect((await ans(papa.token)).body.roomOn).toBe(false);
        expect((await request(app).post("/home/room/model").send({ on: true })).status).toBe(401);
    });

    test("the live report has every number, the same on the website and the tablet; 'Sahi hai' and corrections make the real-life accuracy", async () => {
        const auth = await signUp();
        const ph = await link(auth, "Papa");
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Kitchen"] });
        for (let i = 0; i < 4; i++) { await tap(ph.token, "Bedroom"); await tap(ph.token, "Kitchen"); }
        await request(app).post("/home/room/model").set(auth).send({ on: true });
        const d = await HomeDevice.findOne({ kind: "phone" });
        await live.update(d.toObject(), scan("Kitchen"), Date.now());
        const site = (await request(app).get("/home/room/live").set(auth)).body;
        const p = site.phones[0];
        expect(site.running).toBe(true);
        expect(site.rooms).toEqual(["Bedroom", "Kitchen"]);
        expect(p.current.name).toBe("Kitchen");
        expect(p.current.ranking.map((r) => r.room)).toEqual(["Kitchen", "Bedroom"]);        // every room's share, not just the top few
        expect(p.current.nearest >= 0).toBe(true);
        expect(p.current.heard.wifi).toBe(3);
        expect(p.current.samples).toBe(64);
        expect(p.cv.accuracy >= 85).toBe(true);
        expect(p.field).toMatchObject({ confirmed: 0, wrong: 0, accuracy: null });
        // real life: one "Sahi hai", then a correction to another room
        await request(app).post("/home/agent/room/confirm").set(bearer(ph.token));
        await request(app).post("/home/agent/room/fix").set(bearer(ph.token)).send({ room: "Bedroom", scans: [scan("Bedroom")] });
        const hub = (await request(app).post("/home/agent/pair").send({ code: (await request(app).post("/home/pair-codes").set(auth).send({ kind: "hub", name: "T" })).body.code })).body;
        const tab = (await request(app).get("/home/agent/room/live").set(bearer(hub.token))).body;
        expect(tab.phones[0].field).toMatchObject({ confirmed: 1, wrong: 1, accuracy: 50 });
        expect(tab.summary.fieldAccuracy).toBe(50);
        expect(tab.summary.trained).toBe(1);
        expect(JSON.stringify({ ...tab, at: 0, phones: tab.phones.map((x) => ({ ...x, current: x.current && { ...x.current, ageSec: 0, at: 0 }, cv: x.cv, field: x.field })) }).length > 100).toBe(true);
    });

    test("only the oldest samples go once a room has 80", async () => {
        const auth = await signUp();
        const ph = await link(auth);
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Kitchen"] });
        for (let i = 0; i < 11; i++) await tap(ph.token, "Bedroom", 8);       // 88 scans
        expect((await tap(ph.token, "Kitchen", 2)).body.counts.Bedroom).toBe(80);
    });
});
