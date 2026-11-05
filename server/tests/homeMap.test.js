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
process.env.HOME_ROUTING = "off";
const map = require("../utils/homeMap");

describe("access points and zones", () => {
    test("a BSSID is cleaned, and the radios of one access point are the same zone", () => {
        expect(map.normBssid("AA:BB:CC:DD:EE:01")).toBe("aa:bb:cc:dd:ee:01");
        expect(map.normBssid("02:00:00:00:00:00")).toBe("");
        expect(map.normBssid("<unknown ssid>")).toBe("");
        expect(map.apOf("aa:bb:cc:dd:ee:01")).toBe(map.apOf("aa:bb:cc:dd:ee:02"));     // 2.4 and 5 GHz of one router
        expect(map.apOf("aa:bb:cc:dd:ee:01")).not.toBe(map.apOf("aa:bb:cc:dd:ff:01"));
        expect(map.subnetOf("192.168.1.30")).toBe("192.168.1");
        expect(map.subnetOf("nope")).toBe("");
    });

    const devices = [{ id: "hub1", kind: "hub", name: "Hall tablet" }, { id: "p1", kind: "phone", name: "Papa" }];
    const day = 86400000, now = Date.UTC(2026, 10, 5, 12, 0);
    const night = { "21": 30, "22": 30, "23": 20 };           // UTC 21-23 = 02:30-05:30 in India: the phone sleeps here
    const rows = [
        { device: "hub1", ap: "aa:bb:cc:dd:ee", bssid: "aa:bb:cc:dd:ee:01", count: 300, h: { "6": 100 }, firstSeen: now - 10 * day, lastSeen: now },
        { device: "p1", ap: "aa:bb:cc:dd:ee", bssid: "aa:bb:cc:dd:ee:02", count: 40, h: { "7": 40 }, firstSeen: now - 10 * day, lastSeen: now },
        { device: "p1", ap: "11:22:33:44:55", bssid: "11:22:33:44:55:01", count: 80, h: night, firstSeen: now - 9 * day, lastSeen: now },
        { device: "p1", ap: "de:ad:be:ef:00", bssid: "de:ad:be:ef:00:01", count: 2, h: {}, firstSeen: now, lastSeen: now }     // two sightings: noise, not a zone
    ];

    test("zones are learned, noise is ignored, names are guessed from habits and your names win", () => {
        const z = map.learn({ rows, devices, names: {}, offsetHours: 5.5 === 5.5 ? 5 : 5, now });
        expect(z.map((x) => x.id)).toEqual(["aa:bb:cc:dd:ee", "11:22:33:44:55"]);
        expect(z[0].bssids.length).toBe(2);
        expect(z[0].hint).toMatch(/tablet sits here/);
        expect(z[1].hint).toMatch(/bedroom/);
        expect(z[0].name).toBe("Zone 1");
        expect(z[0].auto).toBe(true);
        const named = map.learn({ rows, devices, names: { "11:22:33:44:55": "Papa ka kamra" }, offsetHours: 5, now });
        expect(named[1].name).toBe("Papa ka kamra");
        expect(named[1].auto).toBe(false);
        expect(z[0].confidence > z[1].confidence).toBe(true);
    });

    test("one access point means one zone, and no hint is made up for it", () => {
        const z = map.learn({ rows: rows.slice(0, 2), devices, names: {}, offsetHours: 5, now });
        expect(z).toHaveLength(1);
        expect(z[0].hint).toBe("");
    });

    test("zones people walk between end up next to each other", () => {
        const z = ["a", "b", "c", "d"].map((id, i) => ({ id, observations: 100 - i }));
        const edges = [{ a: "a", b: "c", count: 9 }, { a: "c", b: "d", count: 5 }, { a: "a", b: "b", count: 1 }];
        const placed = map.layout(z, edges);
        expect(placed.map((p) => p.id)).toEqual(["a", "c", "d", "b"]);
        expect(placed[0]).toMatchObject({ x: 0, y: 0, w: 2, h: 2 });
        expect(placed[1].x).toBe(2.5);
        expect(map.layout([{ id: "x" }], [], [{ id: "room:Kitchen", name: "Kitchen" }]).map((p) => p.id)).toEqual(["x", "room:Kitchen"]);
    });

    test("rooms you gave devices become blocks; devices count as up only when seen lately", () => {
        const now2 = Date.now();
        const rooms = map.roomsFromLabels([{ lanLabels: { k1: { room: "Hall", label: "Sony TV", tag: "family" }, k2: { room: "" } }, lanBook: { k1: { up: true, lastSeen: now2 - 60000, ip: "192.168.1.9" }, k2: { up: true, lastSeen: now2 } } }], now2);
        expect(Object.keys(rooms)).toEqual(["Hall"]);
        expect(rooms.Hall[0]).toMatchObject({ label: "Sony TV", up: true });
    });
});

describe("the house layout you edit", () => {
    test("a saved layout is snapped and limited, only your rooms count, bad numbers are dropped", () => {
        const l = map.cleanLayout({ Bedroom: { x: 1.3, y: -4, w: 0.2, h: 99, z: 9 }, Kitchen: { x: "a", y: 0, w: 2, h: 2 }, Ghost: { x: 0, y: 0, w: 2, h: 2 }, Hall: { x: 2, y: 2.74, w: 2.2, h: 3 } }, ["Bedroom", "Kitchen", "Hall"]);
        expect(l.Bedroom).toEqual({ x: 1.5, y: 0, w: 1, h: 8, z: 3 });
        expect(l.Kitchen).toBeUndefined();
        expect(l.Ghost).toBeUndefined();
        expect(l.Hall).toEqual({ x: 2, y: 2.5, w: 2, h: 3, z: 0.55 });
        expect(map.cleanLayout(null, ["a"])).toEqual({});
    });

    test("a new room goes to a free place and never lands on a saved one", () => {
        const saved = { A: { x: 0, y: 0, w: 4, h: 4, z: 1 } };
        const blocks = [{ name: "A", x: 0, y: 0, w: 2, h: 2 }, { name: "B", x: 0, y: 0, w: 2, h: 2 }, { name: "C", x: 2.5, y: 0, w: 2, h: 2 }];
        const out = map.applyLayout(blocks, saved);
        const a = out.find((b) => b.name === "A"), b = out.find((x) => x.name === "B"), c = out.find((x) => x.name === "C");
        expect(a).toMatchObject({ x: 0, y: 0, w: 4, h: 4, z: 1 });
        expect(map.overlaps(a, b)).toBe(false);
        expect(map.overlaps(a, c)).toBe(false);
        expect(map.overlaps(b, c)).toBe(false);
        // nothing saved: the automatic layout is left exactly as it was
        const auto = [{ name: "A", x: 0, y: 0, w: 2, h: 2 }, { name: "B", x: 2.5, y: 0, w: 2, h: 2 }, { name: "C", x: 0, y: 2.5, w: 2, h: 2 }];
        expect(map.applyLayout(auto, {}).map((x) => [x.x, x.y])).toEqual([[0, 0], [2.5, 0], [0, 2.5]]);
    });

    test("free spots keep half a unit between blocks", () => {
        const spot = map.freeSpot([{ x: 0, y: 0, w: 2, h: 2 }], 2, 2);
        expect(spot.x >= 2.5 || spot.y >= 2.5).toBe(true);
    });
});

describe("the map through the server", () => {
    let mongo;
    const User = require("../models/schema"), HomeDevice = require("../models/homeDevice"), HomeSettings = require("../models/homeSettings"), HomeEvent = require("../models/homeEvent");
    const { HomeApSeen } = require("../models/homeApSeen");
    const app = require("../app");
    const automation = require("../utils/homeAutomation");
    beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
    afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
    beforeEach(async () => { for (const M of [User, HomeDevice, HomeSettings, HomeEvent, HomeApSeen]) await M.deleteMany({}); });
    const signUp = async () => {
        await request(app).post("/register").send({ name: "Ana", email: "ana@example.com", password: "master-pass", cpassword: "master-pass" });
        const res = await request(app).post("/login").send({ email: "ana@example.com", password: "master-pass", client: "mobile" });
        return { Authorization: `Bearer ${res.body.token}` };
    };
    const bearer = (t) => ({ Authorization: `Bearer ${t}` });

    test("rooms follow the room list, the layout you save is kept, a new room finds a free place, a removed room's block goes, reset goes back to automatic", async () => {
        const auth = await signUp();
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Kitchen"] });
        expect((await request(app).put("/home/map/layout").set(auth).send({ layout: { Ghost: { x: 0, y: 0, w: 2, h: 2 } } })).status).toBe(400);
        const saved = (await request(app).put("/home/map/layout").set(auth).send({ layout: { Bedroom: { x: 0, y: 0, w: 4, h: 3, z: 1.2 }, Kitchen: { x: 4.5, y: 0, w: 2, h: 2 } } })).body;
        expect(saved.layoutSaved).toBe(true);
        const bed = saved.zones.find((z) => z.name === "Bedroom");
        expect(bed).toMatchObject({ x: 0, y: 0, w: 4, h: 3, z: 1.2 });
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Kitchen", "Hall"] });          // one more room
        const three = (await request(app).get("/home/map").set(auth)).body;
        expect(three.zones.map((z) => z.name)).toEqual(["Bedroom", "Kitchen", "Hall"]);
        const hall = three.zones.find((z) => z.name === "Hall");
        for (const other of three.zones.filter((z) => z.name !== "Hall")) expect(map.overlaps(hall, other)).toBe(false);
        expect(three.zones.find((z) => z.name === "Bedroom")).toMatchObject({ x: 0, y: 0, w: 4, h: 3 });          // the saved ones did not move
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Hall"] });                    // Kitchen removed
        const two = (await request(app).get("/home/map").set(auth)).body;
        expect(two.zones.map((z) => z.name)).toEqual(["Bedroom", "Hall"]);
        expect((await HomeSettings.findOne({}).lean()).map.layout.Kitchen).toBeUndefined();
        const reset = (await request(app).put("/home/map/layout").set(auth).send({ reset: true })).body;
        expect(reset.layoutSaved).toBe(false);
        expect(reset.zones[0]).toMatchObject({ x: 0, y: 0, w: 2, h: 2 });                                         // the automatic grid again
        expect((await request(app).put("/home/map/layout").send({ reset: true })).status).toBe(401);
    });

    test("the tablet and a phone on the home Wi-Fi teach it two zones; an office Wi-Fi is ignored; names and the plan are saved", async () => {
        const auth = await signUp();
        const code = (await request(app).post("/home/pair-codes").set(auth).send({ kind: "hub", name: "Hall tablet" })).body.code;
        const tab = (await request(app).post("/home/agent/pair").send({ code })).body;
        const lc = (await request(app).get("/home/location-code").set(auth)).body.code;
        const ph = (await request(app).post("/home/agent/link").send({ code: lc, name: "Papa" })).body;
        // the tablet reports its address and access point; then the phone from the same /24, in another room, then from an office
        const hubReport = (bssid) => request(app).post("/home/agent/report").set(bearer(tab.token)).send({ status: { agent: "stashr-hub", wifi: { rssi: -50, ip: "192.168.1.10", bssid } } });
        const loc = (bssid, ip) => request(app).post("/home/agent/location").set(bearer(ph.token)).send({ lat: 28.6139, lon: 77.209, acc: 20, at: Date.now(), battery: { pct: 80, charging: false }, wifi: { connected: true, ip, bssid } });
        await hubReport("aa:bb:cc:dd:ee:01");
        await loc("11:22:33:44:55:01", "192.168.1.30");        // a second access point in the house
        await loc("de:ad:be:ef:00:01", "10.5.0.7");            // the office: other subnet
        await new Promise((r) => setTimeout(r, 300));
        const rows = await HomeApSeen.find({}).lean();
        expect(rows.map((r) => r.ap).sort()).toEqual(["11:22:33:44:55", "aa:bb:cc:dd:ee"]);
        const m = await request(app).get("/home/map").set(auth);
        expect(m.status).toBe(200);
        expect(m.body.stats.aps).toBe(2);
        expect(m.body.note).toMatch(/No zone learned yet|Only one|zones learned/);
        const owner = (await HomeDevice.findOne({ kind: "hub" })).owner;
        // zone needs 3 sightings: push the counters up the way a day of reports would
        await HomeApSeen.updateMany({}, { $set: { count: 50 } });
        const m2 = (await request(app).get("/home/map").set(auth)).body;
        expect(m2.zones).toHaveLength(2);
        expect(m2.zones.every((z) => z.w === 2 && z.h === 2)).toBe(true);
        const zid = m2.zones[0].id;
        const named = await request(app).put("/home/map").set(auth).send({ zoneNames: { [zid]: "Hall" } });
        expect(named.body.zones.find((z) => z.id === zid).name).toBe("Hall");
        expect((await request(app).put("/home/map").set(auth).send({ plan: "javascript:alert(1)" })).status).toBe(400);
        const png = "data:image/png;base64,iVBORw0KGgo=";
        expect((await request(app).put("/home/map").set(auth).send({ plan: png })).body.plan).toBe(png);
        // the tablet gets the same map (without the picture)
        const agent = await request(app).get("/home/agent/map").set(bearer(tab.token));
        expect(agent.status).toBe(200);
        expect(agent.body.zones.length).toBe(2);
        expect(agent.body.plan).toBe("");
        // improving by itself: first pass remembers, a later new zone is announced once
        const lines = []; const real = automation.sendTelegram; automation.sendTelegram = async (o, t) => { lines.push(t); return true; };
        try {
            await map.selfImprove(owner, Date.now());
            expect(lines).toHaveLength(0);
            await HomeApSeen.create({ owner, device: (await HomeDevice.findOne({ kind: "hub" }))._id, bssid: "77:88:99:aa:bb:01", ap: "77:88:99:aa:bb", count: 20 });
            await map.selfImprove(owner, Date.now());
            expect(lines.filter((l) => /Naya zone mila/.test(l))).toHaveLength(1);
            await map.selfImprove(owner, Date.now());
            expect(lines.filter((l) => /Naya zone mila/.test(l))).toHaveLength(1);
        } finally { automation.sendTelegram = real; }
        expect((await request(app).get("/home/map")).status).toBe(401);
    });
});
