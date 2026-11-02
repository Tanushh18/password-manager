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
process.env.HOME_ROUTING = "off";      // no calls to the public routing server from tests

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

    test("live view: the tablet sends frames, the owner sees the newest", async () => {
        const auth = await signUp();
        const hub = await pair(auth);
        expect((await request(app).get("/home/camera/live").set(auth)).status).toBe(204);
        expect((await request(app).post("/home/agent/live").set(bearer(hub.token)).set("Content-Type", "image/jpeg").send(jpeg)).status).toBe(200);
        const live = await request(app).get("/home/camera/live").set(auth).buffer(true).parse((res, cb) => { const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); });
        expect(live.status).toBe(200);
        expect(live.body.length).toBe(jpeg.length);
        const bob = await signUp("bob@example.com");
        expect((await request(app).get("/home/camera/live").set(bob)).status).toBe(204);
        expect(home.cleanCommand("hub", "camera", { action: "live" })).toEqual({ type: "camera", args: { action: "live" } });
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

describe("camera follows the house, and today's updates", () => {
    test("auto camera arms two minutes after everyone left and disarms when someone is back", async () => {
        const auth = await signUp();
        const t = await pair(auth, "hub");
        const hubId = (await devices(auth)).devices.find((d) => d.kind === "hub").id;
        const owner = (await HomeDevice.findById(hubId)).owner;
        await request(app).put("/home/settings").set(auth).send({ camera: { auto: true } });
        const now = Date.now();
        const setMom = (up) => HomeDevice.updateOne({ _id: hubId }, { $set: { lanBook: { "n-mom": { ip: "192.168.1.9", up, lastSeen: up ? now : now - 3600_000 } }, lanLabels: { "n-mom": { person: "Mom", label: "Mom's phone" } } } });
        const cmds = async () => (await HomeDevice.findById(hubId).lean()).commands.filter((c) => c.type === "camera").map((c) => c.args.action);
        await report(t.token, { status: { agent: "stashr-hub", camera: { armed: false } } });
        await setMom(true);
        await automation.tickOwner(owner, now);
        expect(await cmds()).toEqual([]);                       // someone home: nothing
        await setMom(false);
        await automation.tickOwner(owner, now + 1000);          // starts the away timer
        expect(await cmds()).toEqual([]);
        await report(t.token, { status: { agent: "stashr-hub", camera: { armed: false } } });
        await automation.tickOwner(owner, now + 125_000);
        expect(await cmds()).toEqual(["arm"]);
        await automation.tickOwner(owner, now + 126_000);
        expect(await cmds()).toEqual(["arm"]);                  // not again
        await setMom(true);
        await HomeDevice.updateOne({ _id: hubId }, { $set: { "lanBook.n-mom.lastSeen": now + 130_000 } });
        await automation.tickOwner(owner, now + 130_000);
        expect(await cmds()).toEqual(["arm", "disarm"]);
    });

    test("auto camera does not turn off a camera you armed yourself", async () => {
        const auth = await signUp();
        const t = await pair(auth, "hub");
        const hubId = (await devices(auth)).devices.find((d) => d.kind === "hub").id;
        const owner = (await HomeDevice.findById(hubId)).owner;
        await request(app).put("/home/settings").set(auth).send({ camera: { auto: true } });
        const now = Date.now();
        await report(t.token, { status: { agent: "stashr-hub", camera: { armed: true } } });
        await HomeDevice.updateOne({ _id: hubId }, { $set: { lanBook: { "n-mom": { ip: "192.168.1.9", up: true, lastSeen: now } }, lanLabels: { "n-mom": { person: "Mom" } } } });
        await automation.tickOwner(owner, now);
        await automation.tickOwner(owner, now + 60_000);
        const c = (await HomeDevice.findById(hubId).lean()).commands.filter((x) => x.type === "camera");
        expect(c).toEqual([]);
    });

    test("saying 'stashr today updates' opens the list on the tablet", async () => {
        const auth = await signUp();
        const t = await pair(auth, "hub");
        await report(t.token, { status: { agent: "stashr-hub" } });
        for (const say of ["stashr today updates", "aaj ke updates", "Stashr aaj ka update"]) {
            const r = await request(app).post("/home/assistant").set(auth).send({ text: say });
            expect(r.status).toBe(200);
            expect(r.body.sent[0].type).toBe("show_today");
        }
        const spoken = await request(app).post("/home/agent/assistant").set(bearer(t.token)).send({ text: "today updates" });
        expect(spoken.body.open).toBe("today");
        const list = await request(app).get("/home/agent/today").set(bearer(t.token));
        expect(list.status).toBe(200);
        expect(list.body.title).toBe("Today at home");
        expect(Array.isArray(list.body.lines)).toBe(true);
    });
});

describe("places and WhatsApp", () => {
    test("arriving at a place inside the time window sends the message once; outside the window it stays quiet", async () => {
        const auth = await signUp();
        const tab = await pair(auth, "hub");
        const ph = await pair(auth, "phone", "Dad phone");
        await report(tab.token, { status: { agent: "stashr-hub" } });
        const all = (await devices(auth)).devices;
        const hubId = all.find((d) => d.kind === "hub").id, phoneId = all.find((d) => d.kind === "phone").id;
        const owner = (await HomeDevice.findById(hubId)).owner;
        const bad = await request(app).put("/home/places").set(auth).send({ places: [{ name: "Office", lat: 91, lon: 77, radius: 150, phone: phoneId }] });
        expect(bad.status).toBe(400);
        const ok = await request(app).put("/home/places").set(auth).send({ places: [{ name: "Office", lat: 28.6139, lon: 77.209, radius: 150, phone: phoneId, group: "Office team", arriveText: "Reached office", leaveText: "Leaving office", arriveFrom: "00:00", arriveTo: "23:59", leaveFrom: "00:00", leaveTo: "01:00" }] });
        expect(ok.status).toBe(200);
        const at = async (lat, lon, when) => { await HomeDevice.updateOne({ _id: phoneId }, { $set: { "status.location": { lat, lon, acc: 20, at: when } } }); await automation.tickOwner(owner, when); };
        const cmds = async () => (await HomeDevice.findById(hubId).lean()).commands.filter((c) => c.type === "send_whatsapp").map((c) => c.args.text);
        const t0 = Date.now();
        await report(tab.token, { status: { agent: "stashr-hub" } });
        await at(28.7, 77.3, t0);                    // far away: only records
        expect(await cmds()).toEqual([]);
        await at(28.6139, 77.209, t0 + 60_000);      // arrives
        expect(await cmds()).toEqual(["Reached office"]);
        await at(28.6139, 77.209, t0 + 120_000);     // still there: nothing new
        expect(await cmds()).toEqual(["Reached office"]);
        await at(28.7, 77.3, t0 + 180_000);          // leaves, but the leave window (00:00-01:00) is not now unless it is that hour
        const local = automation.localParts(t0 + 180_000, "Asia/Kolkata").minutes;
        expect((await cmds()).length).toBe(local < 60 ? 2 : 1);
    });
});

describe("on the way home, and Telegram control", () => {
    test("a phone heading home gets an ETA, announced once, and the assistant answers", async () => {
        const auth = await signUp();
        const tab = await pair(auth, "hub");
        await pair(auth, "phone", "Papa phone");
        await report(tab.token, { status: { agent: "stashr-hub" } });
        const all = (await devices(auth)).devices;
        const phoneId = all.find((d) => d.kind === "phone").id;
        const owner = (await HomeDevice.findById(phoneId)).owner;
        expect((await request(app).put("/home/settings").set(auth).send({ homeSpot: { lat: 91, lon: 77 } })).status).toBe(400);
        expect((await request(app).put("/home/settings").set(auth).send({ homeSpot: { lat: 28.6139, lon: 77.209, radius: 200 } })).status).toBe(200);
        const t0 = Date.now();
        const fix = async (lat, when) => { await HomeDevice.updateOne({ _id: phoneId }, { $set: { "status.location": { lat, lon: 77.209, acc: 20, at: when, speed: 10 } } }); await automation.tickOwner(owner, when); };
        await fix(28.70, t0);                        // ~9.6 km north: first sighting, direction unknown
        expect(automation.comingList(await automation.settingsOf(owner), t0)).toEqual([]);
        await fix(28.68, t0 + 120_000);              // closer: heading home (~7.4 km, 10 m/s)
        const list = automation.comingList(await automation.settingsOf(owner), t0 + 120_000);
        expect(list.length).toBe(1);
        expect(list[0].minutes > 10).toBe(true);
        expect(list[0].minutes < 25).toBe(true);
        await fix(28.63, t0 + 240_000);              // ~2 km: inside the notify window
        const ev = await HomeEvent.find({ kind: "eta" }).lean();
        expect(ev.length).toBe(1);
        await fix(28.625, t0 + 300_000);
        expect((await HomeEvent.find({ kind: "eta" }).lean()).length).toBe(1);
        const r = await request(app).post("/home/assistant").set(auth).send({ text: "papa kab aayenge" });
        expect(r.body.reply).toMatch(/minute mein aa rahe hain/);
        const dash = await request(app).get("/home/agent/dashboard").set(bearer(tab.token));
        expect(dash.body.coming.length).toBe(1);
        await fix(28.6139, t0 + 360_000);            // home
        expect(automation.comingList(await automation.settingsOf(owner), t0 + 360_000)).toEqual([]);
    });

    test("Telegram sentences go to the same assistant", async () => {
        const auth = await signUp();
        const user = await User.findOne({ email: "ana@example.com" });
        const bot = require("../utils/telegramBot");
        expect(await bot.homeSay(user, "pause the tv")).toBe(null);   // no devices yet
        await request(app).post("/home/devices").set(auth).send({ name: "TV", kind: "tv" });
        const reply = await bot.homeSay(user, "pause the tv");
        expect(reply).toMatch(/Pausing/);
        expect(await bot.homeSay(user, "blah blah")).toBe(null);
        expect(await bot.homeSay(user, "today")).toMatch(/Today at home/);
    });
});

describe("Stashr Location: the location-only app", () => {
    const loc = (token, lat, at, extra = {}) => request(app).post("/home/agent/location").set(bearer(token)).send({ lat, lon: 77.209, acc: 25, at, speed: 10, battery: { pct: 80, charging: false }, wifi: { connected: false, ip: "" }, ...extra });

    test("link with the fixed code, name it, report, and be told when to look again", async () => {
        const auth = await signUp();
        const code = (await request(app).get("/home/location-code").set(auth)).body.code;
        expect(code).toMatch(/^[A-Z0-9]{8}$/);
        expect((await request(app).get("/home/location-code").set(auth)).body.code).toBe(code);   // fixed
        expect((await request(app).post("/home/agent/link").send({ code: "WRONGCODE", name: "Parveen" })).status).toBe(400);
        expect((await request(app).post("/home/agent/link").send({ code, name: "P" })).status).toBe(400);
        const link = await request(app).post("/home/agent/link").send({ code: code.toLowerCase(), name: "Parveen Chawla" });
        expect(link.status).toBe(201);
        expect((await request(app).post("/home/agent/link").send({ code, name: "parveen chawla" })).status).toBe(409);
        const t = link.body.token;
        // no home yet
        const first = await loc(t, 28.70, Date.now());
        expect(first.body.state).toBe("unset");
        expect(first.body.nextCheckSec).toBe(900);
        await request(app).put("/home/settings").set(auth).send({ homeSpot: { lat: 28.6139, lon: 77.209, radius: 200 } });
        const far = await loc(t, 28.9, Date.now());                        // ~32 km, first sighting with a home set
        expect(far.body.state).toBe("away");
        expect(far.body.nextCheckSec).toBe(1800);                          // far and not heading home: rarely
        const near = await loc(t, 28.75, Date.now() + 1000);               // closer: heading home
        expect(near.body.state).toBe("coming");
        expect(near.body.nextCheckSec).toBe(300);                          // ~15 km: every 5 minutes
        const where = (await request(app).get("/home/where").set(auth)).body;
        expect(where.homeSet).toBe(true);
        expect(where.people[0].name).toBe("Parveen Chawla");
        expect(where.people[0].state).toBe("coming");
        // disconnect itself
        expect((await request(app).post("/home/agent/unlink").set(bearer(t))).status).toBe(200);
        expect((await loc(t, 28.8, Date.now())).status).toBe(401);
        // a new code replaces the old one
        const fresh = (await request(app).post("/home/location-code/rotate").set(auth)).body.code;
        expect(fresh === code).toBe(false);
        expect((await request(app).post("/home/agent/link").send({ code, name: "Other Person" })).status).toBe(400);
    });

    test("arriving in N mins and 'open the door' go to the tablet, the TV and the other phones", async () => {
        const auth = await signUp();
        const tab = await pair(auth, "hub");
        await report(tab.token, { status: { agent: "stashr-hub" } });
        const tv = (await request(app).post("/home/devices").set(auth).send({ name: "TV", kind: "tv" })).body;
        await report(tv.token, { status: { screen: "on" } });
        const code = (await request(app).get("/home/location-code").set(auth)).body.code;
        const a = (await request(app).post("/home/agent/link").send({ code, name: "Parveen Chawla" })).body;
        const b = (await request(app).post("/home/agent/link").send({ code, name: "Mom" })).body;
        await loc(b.token, 28.6139, Date.now());                           // Mom keeps her app alive so she gets notices
        await request(app).put("/home/settings").set(auth).send({ homeSpot: { lat: 28.6139, lon: 77.209, radius: 200 } });
        const t0 = Date.now();
        await loc(a.token, 28.66, t0);                                     // ~5 km, first sighting
        await loc(a.token, 28.64, t0 + 60_000);                            // ~3 km closer: coming, about 10 min
        const hub = async () => (await HomeDevice.findOne({ kind: "hub" }).lean()).commands.filter((c) => c.type === "announce").map((c) => c.args.text);
        expect((await hub()).some((x) => /Parveen Chawla is arriving in \d+ mins/.test(x))).toBe(true);
        const tvCmds = (await HomeDevice.findOne({ kind: "tv" }).lean()).commands.filter((c) => c.type === "notify");
        expect(tvCmds.length > 0).toBe(true);
        // Mom's app is told when she reports; Parveen is not told about himself
        const mom = await loc(b.token, 28.6139, Date.now() + 2000);
        expect(mom.body.notices.some((n) => /Parveen Chawla is arriving/.test(n.text))).toBe(true);
        const own = await loc(a.token, 28.64, t0 + 90_000);
        expect(own.body.notices.some((n) => /Parveen Chawla/.test(n.text))).toBe(false);   // never told about himself
        await loc(a.token, 28.6140, t0 + 120_000);                         // inside the circle: arrived
        expect((await hub()).some((x) => /Open the door: Parveen Chawla arrived home/.test(x))).toBe(true);
    });
});

describe("linking the tablet with a fixed code", () => {
    test("the tablet code is separate from the family-phone code", async () => {
        const auth = await signUp();
        const hubCode = (await request(app).get("/home/hub-code").set(auth)).body.code;
        const phoneCode = (await request(app).get("/home/location-code").set(auth)).body.code;
        expect(hubCode).toMatch(/^[A-Z0-9]{8}$/);
        expect(hubCode === phoneCode).toBe(false);
        expect((await request(app).get("/home/hub-code").set(auth)).body.code).toBe(hubCode);
        // the family-phone code cannot link a tablet, and the tablet code cannot link a family phone
        expect((await request(app).post("/home/agent/link").send({ code: phoneCode, name: "Hall tablet", kind: "hub" })).status).toBe(400);
        expect((await request(app).post("/home/agent/link").send({ code: hubCode, name: "Papa" })).status).toBe(400);
        const ok = await request(app).post("/home/agent/link").send({ code: hubCode, name: "Hall tablet", kind: "hub" });
        expect(ok.status).toBe(201);
        expect(ok.body.device.kind).toBe("hub");
        const list = (await devices(auth)).devices;
        expect(list.some((d) => d.kind === "hub" && d.name === "Hall tablet")).toBe(true);
        const rep = await report(ok.body.token, { status: { agent: "stashr-hub" } });
        expect(rep.status).toBe(200);
        expect((await request(app).post("/home/agent/link").send({ code: hubCode, name: "hall TABLET", kind: "hub" })).status).toBe(409);
        // the same code links a TV, which then reports on its own
        const tv = await request(app).post("/home/agent/link").send({ code: hubCode, name: "Living room TV", kind: "tv" });
        expect(tv.status).toBe(201);
        expect(tv.body.device.kind).toBe("tv");
        expect((await report(tv.body.token, { status: { screen: "on", app: { label: "Netflix" }, agent: "stashr-tv" } })).status).toBe(200);
        expect((await devices(auth)).devices.some((d) => d.kind === "tv" && d.name === "Living room TV" && d.online)).toBe(true);
        const fresh = (await request(app).post("/home/hub-code/rotate").set(auth)).body.code;
        expect(fresh === hubCode).toBe(false);
    });
});

describe("arrival time by road", () => {
    const routeMod = require("../utils/homeRoute");
    test("the road time and distance replace the straight line, asked again only after 3 minutes or 400 m", async () => {
        const auth = await signUp();
        const code = (await request(app).get("/home/location-code").set(auth)).body.code;
        const t = (await request(app).post("/home/agent/link").send({ code, name: "Papa" })).body.token;
        await request(app).put("/home/settings").set(auth).send({ homeSpot: { lat: 28.6139, lon: 77.209, radius: 200 } });
        let calls = 0;
        routeMod.use(async () => { calls++; return { seconds: 1500, meters: 18000 }; });
        try {
            const loc = (lat, at, speed = 10) => request(app).post("/home/agent/location").set(bearer(t)).send({ lat, lon: 77.209, acc: 20, at, speed });
            const t0 = Date.now();
            await loc(28.70, t0);                                    // first sighting
            const r = await loc(28.68, t0 + 1000);                   // ~7 km straight, heading home
            expect(r.body.state).toBe("coming");
            expect(r.body.etaMinutes).toBe(25);                      // from the road, not 16 from the straight line
            expect(r.body.distanceKm).toBe(18);
            const callsBefore = calls;
            await loc(28.679, t0 + 2000);                            // 110 m on, seconds later: reuses the last route
            expect(calls).toBe(callsBefore);
            // the service is down: back to the straight-line estimate
            routeMod.use(async () => null);
            const f = await loc(28.64, t0 + 400_000);
            expect(f.body.etaMinutes < 12).toBe(true);
            // walking pace near home keeps the straight line (no road call)
            routeMod.use(async () => { calls += 100; return { seconds: 60, meters: 100 }; });
            const before = calls;
            await loc(28.6350, t0 + 800_000, 1);
            expect(calls).toBe(before);
        } finally { routeMod.use(null); }
    });
});

describe("live traffic from Mapbox", () => {
    const routeMod = require("../utils/homeRoute");
    test("with a Mapbox token the traffic time is used; without it, or when it fails, OSRM answers", async () => {
        const realFetch = global.fetch;
        const seen = [];
        global.fetch = async (url) => {
            seen.push(String(url));
            if (String(url).includes("api.mapbox.com")) return { ok: true, json: async () => ({ code: "Ok", routes: [{ duration: 1800, distance: 15000 }] }) };
            return { ok: true, json: async () => ({ code: "Ok", routes: [{ duration: 900, distance: 14000 }] }) };
        };
        process.env.HOME_ROUTING = "on";
        try {
            delete process.env.MAPBOX_TOKEN;
            const a = await routeMod.drivingRoute({ lat: 28.7, lon: 77.2 }, { lat: 28.6, lon: 77.2 });
            expect(a).toEqual({ seconds: 900, meters: 14000 });
            process.env.MAPBOX_TOKEN = "pk.eyJ1IjoidGVzdCIsImEiOiJ0ZXN0dG9rZW4xMjM0NTY3ODkwIn0.abcdefghijklmnop";
            const b = await routeMod.drivingRoute({ lat: 28.7, lon: 77.2 }, { lat: 28.6, lon: 77.2 });
            expect(b).toEqual({ seconds: 1800, meters: 15000, traffic: true });
            expect(seen.some((u) => u.includes("driving-traffic/77.20000,28.70000;77.20000,28.60000"))).toBe(true);
            // Mapbox fails: OSRM answers
            global.fetch = async (url) => (String(url).includes("api.mapbox.com") ? { ok: false } : { ok: true, json: async () => ({ code: "Ok", routes: [{ duration: 900, distance: 14000 }] }) });
            expect(await routeMod.drivingRoute({ lat: 28.7, lon: 77.2 }, { lat: 28.6, lon: 77.2 })).toEqual({ seconds: 900, meters: 14000 });
            // a token that is not a public token is never sent
            process.env.MAPBOX_TOKEN = "sk.secret-token-should-never-be-used-here-1234567890";
            expect(routeMod.hasTraffic()).toBe(false);
        } finally { global.fetch = realFetch; delete process.env.MAPBOX_TOKEN; process.env.HOME_ROUTING = "off"; }
    });
});

describe("TV home: weather, headlines, movie night; rain reminder", () => {
    const newsMod = require("../utils/homeNews");
    test("headlines are parsed from the RSS feed", () => {
        const xml = `<rss><channel><item><title>Big rain in Delhi &amp; NCR - The Hindu</title><source url="x">The Hindu</source><pubDate>Mon, 02 Nov 2026 03:00:00 GMT</pubDate></item><item><title><![CDATA[Markets rise - Mint]]></title><pubDate>Mon, 02 Nov 2026 02:00:00 GMT</pubDate></item></channel></rss>`;
        const items = newsMod.parse(xml);
        expect(items[0]).toEqual({ title: "Big rain in Delhi & NCR", source: "The Hindu", at: Date.parse("Mon, 02 Nov 2026 03:00:00 GMT") });
        expect(items[1].title).toBe("Markets rise");
        expect(items[1].source).toBe("Mint");
    });

    test("the TV asks for its home screen data; movie night needs everyone home on a weekend evening", async () => {
        const auth = await signUp();
        const tv = (await request(app).post("/home/devices").set(auth).send({ name: "TV", kind: "tv" })).body;
        newsMod.use(async (lang) => [{ title: lang === "hi" ? "खबर" : "News one", source: "S", at: 1 }]);
        try {
            const r = await request(app).get("/home/agent/tv-home").set(bearer(tv.token));
            expect(r.status).toBe(200);
            expect(r.body.news[0].title).toBe("News one");
            expect(r.body.movieNight).toBe(false);
            await request(app).put("/home/settings").set(auth).send({ news: { lang: "both", count: 2 } });
            expect((await request(app).get("/home/agent/tv-home").set(bearer(tv.token))).body.news.length).toBe(2);
            expect((await request(app).put("/home/settings").set(auth).send({ news: { lang: "fr" } })).status).toBe(400);
            await request(app).put("/home/settings").set(auth).send({ news: { enabled: false } });
            expect((await request(app).get("/home/agent/tv-home").set(bearer(tv.token))).body.news).toEqual([]);
        } finally { newsMod.use(null); }
        // movie night rule, directly
        const sat = Date.UTC(2026, 10, 7, 15, 0);      // Saturday 20:30 in India
        const wed = Date.UTC(2026, 10, 4, 15, 0);
        const hubHome = { kind: "hub", lanBook: { "n-mom": { ip: "1", up: true, lastSeen: sat } }, lanLabels: { "n-mom": { person: "Mom" } } };
        expect(automation.movieNightOn({ timezone: "Asia/Kolkata" }, [hubHome], sat)).toBe(true);
        expect(automation.movieNightOn({ timezone: "Asia/Kolkata" }, [{ ...hubHome, lanBook: { "n-mom": { ip: "1", up: true, lastSeen: wed } } }], wed)).toBe(false);
        expect(automation.movieNightOn({ timezone: "Asia/Kolkata" }, [{ ...hubHome, lanBook: { "n-mom": { ip: "1", up: false, lastSeen: sat - 3600_000 } } }], sat)).toBe(false);
    });

    test("leaving home when rain is likely tells that person (only) to take an umbrella", async () => {
        const auth = await signUp();
        const code = (await request(app).get("/home/location-code").set(auth)).body.code;
        const a = (await request(app).post("/home/agent/link").send({ code, name: "Papa" })).body;
        const b = (await request(app).post("/home/agent/link").send({ code, name: "Mom" })).body;
        await request(app).put("/home/settings").set(auth).send({ homeSpot: { lat: 28.6139, lon: 77.209, radius: 200 } });
        const owner = (await HomeSettings.findOne({}).lean()).owner;
        await HomeSettings.updateOne({ owner }, { $set: { "weather.lat": 28.6, "weather.lon": 77.2, "weather.city": "Delhi" } });
        const realFetch = global.fetch;
        global.fetch = async (url) => (String(url).includes("open-meteo") ? { ok: true, json: async () => ({ current: { temperature_2m: 25, apparent_temperature: 26, weather_code: 61 }, daily: { temperature_2m_max: [28], temperature_2m_min: [22], precipitation_probability_max: [80] } }) } : realFetch(url));
        try {
            const loc = (t, lat, at) => request(app).post("/home/agent/location").set(bearer(t)).send({ lat, lon: 77.209, acc: 20, at, speed: 10 });
            const t0 = Date.now();
            await loc(a.token, 28.6139, t0);           // Papa at home
            await loc(b.token, 28.6139, t0);
            const out = await loc(a.token, 28.64, t0 + 60_000);   // Papa leaves
            const after = await loc(a.token, 28.645, t0 + 61_000);
            const notices = [...out.body.notices, ...after.body.notices].map((n) => n.text);
            const mom = await loc(b.token, 28.6139, t0 + 62_000);
            expect(notices.length + (await HomeDevice.findOne({ name: "Papa" }).lean()).commands.filter((c) => c.type === "notice" && /Chhatri/.test(c.args.text)).length > 0).toBe(true);
            expect(mom.body.notices.some((n) => /Chhatri/.test(n.text))).toBe(false);
            await request(app).put("/home/settings").set(auth).send({ rain: false });
            expect((await request(app).get("/home/settings").set(auth)).body.rain).toBe(false);
        } finally { global.fetch = realFetch; }
    });
});

