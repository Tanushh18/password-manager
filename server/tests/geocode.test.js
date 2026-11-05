const { describe, test, before: beforeAll, after: afterAll, beforeEach } = require("node:test");
const expect = require("./expect");
const geocode = require("../utils/geocode");

const reply = (body, ok = true) => ({ ok, json: async () => body });
const place = { address: { house_number: "12", road: "MG Road", suburb: "Sector 21", city: "Gurugram", state: "Haryana" }, display_name: "12, MG Road, Sector 21, Gurugram, Haryana, India" };

describe("addresses from coordinates", () => {
    test("a short, human address from Nominatim's parts, with a fallback to the first words of the long one", () => {
        expect(geocode.shorten(place)).toBe("12 MG Road, Sector 21, Gurugram");
        expect(geocode.shorten({ address: {}, display_name: "Some Temple, Old Town, Jaipur, Rajasthan, India" })).toBe("Some Temple, Old Town, Jaipur");
        expect(geocode.shorten({})).toBe("");
    });

    test("the same place is asked once; places within about 11 metres share an answer; requests go a second apart", async () => {
        let calls = 0; const times = []; let now = 1_000_000;
        geocode._reset({ fetch: async (url) => { calls++; times.push(now); return reply(place); }, now: () => now, wait: async (ms) => { now += ms; } });
        const a = await geocode.reverse(28.61391, 77.20901);
        const b = await geocode.reverse(28.61392, 77.20902);       // ~1 m away: the same answer from memory
        expect(a.address).toBe("12 MG Road, Sector 21, Gurugram");
        expect(b).toEqual(a);
        expect(calls).toBe(1);
        await geocode.reverse(28.7, 77.3);
        expect(calls).toBe(2);
        expect(times[1] - times[0] >= 1100).toBe(true);
    });

    test("a failure or a bad point is null (never an error), and is not remembered", async () => {
        let ok = false;
        geocode._reset({ fetch: async () => (ok ? reply(place) : reply({}, false)), wait: async () => {} });
        expect(await geocode.reverse(28.6, 77.2)).toBeNull();
        expect(await geocode.reverse(200, 77.2)).toBeNull();
        ok = true;
        expect((await geocode.reverse(28.6, 77.2)).address).toMatch(/MG Road/);
        geocode._reset({ fetch: async () => { throw new Error("offline"); }, wait: async () => {} });
        expect(await geocode.reverse(12.9, 77.5)).toBeNull();
    });
});

describe("the address route", () => {
    const { MongoMemoryServer } = require("mongodb-memory-server");
    const mongoose = require("mongoose");
    const request = require("supertest");
    process.env.SECRET_KEY = "test-secret"; process.env.CRYPTO_SECRET_KEY = "test-crypto-secret"; process.env.RATE_LIMIT_MAX = "1000"; process.env.ALLOW_SIGNUP = "true"; delete process.env.YOUTUBE_API_KEY; process.env.HOME_ROUTING = "off";
    const app = require("../app");
    const User = require("../models/schema");
    let mongo;
    beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
    afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
    beforeEach(async () => { await User.deleteMany({}); geocode._reset({ fetch: async () => reply(place), wait: async () => {} }); });
    const signUp = async () => {
        await request(app).post("/register").send({ name: "Ana", email: "ana@example.com", password: "master-pass", cpassword: "master-pass" });
        const r = await request(app).post("/login").send({ email: "ana@example.com", password: "master-pass", client: "mobile" });
        return { Authorization: `Bearer ${r.body.token}` };
    };

    test("gives the street address, your own name for a known place, and refuses bad input and strangers", async () => {
        const auth = await signUp();
        await request(app).put("/home/settings").set(auth).send({ homeSpot: { lat: 28.6139, lon: 77.209, radius: 200 } });
        const here = await request(app).get("/home/address?lat=28.62&lon=77.3").set(auth);
        expect(here.body.address).toBe("12 MG Road, Sector 21, Gurugram");
        expect(here.body.name).toBeNull();
        const home = await request(app).get("/home/address?lat=28.6139&lon=77.209").set(auth);
        expect(home.body.name).toBe("Home");
        expect((await request(app).get("/home/address?lat=abc&lon=1").set(auth)).status).toBe(400);
        expect((await request(app).get("/home/address?lat=28.6&lon=77.2")).status).toBe(401);
    });
});
