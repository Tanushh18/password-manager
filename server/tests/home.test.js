const { describe, test, before: beforeAll, after: afterAll, beforeEach } = require("node:test");
const expect = require("./expect");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const request = require("supertest");

process.env.SECRET_KEY = "test-secret";
process.env.CRYPTO_SECRET_KEY = "test-crypto-secret";
process.env.RATE_LIMIT_MAX = "1000";
process.env.ALLOW_SIGNUP = "true"; // sign-ups are closed by default; these tests make their own accounts

const app = require("../app");
const User = require("../models/schema");
const HomeDevice = require("../models/homeDevice");
const HomeEvent = require("../models/homeEvent");
const home = require("../utils/home");
const { sweepOnce } = require("../utils/homeSweep");

let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => { await User.deleteMany({}); await HomeDevice.deleteMany({}); await HomeEvent.deleteMany({}); });

const signUp = async (email = "ana@example.com") => {
    await request(app).post("/register").send({ name: "Ana", email, password: "master-pass", cpassword: "master-pass" });
    const res = await request(app).post("/login").send({ email, password: "master-pass", client: "mobile" });
    return { Authorization: `Bearer ${res.body.token}` };
};
const addDevice = async (auth, body = { name: "Living room TV", kind: "tv" }) => (await request(app).post("/home/devices").set(auth).send(body));
const report = (token, body) => request(app).post("/home/agent/report").set("Authorization", `Bearer ${token}`).send(body);

describe("home: pure rules", () => {
    test("commands are checked per device kind and keep only known arguments", () => {
        expect(home.cleanCommand("tv", "volume", { action: "up", extra: 1 })).toEqual({ type: "volume", args: { action: "up" } });
        expect(home.cleanCommand("tv", "volume", { level: 55 }).args).toEqual({ level: 55 });
        expect(home.cleanCommand("tv", "volume", { level: 500 })).toBe(null);
        expect(home.cleanCommand("tv", "launch_app", { package: "com.netflix.ninja" }).args.package).toBe("com.netflix.ninja");
        expect(home.cleanCommand("tv", "launch_app", { package: "x; rm -rf /" })).toBe(null);
        expect(home.cleanCommand("tv", "remove_movie", { name: "" })).toBe(null);
        expect(home.cleanCommand("tv", "scan_now", {})).toBe(null);   // a hub command
        expect(home.cleanCommand("hub", "scan_now", {})).toEqual({ type: "scan_now", args: {} });
        expect(home.cleanCommand("tv", "format_disk", {})).toBe(null);
        expect(home.cleanCommand("tv", "open_url", { url: "https://www.youtube.com/watch?v=abc" }).args.url).toMatch(/youtube/);
        expect(home.cleanCommand("tv", "open_url", { url: "https://youtube.com.evil.example/x" })).toBe(null);
        expect(home.cleanCommand("tv", "open_url", { url: "http://www.youtube.com/watch?v=abc" })).toBe(null);
        expect(home.cleanCommand("tv", "open_url", { url: "intent://x#Intent;end" })).toBe(null);
        expect(home.cleanCommand("tv", "open_url", { url: "https://user:pw@www.youtube.com/x" })).toBe(null);
    });

    test("a status with operator-looking keys or an oversized body is cleaned or refused", () => {
        const s = home.cleanStatus({ ok: 1, "$where": "x", "a.b": 2, nested: { "$set": 1, keep: "y" } });
        expect(s.ok).toBe(1);
        expect(s.$where).toBe(undefined);
        expect(s["a.b"]).toBe(undefined);
        expect(s.nested.keep).toBe("y");
        expect(home.cleanStatus("nope")).toBe(null);
        expect(home.cleanStatus({ big: "x".repeat(100) .repeat(0) + Array.from({ length: 400 }, () => "y".repeat(500)) })).not.toBe(null);
    });

    test("the Wi-Fi book: new, joined, left, and no noise for a blink", () => {
        const t0 = 1_000_000_000_000;
        const a = home.mergeLan({}, [{ ip: "192.168.1.20", name: "phone", up: true }], {}, t0);
        expect(a.events.map((e) => e.kind)).toEqual(["lan_new"]);
        const blink = home.mergeLan(a.book, [], {}, t0 + 60_000);                       // missed one scan: still up
        expect(blink.events).toEqual([]);
        expect(Object.values(blink.book)[0].up).toBe(true);
        const doze = home.mergeLan(a.book, [], {}, t0 + 10 * 60_000);                   // a dozing phone: no "left"
        expect(doze.events).toEqual([]);
        const gone = home.mergeLan(a.book, [], {}, t0 + 16 * 60_000);                   // gone for 16 minutes
        expect(gone.events.map((e) => e.kind)).toEqual(["lan_left"]);
        expect(Object.values(gone.book)[0].up).toBe(false);
        const back = home.mergeLan(gone.book, [{ ip: "192.168.1.20", up: true }], {}, t0 + 40 * 60_000);
        expect(back.events.map((e) => e.kind)).toEqual(["lan_joined"]);
        expect(Object.values(back.book)[0].firstSeen).toBe(t0);                         // first seen is kept
        expect(Object.values(back.book)[0].name).toBe("phone");                         // so is the name
    });
});

describe("home: devices", () => {
    test("adding a device returns its token once, and the list never shows the token or its hash", async () => {
        const auth = await signUp();
        const res = await addDevice(auth);
        expect(res.status).toBe(201);
        expect(res.body.token).toMatch(/^sh_[a-f0-9]{48}$/);
        const list = await request(app).get("/home/devices").set(auth);
        expect(list.body.devices.length).toBe(1);
        expect(JSON.stringify(list.body)).not.toContain(res.body.token);
        expect(JSON.stringify(list.body)).not.toContain("tokenHash");
        expect(list.body.devices[0].online).toBe(false);
    });

    test("only valid kinds and names, at most twenty devices", async () => {
        const auth = await signUp();
        expect((await addDevice(auth, { name: "", kind: "tv" })).status).toBe(400);
        expect((await addDevice(auth, { name: "x", kind: "phone" })).status).toBe(400);
        for (let i = 0; i < 20; i++) expect((await addDevice(auth, { name: "d" + i, kind: "hub" })).status).toBe(201);
        expect((await addDevice(auth, { name: "one too many", kind: "hub" })).status).toBe(400);
    });

    test("another account cannot see, command or delete my device", async () => {
        const ana = await signUp();
        const bob = await signUp("bob@example.com");
        const d = (await addDevice(ana)).body.device;
        expect((await request(app).get("/home/devices").set(bob)).body.devices).toEqual([]);
        expect((await request(app).post(`/home/devices/${d.id}/commands`).set(bob).send({ type: "sync_now" })).status).toBe(404);
        expect((await request(app).delete(`/home/devices/${d.id}`).set(bob)).status).toBe(404);
        expect((await request(app).delete(`/home/devices/${d.id}`).set(ana)).status).toBe(200);
    });

    test("a device token cannot call anything except the report endpoint", async () => {
        const auth = await signUp();
        const { token } = (await addDevice(auth)).body;
        const bearer = { Authorization: `Bearer ${token}` };
        expect((await request(app).get("/home/devices").set(bearer)).status).toBe(401);
        expect((await request(app).get("/authenticate").set(bearer)).status).toBe(401);
        expect((await request(app).post("/home/agent/report").send({ status: {} })).status).toBe(401);
        expect((await report("sh_" + "0".repeat(48), { status: {} })).status).toBe(401);
        expect((await report("garbage", { status: {} })).status).toBe(401);
    });

    test("a new token replaces the old one", async () => {
        const auth = await signUp();
        const added = (await addDevice(auth)).body;
        const fresh = (await request(app).post(`/home/devices/${added.device.id}/token`).set(auth)).body.token;
        expect((await report(added.token, { status: { screen: "on" } })).status).toBe(401);
        expect((await report(fresh, { status: { screen: "on" } })).status).toBe(200);
    });
});

describe("home: the TV reports", () => {
    test("a report makes the TV online and shows its status; the timeline records it", async () => {
        const auth = await signUp();
        const { token } = (await addDevice(auth)).body;
        const r = await report(token, { status: { screen: "on", app: { label: "Netflix" }, usb: { free: 5e9 }, movies: [{ name: "A.mp4", size: 1 }] } });
        expect(r.status).toBe(200);
        const d = (await request(app).get("/home/devices").set(auth)).body.devices[0];
        expect(d.online).toBe(true);
        expect(d.status.app.label).toBe("Netflix");
        const ev = (await request(app).get("/home/events").set(auth)).body.events.map((e) => e.text);
        expect(ev.join("|")).toMatch(/Living room TV is on/);
    });

    test("screen on/off and movies added or removed make timeline entries", async () => {
        const auth = await signUp();
        const { token } = (await addDevice(auth)).body;
        await report(token, { status: { screen: "on", movies: [{ name: "A.mp4" }] } });
        await report(token, { status: { screen: "off", movies: [{ name: "A.mp4" }, { name: "B.mp4" }] } });
        await report(token, { status: { screen: "on", movies: [{ name: "B.mp4" }] } });
        const ev = (await request(app).get("/home/events").set(auth)).body.events.map((e) => e.text).join("|");
        expect(ev).toMatch(/went to standby/);
        expect(ev).toMatch(/turned on/);
        expect(ev).toMatch(/Movie on the USB drive: B.mp4/);
        expect(ev).toMatch(/Movie removed from the USB drive: A.mp4/);
    });

    test("when the TV says it is leaving it is offline at once", async () => {
        const auth = await signUp();
        const { token } = (await addDevice(auth)).body;
        await report(token, { status: { screen: "on" } });
        expect((await report(token, { leaving: true })).status).toBe(200);
        expect((await request(app).get("/home/devices").set(auth)).body.devices[0].online).toBe(false);
    });

    test("silence for three minutes makes the sweep mark it offline, once", async () => {
        const auth = await signUp();
        const { token, device } = (await addDevice(auth)).body;
        await report(token, { status: { screen: "on" } });
        await HomeDevice.updateOne({ _id: device.id }, { $set: { lastSeen: new Date(Date.now() - 5 * 60 * 1000) } });
        await sweepOnce();
        await sweepOnce();
        expect((await request(app).get("/home/devices").set(auth)).body.devices[0].online).toBe(false);
        const offlines = (await request(app).get("/home/events").set(auth)).body.events.filter((e) => e.kind === "offline");
        expect(offlines.length).toBe(1);
    });

    test("an oversized or missing status is refused", async () => {
        const auth = await signUp();
        const { token } = (await addDevice(auth)).body;
        expect((await report(token, {})).status).toBe(400);
        expect((await report(token, { status: { blob: "z".repeat(499) , list: Array.from({ length: 400 }, (_, i) => ({ a: "q".repeat(499), i })) } })).status).toBe(400);
    });
});

describe("home: commands", () => {
    test("a command goes out once, is acknowledged, and shows its result", async () => {
        const auth = await signUp();
        const { token, device } = (await addDevice(auth)).body;
        const sent = await request(app).post(`/home/devices/${device.id}/commands`).set(auth).send({ type: "volume", args: { action: "up" } });
        expect(sent.status).toBe(202);
        const first = await report(token, { status: { screen: "on" } });
        expect(first.body.commands).toEqual([{ id: sent.body.id, type: "volume", args: { action: "up" } }]);
        const second = await report(token, { status: { screen: "on" } });
        expect(second.body.commands).toEqual([]);                                   // not handed out twice
        await report(token, { status: { screen: "on" }, acks: [{ id: sent.body.id, ok: true, message: "volume 12" }] });
        const c = (await request(app).get("/home/devices").set(auth)).body.devices[0].commands[0];
        expect(c.status).toBe("done");
        expect(c.result).toBe("volume 12");
    });

    test("a failed command is shown as failed", async () => {
        const auth = await signUp();
        const { token, device } = (await addDevice(auth)).body;
        const sent = await request(app).post(`/home/devices/${device.id}/commands`).set(auth).send({ type: "remove_movie", args: { name: "Gone.mp4" } });
        await report(token, { status: {} });
        await report(token, { status: {}, acks: [{ id: sent.body.id, ok: false, message: "not found" }] });
        expect((await request(app).get("/home/devices").set(auth)).body.devices[0].commands[0].status).toBe("failed");
    });

    test("bad commands are refused, and so is a flood", async () => {
        const auth = await signUp();
        const { device } = (await addDevice(auth)).body;
        const post = (body) => request(app).post(`/home/devices/${device.id}/commands`).set(auth).send(body);
        expect((await post({ type: "delete_everything" })).status).toBe(400);
        expect((await post({ type: "scan_now" })).status).toBe(400);
        for (let i = 0; i < 20; i++) expect((await post({ type: "sync_now" })).status).toBe(202);
        expect((await post({ type: "sync_now" })).status).toBe(429);
    });

    test("a command nobody answers is failed by the sweep after ten minutes", async () => {
        const auth = await signUp();
        const { device } = (await addDevice(auth)).body;
        await request(app).post(`/home/devices/${device.id}/commands`).set(auth).send({ type: "sync_now" });
        await sweepOnce(Date.now() + 11 * 60 * 1000);
        const c = (await request(app).get("/home/devices").set(auth)).body.devices[0].commands[0];
        expect(c.status).toBe("failed");
        expect(c.result).toMatch(/No answer/);
    });
});

describe("home: the tablet hub and the Wi-Fi", () => {
    test("a scan builds the device list; names and rooms stick", async () => {
        const auth = await signUp();
        const { token, device } = (await addDevice(auth, { name: "Tablet", kind: "hub" })).body;
        await report(token, { status: { battery: { pct: 80 }, lan: [
            { ip: "192.168.1.30", name: "pixel", up: true, ports: [5555], pingMs: 12 },
            { ip: "192.168.1.31", name: "tv", up: true }
        ] } });
        const d = (await request(app).get("/home/devices").set(auth)).body.devices[0];
        expect(d.lan.length).toBe(2);
        expect(d.status.lanCount).toBe(2);
        expect(d.lan.find((x) => x.ip === "192.168.1.30").pingMs).toBe(12);
        expect(d.status.lan).toBe(undefined);
        const key = d.lan.find((x) => x.ip === "192.168.1.30").key;
        expect((await request(app).put(`/home/devices/${device.id}/lan/${key}`).set(auth).send({ label: "Mom's phone", room: "Bedroom" })).status).toBe(200);
        await report(token, { status: { lan: [{ ip: "192.168.1.30", up: true }, { ip: "192.168.1.31", up: true }] } });
        const again = (await request(app).get("/home/devices").set(auth)).body.devices[0].lan.find((x) => x.key === key);
        expect(again.label).toBe("Mom's phone");
        expect(again.room).toBe("Bedroom");
        expect(again.name).toBe("pixel");
    });

    test("a device that stops answering is marked down on the next scan after fifteen minutes", async () => {
        const auth = await signUp();
        const { token, device } = (await addDevice(auth, { name: "Tablet", kind: "hub" })).body;
        await report(token, { status: { lan: [{ ip: "192.168.1.40", up: true }] } });
        const stored = await HomeDevice.findById(device.id);
        const book = JSON.parse(JSON.stringify(stored.lanBook));
        Object.values(book)[0].lastSeen = Date.now() - 16 * 60 * 1000;
        await HomeDevice.updateOne({ _id: device.id }, { $set: { lanBook: book } });
        await report(token, { status: { lan: [] } });
        const d = (await request(app).get("/home/devices").set(auth)).body.devices[0];
        expect(d.lan[0].up).toBe(false);
        const ev = (await request(app).get("/home/events").set(auth)).body.events.map((e) => e.kind);
        expect(ev).toContain("lan_left");
        expect(ev).toContain("lan_new");
    });

    test("labels can only be set on a hub", async () => {
        const auth = await signUp();
        const { device } = (await addDevice(auth)).body; // a TV
        expect((await request(app).put(`/home/devices/${device.id}/lan/x`).set(auth).send({ label: "a" })).status).toBe(404);
    });
});

describe("home: a TV that reports through the tablet", () => {
    const hubReport = (token, body) => report(token, body);

    test("the TV shows up by itself, with no token, and its status is the one the tablet carried", async () => {
        const auth = await signUp();
        const { token } = (await addDevice(auth, { name: "Tablet", kind: "hub" })).body;
        const r = await hubReport(token, { status: { lan: [] }, children: [{ key: "tv", name: "Living room TV", seenAgoMs: 5000, status: { screen: "on", app: { label: "Netflix" }, movies: [{ name: "A.mp4" }] } }] });
        expect(r.status).toBe(200);
        const list = (await request(app).get("/home/devices").set(auth)).body.devices;
        expect(list.length).toBe(2);
        const tv = list.find((d) => d.kind === "tv");
        expect(tv.name).toBe("Living room TV");
        expect(tv.online).toBe(true);
        expect(tv.viaHub).toBe(true);
        expect(tv.status.app.label).toBe("Netflix");
        const ev = (await request(app).get("/home/events").set(auth)).body.events.map((e) => e.text).join("|");
        expect(ev).toMatch(/Living room TV is on/);
        expect(r.body.childCommands.tv).toEqual([]);
    });

    test("the TV is not made twice, and a stale report marks it offline soon", async () => {
        const auth = await signUp();
        const { token } = (await addDevice(auth, { name: "Tablet", kind: "hub" })).body;
        await hubReport(token, { status: {}, children: [{ key: "tv", name: "TV", status: { screen: "on" } }] });
        await hubReport(token, { status: {}, children: [{ key: "tv", name: "TV", seenAgoMs: 4 * 60 * 1000, status: { screen: "on" } }] });
        const list = (await request(app).get("/home/devices").set(auth)).body.devices;
        expect(list.filter((d) => d.kind === "tv").length).toBe(1);
        expect(list.find((d) => d.kind === "tv").online).toBe(false);   // last spoke four minutes ago
    });

    test("commands for the TV come back to the tablet, and the TV's answers go the same way", async () => {
        const auth = await signUp();
        const { token } = (await addDevice(auth, { name: "Tablet", kind: "hub" })).body;
        await hubReport(token, { status: {}, children: [{ key: "tv", name: "TV", status: { screen: "on" } }] });
        const tv = (await request(app).get("/home/devices").set(auth)).body.devices.find((d) => d.kind === "tv");
        const sent = await request(app).post(`/home/devices/${tv.id}/commands`).set(auth).send({ type: "volume", args: { action: "up" } });
        expect(sent.status).toBe(202);
        const out = await hubReport(token, { status: {}, children: [{ key: "tv", status: { screen: "on" } }] });
        expect(out.body.childCommands.tv).toEqual([{ id: sent.body.id, type: "volume", args: { action: "up" } }]);
        const again = await hubReport(token, { status: {}, children: [{ key: "tv", status: { screen: "on" } }] });
        expect(again.body.childCommands.tv).toEqual([]);
        await hubReport(token, { status: {}, children: [{ key: "tv", status: { screen: "on" }, acks: [{ id: sent.body.id, ok: true, message: "volume 9/15" }] }] });
        const c = (await request(app).get("/home/devices").set(auth)).body.devices.find((d) => d.kind === "tv").commands[0];
        expect(c.status).toBe("done");
        expect(c.result).toBe("volume 9/15");
    });

    test("only a tablet can carry a TV, keys are checked, and at most three", async () => {
        const auth = await signUp();
        const tv = (await addDevice(auth)).body;
        await report(tv.token, { status: { screen: "on" }, children: [{ key: "x", status: {} }] });
        expect((await request(app).get("/home/devices").set(auth)).body.devices.length).toBe(1);
        const { token } = (await addDevice(auth, { name: "Tablet", kind: "hub" })).body;
        await hubReport(token, { status: {}, children: ["nope", { key: "BAD KEY!", status: {} }, { key: "a", status: {} }] });
        expect((await request(app).get("/home/devices").set(auth)).body.devices.filter((d) => d.viaHub).length).toBe(1);   // the bad ones are ignored
        await hubReport(token, { status: {}, children: [{ key: "a", status: {} }, { key: "b", status: {} }, { key: "c", status: {} }, { key: "d", status: {} }] });
        await hubReport(token, { status: {}, children: [{ key: "d", status: {} }] });
        expect((await request(app).get("/home/devices").set(auth)).body.devices.filter((d) => d.viaHub).length).toBe(3);   // a, b, c; the fourth is not made
    });

    test("a TV behind the tablet has no token to renew, does not count toward the twenty, and goes when the tablet goes", async () => {
        const auth = await signUp();
        const { token, device } = (await addDevice(auth, { name: "Tablet", kind: "hub" })).body;
        await hubReport(token, { status: {}, children: [{ key: "tv", name: "TV", status: { screen: "on" } }] });
        const tv = (await request(app).get("/home/devices").set(auth)).body.devices.find((d) => d.viaHub);
        expect((await request(app).post(`/home/devices/${tv.id}/token`).set(auth)).status).toBe(404);
        for (let i = 0; i < 19; i++) expect((await addDevice(auth, { name: "d" + i, kind: "hub" })).status).toBe(201);  // twenty tablets in all
        expect((await addDevice(auth, { name: "twenty-first", kind: "hub" })).status).toBe(400);
        expect((await request(app).delete(`/home/devices/${device.id}`).set(auth)).status).toBe(200);
        expect((await request(app).get("/home/devices").set(auth)).body.devices.some((d) => d.viaHub)).toBe(false);
    });
});

describe("home: the tablet signs itself in", () => {
    test("signing in again as the same tablet keeps one tablet and replaces its token", async () => {
        const auth = await signUp();
        const first = await request(app).post("/home/devices").set(auth).send({ name: "Tablet", kind: "hub", reuse: true });
        expect(first.status).toBe(201);
        const second = await request(app).post("/home/devices").set(auth).send({ name: "Tablet", kind: "hub", reuse: true });
        expect(second.status).toBe(200);
        expect(second.body.device.id).toBe(first.body.device.id);
        expect(second.body.token).not.toBe(first.body.token);
        expect((await request(app).get("/home/devices").set(auth)).body.devices.length).toBe(1);
        expect((await report(first.body.token, { status: {} })).status).toBe(401);   // the old token is dead
        expect((await report(second.body.token, { status: {} })).status).toBe(200);
    });

    test("the tablet's session ends right after it has its token", async () => {
        await request(app).post("/register").send({ name: "Ana", email: "ana@example.com", password: "master-pass", cpassword: "master-pass" });
        const login = await request(app).post("/login").send({ email: "ana@example.com", password: "master-pass", client: "mobile" });
        const auth = { Authorization: `Bearer ${login.body.token}` };
        const made = await request(app).post("/home/devices").set(auth).send({ name: "Tablet", kind: "hub", reuse: true });
        expect(made.status).toBe(201);
        expect((await request(app).get("/logout").set(auth)).status).toBe(200);
        expect((await request(app).get("/home/devices").set(auth)).status).toBe(401);          // the sign-in is gone
        expect((await report(made.body.token, { status: {} })).status).toBe(200);              // the tablet's own token still works
    });
});

describe("home: renaming", () => {
    test("you can rename your own device, and nobody else's", async () => {
        const ana = await signUp(), bob = await signUp("bob@example.com");
        const d = (await addDevice(ana)).body.device;
        expect((await request(app).put(`/home/devices/${d.id}`).set(ana).send({ name: "  Bedroom TV " })).status).toBe(200);
        expect((await request(app).get("/home/devices").set(ana)).body.devices[0].name).toBe("Bedroom TV");
        expect((await request(app).put(`/home/devices/${d.id}`).set(bob).send({ name: "Mine now" })).status).toBe(404);
        expect((await request(app).put(`/home/devices/${d.id}`).set(ana).send({ name: "   " })).status).toBe(400);
    });
});
