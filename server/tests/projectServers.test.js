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
const Registry = require("../models/registry");
const AuditEvent = require("../models/AuditEvent");
const { slugify, discoverServers, mergeServerUrls } = require("../utils/projectServers");

let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => { await User.deleteMany({}); await Registry.deleteMany({}); await AuditEvent.deleteMany({}); });

const ADMIN = "tanushchawla16@gmail.com";
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const signIn = async (email) =>
{
    await request(app).post("/register").send({ name: "Ana", email, password: "master-pass", cpassword: "master-pass" });
    const res = await request(app).post("/login").send({ email, password: "master-pass", client: "mobile" });
    return res.body.token;
};

describe("project server lists (pure)", () =>
{
    test("slugify makes a registry-safe name", () =>
    {
        expect(slugify("My Shop API!")).toBe("my-shop-api");
        expect(slugify("  ")).toBe("project");
        expect(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slugify("x"))).toBe(true);
    });

    test("static sites are clients, not servers; suspended servers start switched off", () =>
    {
        const fields = { renderServiceId: "s1", renderAccountId: "a", renderServices: [
            { accountId: "a", serviceId: "s1", name: "api", url: "https://api.onrender.com" },
            { accountId: "a", serviceId: "s2", name: "web", url: "https://web.onrender.com" },
            { accountId: "a", serviceId: "s3", name: "old", url: "https://old.onrender.com", suspended: true }
        ] };
        const live = [{ id: "s1", type: "web_service", url: "https://api.onrender.com" }, { id: "s2", type: "static_site", url: "https://web.onrender.com" }];
        const found = discoverServers(fields, live);
        expect(found.map((f) => f.origin)).toEqual(["https://api.onrender.com", "https://old.onrender.com"]);
        expect(found[1].suspended).toBe(true);
    });

    test("all four servers of a repo get added, with the path the list already uses", () =>
    {
        const found = ["a", "b", "c", "d"].map((n) => ({ origin: `https://${n}.onrender.com`, suspended: false }));
        const { rows, changed } = mergeServerUrls([{ url: "https://a.onrender.com/api", enabled: true }], found, []);
        expect(changed).toBe(true);
        expect(rows.map((r) => r.url)).toEqual(["https://a.onrender.com/api", "https://b.onrender.com/api", "https://c.onrender.com/api", "https://d.onrender.com/api"]);
        expect(rows[1].auto).toBe(true);
    });

    test("a server removed by hand stays out; a vanished auto server drops; manual rows stay", () =>
    {
        const found = [{ origin: "https://a.onrender.com", suspended: false }, { origin: "https://b.onrender.com", suspended: false }];
        const rows = [{ url: "https://gone.onrender.com", enabled: true, auto: true }, { url: "https://mine.example.com/api", enabled: false }];
        const out = mergeServerUrls(rows, found, ["https://b.onrender.com"]);
        expect(out.rows.map((r) => r.url)).toEqual(["https://mine.example.com/api", "https://a.onrender.com/api"]);
        expect(out.rows[0].enabled).toBe(false);
        expect(mergeServerUrls(out.rows, found, ["https://b.onrender.com"]).changed).toBe(false);
    });
});

describe("per-project public registry", () =>
{
    test("any account can publish its own project list; nobody else can change it", async () =>
    {
        const ana = await signIn("ana@example.com");
        const bob = await signIn("bob@example.com");
        const put = await request(app).put("/registry/my-shop").set(auth(ana)).send({ urls: ["https://shop.onrender.com/api"] });
        expect(put.status).toBe(200);
        expect((await request(app).get("/registry/my-shop")).body.urls).toEqual(["https://shop.onrender.com/api"]);
        expect((await request(app).put("/registry/my-shop").set(auth(bob)).send({ urls: ["https://evil.example.com"] })).status).toBe(403);
        expect((await request(app).put("/registry/wethree").set(auth(ana)).send({ urls: ["https://a.example.com"] })).status).toBe(403);
        expect((await request(app).put("/registry/A").set(auth(ana)).send({ urls: ["https://a.example.com"] })).status).toBe(400);
    });
});

describe("admin deletes a user", () =>
{
    test("removes the account and everything stored apart from it, after the email is typed", async () =>
    {
        const admin = await signIn(ADMIN);
        const ana = await signIn("ana@example.com");
        const user = await User.findOne({ email: "ana@example.com" });
        await AuditEvent.create({ userId: user._id, action: "login" });
        await request(app).put("/registry/ana-shop").set(auth(ana)).send({ urls: ["https://shop.onrender.com"] });

        expect((await request(app).delete(`/admin/users/${user._id}`).set(auth(ana)).send({ confirmEmail: "ana@example.com" })).status).toBe(403);
        expect((await request(app).delete(`/admin/users/${user._id}`).set(auth(admin)).send({ confirmEmail: "wrong@example.com" })).status).toBe(400);

        const res = await request(app).delete(`/admin/users/${user._id}`).set(auth(admin)).send({ confirmEmail: "Ana@Example.com" });
        expect(res.status).toBe(200);
        expect(res.body.deleted).toBe(true);
        expect(await User.countDocuments({ email: "ana@example.com" })).toBe(0);
        expect(await AuditEvent.countDocuments({ userId: user._id })).toBe(0);
        expect(await Registry.countDocuments({ app: "ana-shop" })).toBe(0);
    });

    test("cannot delete yourself or another administrator", async () =>
    {
        const admin = await signIn(ADMIN);
        const me = await User.findOne({ email: ADMIN });
        expect((await request(app).delete(`/admin/users/${me._id}`).set(auth(admin)).send({ confirmEmail: ADMIN })).status).toBe(400);
    });
});
