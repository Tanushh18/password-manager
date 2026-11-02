const { describe, test, before: beforeAll, after: afterAll, beforeEach } = require("node:test");
const expect = require("./expect");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const request = require("supertest");

process.env.SECRET_KEY = "test-secret";
process.env.CRYPTO_SECRET_KEY = "test-crypto-secret";
process.env.RATE_LIMIT_MAX = "1000";
process.env.ALLOW_SIGNUP = "true";
delete process.env.YOUTUBE_API_KEY;

const app = require("../app");
const User = require("../models/schema");
const HomeDevice = require("../models/homeDevice");
const HomeEvent = require("../models/homeEvent");
const HomeSettings = require("../models/homeSettings");
const HomeClaim = require("../models/homeClaim");
const home = require("../utils/home");
const automation = require("../utils/homeAutomation");

let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => { for (const M of [User, HomeDevice, HomeEvent, HomeSettings, HomeClaim]) await M.deleteMany({}); });

const signUp = async (email = "ana@example.com") => {
    await request(app).post("/register").send({ name: "Ana", email, password: "master-pass", cpassword: "master-pass" });
    const res = await request(app).post("/login").send({ email, password: "master-pass", client: "mobile" });
    return { Authorization: `Bearer ${res.body.token}` };
};
const pair = async (auth, kind = "hub", name = "Hall tablet") => {
    const code = (await request(app).post("/home/pair-codes").set(auth).send({ kind, name })).body.code;
    return (await request(app).post("/home/agent/pair").send({ code })).body;
};
const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const report = (token, body) => request(app).post("/home/agent/report").set(bearer(token)).send(body);
const devices = async (auth) => (await request(app).get("/home/devices").set(auth)).body;

describe("home rules", () => {
    test("a device with a name keeps its row and label when its IP changes", () => {
        const t0 = 1_000_000_000_000;
        expect(home.lanKey({ ip: "192.168.1.20", name: "Galaxy-S23" })).toBe("n-galaxy-s23");
        expect(home.lanKey({ ip: "192.168.1.20", name: "android" })).toBe("192-168-1-20");   // a name many devices share
        const a = home.mergeLan({}, [{ ip: "192.168.1.20" }], {}, t0);
        const b = home.mergeLan(a.book, [{ ip: "192.168.1.20", name: "Galaxy-S23" }], {}, t0 + 60_000);
        expect(b.moves).toEqual([{ from: "192-168-1-20", to: "n-galaxy-s23" }]);
        expect(b.book["n-galaxy-s23"].firstSeen).toBe(t0);
        const c = home.mergeLan(b.book, [{ ip: "192.168.1.77", name: "Galaxy-S23" }], {}, t0 + 120_000);
        expect(Object.keys(c.book)).toEqual(["n-galaxy-s23"]);
        expect(c.book["n-galaxy-s23"].ip).toBe("192.168.1.77");
        expect(c.events).toEqual([]);
    });

    test("two devices with the same name in one scan keep their IP keys", () => {
        const r = home.mergeLan({}, [{ ip: "192.168.1.2", name: "Redmi" }, { ip: "192.168.1.3", name: "Redmi" }], {}, 1);
        expect(Object.keys(r.book).sort()).toEqual(["192-168-1-2", "192-168-1-3"]);
    });

    test("risky ports, night windows, presence", () => {
        expect(home.risksOf([80, 23, 5555]).map((r) => r.port)).toEqual([23, 5555]);
        expect(home.inWindow(30, 23 * 60, 5 * 60)).toBe(true);
        expect(home.inWindow(12 * 60, 23 * 60, 5 * 60)).toBe(false);
        const now = Date.now();
        const hub = { lanBook: { "n-mom": { ip: "192.168.1.9", up: true, lastSeen: now } }, lanLabels: { "n-mom": { person: "Mom", label: "Mom's phone" } } };
        const phone = { name: "Dad", status: { wifi: true, ip: "192.168.1.30" }, lastSeen: new Date(now) };
        const p = home.presence([hub], [phone], now);
        expect(p.find((x) => x.person === "Mom").home).toBe(true);
        expect(p.find((x) => x.person === "Dad").home).toBe(false);   // the tablet does not see Dad's address
    });

    test("Wi-Fi alerts: new devices, the night window, a person arriving", () => {
        const settings = { alerts: { newDevice: false, night: true, nightFrom: "00:00", nightTo: "05:00", presence: true } };
        const labels = { k1: { person: "Mom", tag: "family" } };
        const day = automation.lanAlerts([{ kind: "lan_new", key: "x", text: "New" }], labels, settings, { minutes: 12 * 60 });
        expect(day[0].notify).toBe(false);
        const night = automation.lanAlerts([{ kind: "lan_joined", key: "x", text: "Phone joined" }], labels, settings, { minutes: 60 });
        expect(night[0].notify).toBe(true);
        expect(night[0].text).toMatch(/At night/);
        const mom = automation.lanAlerts([{ kind: "lan_joined", key: "k1", text: "Mom joined" }], labels, settings, { minutes: 60 });
        expect(mom[0].notify).toBe(false);                             // a known device at night is not an alarm
        expect(mom[1]).toEqual({ kind: "home_arrived", text: "Mom came home", notify: true });
    });

    test("local time in the account's zone", () => {
        const p = automation.localParts(Date.UTC(2026, 10, 1, 18, 45), "Asia/Kolkata"); // 00:15 on 2 Nov in India
        expect(p).toEqual({ date: "2026-11-02", hhmm: "00:15", minutes: 15, weekday: 1 });
    });
});

describe("pairing", () => {
    test("a code pairs one tablet, once, and its token can report", async () => {
        const auth = await signUp();
        const res = await request(app).post("/home/pair-codes").set(auth).send({ kind: "hub", name: "Hall tablet" });
        expect(res.status).toBe(201);
        expect(res.body.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
        const p = await request(app).post("/home/agent/pair").send({ code: res.body.code.toLowerCase() });
        expect(p.status).toBe(201);
        expect(p.body.device.kind).toBe("hub");
        expect((await request(app).post("/home/agent/pair").send({ code: res.body.code })).status).toBe(400);
        expect((await report(p.body.token, { status: { agent: "stashr-hub" } })).status).toBe(200);
        expect((await request(app).post("/home/agent/pair").send({ code: "AAAA-AAAA" })).status).toBe(400);
    });

    test("a family phone reports its health and shows up on its Wi-Fi row and in who is home", async () => {
        const auth = await signUp();
        const hub = await pair(auth);
        const phone = await pair(auth, "phone", "Mom");
        await report(hub.token, { status: { lan: [{ ip: "192.168.1.44", up: true }] } });
        expect((await report(phone.token, { status: { battery: 64, charging: false, storage: { free: 1e9, total: 6.4e10 }, wifi: true, ip: "192.168.1.44", model: "Pixel 8" } })).status).toBe(200);
        const body = await devices(auth);
        const row = body.devices.find((d) => d.kind === "hub").lan[0];
        expect(row.phone.name).toBe("Mom");
        expect(row.phone.battery).toBe(64);
        expect(body.people.find((p) => p.person === "Mom").home).toBe(true);
        const ph = body.devices.find((d) => d.kind === "phone");
        expect(ph.online).toBe(true);
        expect(ph.status.model).toBe("Pixel 8");
    });
});

describe("Wi-Fi list", () => {
    test("labels carry tag, person and a wake MAC; rows can be merged and forgotten", async () => {
        const auth = await signUp();
        const hub = await pair(auth);
        await report(hub.token, { status: { lan: [{ ip: "192.168.1.5", up: true }, { ip: "192.168.1.6", up: true, ports: [23] }] } });
        const id = (await devices(auth)).devices[0].id;
        expect((await request(app).put(`/home/devices/${id}/lan/192-168-1-5`).set(auth).send({ label: "PC", tag: "mine", person: "Tanush", mac: "AA-BB-CC-DD-EE-FF" })).status).toBe(200);
        expect((await request(app).put(`/home/devices/${id}/lan/192-168-1-5`).set(auth).send({ label: "PC", mac: "nope" })).status).toBe(400);
        let lan = (await devices(auth)).devices[0].lan;
        const pc = lan.find((r) => r.key === "192-168-1-5");
        expect(pc.tag).toBe("mine");
        expect(pc.wakeMac).toBe("aa:bb:cc:dd:ee:ff");
        expect(lan.find((r) => r.key === "192-168-1-6").risks[0].port).toBe(23);
        expect((await request(app).post(`/home/devices/${id}/lan/192-168-1-6/merge`).set(auth).send({ into: "192-168-1-5" })).status).toBe(200);
        lan = (await devices(auth)).devices[0].lan;
        expect(lan.length).toBe(1);
        expect(lan[0].label).toBe("PC");
        expect((await request(app).delete(`/home/devices/${id}/lan/192-168-1-5`).set(auth)).status).toBe(200);
        expect((await devices(auth)).devices[0].lan).toEqual([]);
    });

    test("wake <name> sends Wake-on-LAN through the tablet", async () => {
        const auth = await signUp();
        const hub = await pair(auth);
        await report(hub.token, { status: { agent: "stashr-hub", lan: [{ ip: "192.168.1.5", up: true }] } });
        const id = (await devices(auth)).devices[0].id;
        await request(app).put(`/home/devices/${id}/lan/192-168-1-5`).set(auth).send({ label: "Gaming PC", mac: "aa:bb:cc:dd:ee:ff" });
        const r = await request(app).post("/home/assistant").set(auth).send({ text: "wake gaming pc" });
        expect(r.body.sent[0].type).toBe("wake");
        const out = await report(hub.token, { status: {} });
        expect(out.body.commands[0]).toEqual({ id: out.body.commands[0].id, type: "wake", args: { mac: "aa:bb:cc:dd:ee:ff" } });
    });

    test("a speed test result is kept once", async () => {
        const auth = await signUp();
        const hub = await pair(auth);
        const speed = { at: Date.now(), down: 87.4, up: 41.2, ping: 9 };
        await report(hub.token, { status: { speed } });
        await report(hub.token, { status: { speed } });
        const s = (await request(app).get("/home/speed").set(auth)).body.samples;
        expect(s.length).toBe(1);
        expect(s[0].down).toBe(87.4);
    });
});

describe("assistant and scenes", () => {
    const tv = async (auth) => (await request(app).post("/home/devices").set(auth).send({ name: "TV", kind: "tv" })).body;

    test("songs go to the tablet's YouTube Music, or to the TV's YouTube app", async () => {
        const auth = await signUp();
        const hub = await pair(auth);
        await report(hub.token, { status: { agent: "stashr-hub" } });
        const t = await tv(auth);
        const a = await request(app).post("/home/assistant").set(auth).send({ text: "arijit ke gaane chalao" });
        expect(a.body.sent[0].type).toBe("play_music");
        const b = await request(app).post("/home/assistant").set(auth).send({ text: "tv par arijit songs lagao" });
        expect(b.body.sent[0].type).toBe("open_url");
        const out = await report(t.token, { status: { screen: "on" } });
        expect(out.body.commands[0].args.url).toBe("https://www.youtube.com/results?search_query=arijit");
    });

    test("movie night runs its scene; who is home answers", async () => {
        const auth = await signUp();
        const t = await tv(auth);
        const r = await request(app).post("/home/assistant").set(auth).send({ text: "movie night" });
        expect(r.status).toBe(200);
        const out = await report(t.token, { status: { screen: "on" } });
        expect(out.body.commands.map((c) => c.type)).toEqual(["volume", "launch_app"]);
        const who = await request(app).post("/home/assistant").set(auth).send({ text: "kaun ghar par hai" });
        expect(who.body.reply).toMatch(/Nobody is set up/);
    });

    test("scenes and schedules only take allowed commands", async () => {
        const auth = await signUp();
        expect((await request(app).put("/home/scenes").set(auth).send({ scenes: [{ name: "Bad", steps: [{ kind: "tv", type: "format_disk" }] }] })).status).toBe(400);
        expect((await request(app).put("/home/schedules").set(auth).send({ schedules: [{ time: "25:00", steps: [{ kind: "tv", type: "key", args: { key: "HOME" } }] }] })).status).toBe(400);
        const ok = await request(app).put("/home/schedules").set(auth).send({ schedules: [{ name: "Bed", time: "23:00", days: [1, 2, 9], steps: [{ kind: "tv", type: "key", args: { key: "HOME" } }] }] });
        expect(ok.status).toBe(200);
        expect(ok.body.schedules[0].days).toEqual([1, 2]);
    });
});

describe("automations", () => {
    test("a schedule runs at its time, once, even when two servers tick", async () => {
        const auth = await signUp();
        const t = (await request(app).post("/home/devices").set(auth).send({ name: "TV", kind: "tv" })).body;
        const owner = (await HomeDevice.findById(t.device.id)).owner;
        const now = Date.UTC(2026, 10, 2, 17, 30); // 23:00 in India
        await request(app).put("/home/schedules").set(auth).send({ schedules: [{ name: "Bed", time: "23:00", steps: [{ kind: "tv", type: "key", args: { key: "HOME" } }] }] });
        await automation.tickOwner(owner, now);
        await automation.tickOwner(owner, now);
        await automation.tickOwner(owner, now + 60_000);
        const d = await HomeDevice.findById(t.device.id).lean();
        expect(d.commands.length).toBe(1);
        expect(d.commands[0].args).toEqual({ key: "HOME" });
    });

    test("TV time adds up per app, and the daily limit sends the TV home", async () => {
        const auth = await signUp();
        const t = (await request(app).post("/home/devices").set(auth).send({ name: "TV", kind: "tv" })).body;
        await request(app).put("/home/settings").set(auth).send({ tvLimit: { minutes: 2, action: "home", lateNight: false } });
        const owner = (await HomeDevice.findById(t.device.id)).owner;
        const base = Date.now();
        for (let i = 0; i < 3; i++) {
            await report(t.token, { status: { screen: "on", app: { label: "Netflix" } } });
            await automation.tickOwner(owner, base + i * 60_000);
        }
        const days = (await request(app).get("/home/usage?days=1").set(auth)).body.days;
        expect(days[0].minutes).toBe(3);
        expect(days[0].apps.Netflix).toBe(3);
        const d = await HomeDevice.findById(t.device.id).lean();
        expect(d.commands.map((c) => c.type)).toEqual(["media", "key"]);
        const ev = await HomeEvent.find({ kind: "tv_limit" }).lean();
        expect(ev.length).toBe(1);
    });

    test("settings are checked", async () => {
        const auth = await signUp();
        expect((await request(app).put("/home/settings").set(auth).send({ alerts: { nightFrom: "7pm" } })).status).toBe(400);
        expect((await request(app).put("/home/settings").set(auth).send({ timezone: "Mars/Base" })).status).toBe(400);
        const ok = await request(app).put("/home/settings").set(auth).send({ alerts: { newDevice: false }, brief: { enabled: true, time: "07:45" } });
        expect(ok.status).toBe(200);
        expect(ok.body.alerts.newDevice).toBe(false);
        expect(ok.body.alerts.night).toBe(true);
        expect(ok.body.brief).toEqual({ enabled: true, time: "07:45" });
        expect(ok.body.scenes.map((s) => s.name)).toContain("Movie night");
    });
});

describe("camera", () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);

    test("the tablet uploads a photo; only its owner sees it", async () => {
        const auth = await signUp();
        const hub = await pair(auth);
        const up = await request(app).post("/home/agent/media?kind=photo&reason=motion").set(bearer(hub.token)).set("Content-Type", "image/jpeg").send(jpeg);
        expect(up.status).toBe(201);
        const bad = await request(app).post("/home/agent/media?kind=photo").set(bearer(hub.token)).set("Content-Type", "image/jpeg").send(Buffer.from("not a jpeg at all"));
        expect(bad.status).toBe(400);
        const list = (await request(app).get("/home/media").set(auth)).body.media;
        expect(list.length).toBe(1);
        expect(list[0].reason).toBe("motion");
        const file = await request(app).get(`/home/media/${list[0].id}`).set(auth).buffer(true).parse((res, cb) => { const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); });
        expect(file.status).toBe(200);
        expect(file.body.length).toBe(jpeg.length);
        const bob = await signUp("bob@example.com");
        expect((await request(app).get(`/home/media/${list[0].id}`).set(bob)).status).toBe(404);
        expect((await HomeEvent.find({ kind: "camera" })).length).toBe(1);
    });

    test("a phone cannot send camera pictures, and the dashboard answers the tablet", async () => {
        const auth = await signUp();
        const phone = await pair(auth, "phone", "Mom");
        expect((await request(app).post("/home/agent/media?kind=photo").set(bearer(phone.token)).set("Content-Type", "image/jpeg").send(jpeg)).status).toBe(403);
        const hub = await pair(auth);
        const dash = await request(app).get("/home/agent/dashboard").set(bearer(hub.token));
        expect(dash.status).toBe(200);
        expect(dash.body.config.camera.sensitivity).toBe(5);
        expect(dash.body.scenes.length > 0).toBe(true);
    });
});
