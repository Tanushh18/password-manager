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
const { slugify, discoverServers, mergeServerUrls, syncProjectServers } = require("../utils/projectServers");
const { verifiedDomains, customDomains } = require("../utils/renderDomains");

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

describe("sync never undoes a change made while it was running", () =>
{
    test("a domain saved after the background pass read the project is kept and published", async () =>
    {
        const ana = await signIn("ana@example.com");
        const made = await request(app).post("/projects/items").set(auth(ana)).send({ data: { name: "Site", registryApp: "my-site", serverUrls: [], renderServiceId: "s1", renderAccountId: "a", renderServices: [{ accountId: "a", serviceId: "s1", name: "api", url: "https://site-server.onrender.com" }] } });
        expect(made.status).toBe(201);
        // the background pass reads the account now ...
        const stale = await User.findOne({ email: "ana@example.com" });
        const dataKey = await stale.getDataKey();
        const staleEntry = stale.projects[0];
        // ... and meanwhile the person adds their own domain
        const id = made.body.item._id || made.body.item.id;
        const saved = await request(app).put(`/projects/items/${id}`).set(auth(ana)).send({ data: { name: "Site", registryApp: "my-site", serverUrls: [{ url: "https://api.mysite.com", enabled: true }], renderServiceId: "s1", renderAccountId: "a", renderServices: [{ accountId: "a", serviceId: "s1", name: "api", url: "https://site-server.onrender.com" }] } });
        expect(saved.status).toBe(200);

        const result = await syncProjectServers(stale, dataKey, staleEntry, [{ id: "s1", type: "web_service", url: "https://site-server.onrender.com" }]);
        expect(result.serverUrls.map((r) => r.url).sort()).toEqual(["https://api.mysite.com", "https://site-server.onrender.com"]);

        const after = await User.findOne({ email: "ana@example.com" });
        const fields = User.publicEntry(after.projects[0], dataKey);
        expect(fields.serverUrls.map((r) => r.url).sort()).toEqual(["https://api.mysite.com", "https://site-server.onrender.com"]);
        expect((await request(app).get("/registry/my-site")).body.urls.sort()).toEqual(["https://api.mysite.com", "https://site-server.onrender.com"]);
    });
});

describe("custom domains", () =>
{
    test("only verified, non-redirect domains are used", () =>
    {
        const items = [
            { customDomain: { name: "API.Example.com", verificationStatus: "verified" } },
            { customDomain: { name: "www.example.com", verificationStatus: "verified", redirectForName: "example.com" } },
            { customDomain: { name: "pending.example.com", verificationStatus: "unverified" } },
            { customDomain: { name: "api.example.com", verificationStatus: "verified" } }
        ];
        expect(verifiedDomains(items)).toEqual(["api.example.com"]);
    });

    test("the domain comes before the onrender.com address, and static sites stay out", () =>
    {
        const fields = { renderServiceId: "s1", renderAccountId: "a", renderServices: [
            { accountId: "a", serviceId: "s1", name: "api", url: "https://api-x.onrender.com" },
            { accountId: "a", serviceId: "s2", name: "web", url: "https://web-x.onrender.com" }
        ] };
        const live = [{ id: "s1", type: "web_service", url: "https://api-x.onrender.com" }, { id: "s2", type: "static_site", url: "https://web-x.onrender.com" }];
        const found = discoverServers(fields, live, new Map([["s1", ["api.example.com"]], ["s2", ["site.example.com"]]]));
        expect(found.map((f) => f.origin)).toEqual(["https://api.example.com", "https://api-x.onrender.com"]);
        expect(found[0].domain).toBe(true);
    });

    test("a listing is read once and cached; a failing listing is not fatal", async () =>
    {
        let calls = 0;
        const get = async () => { calls += 1; return [{ customDomain: { name: "cached.example.com", verificationStatus: "verified" } }]; };
        expect(await customDomains("k", "srv-cache-1", { get })).toEqual(["cached.example.com"]);
        expect(await customDomains("k", "srv-cache-1", { get })).toEqual(["cached.example.com"]);
        expect(calls).toBe(1);
        expect(await customDomains("k", "srv-bad-1", { get: async () => { throw new Error("boom"); } })).toEqual([]);
    });
});

describe("choosing the list name when publishing", () =>
{
    const make = async (token, name = "Site") => (await request(app).post("/projects/items").set(auth(token)).send({ data: { name, serverUrls: [{ url: "https://api.mysite.com", enabled: true }] } })).body.item;

    test("the person's own name is used; a reserved built-in name needs an admin", async () =>
    {
        const ana = await signIn("ana@example.com");
        const item = await make(ana);
        const id = item._id || item.id;
        const own = await request(app).post(`/projects/items/${id}/servers/sync`).set(auth(ana)).send({ registryApp: "My-Site" });
        expect(own.status).toBe(200);
        expect(own.body.registryApp).toBe("my-site");
        expect(own.body.published).toBe(true);
        expect((await request(app).get("/registry/my-site")).body.urls).toEqual(["https://api.mysite.com"]);

        const reserved = await request(app).post(`/projects/items/${id}/servers/sync`).set(auth(ana)).send({ registryApp: "wethree" });
        expect(reserved.status).toBe(200);
        expect(reserved.body.published).toBe(false);

        expect((await request(app).post(`/projects/items/${id}/servers/sync`).set(auth(ana)).send({ registryApp: "A!" })).status).toBe(400);
    });

    test("an admin can publish under a built-in app name", async () =>
    {
        const admin = await signIn("tanushchawla16@gmail.com");
        const item = await make(admin, "Tasks");
        const res = await request(app).post(`/projects/items/${item._id || item.id}/servers/sync`).set(auth(admin)).send({ registryApp: "wethree" });
        expect(res.body.published).toBe(true);
        expect((await request(app).get("/registry/wethree")).body.urls).toEqual(["https://api.mysite.com"]);
    });
});

describe("switching a project list off", () =>
{
    test("an owner can switch every URL off; the public list then reads empty and flagged off", async () =>
    {
        const ana = await signIn("ana@example.com");
        await request(app).put("/registry/my-shop").set(auth(ana)).send({ urls: ["https://shop.onrender.com/api"] });
        const off = await request(app).put("/registry/my-shop").set(auth(ana)).send({ urls: [] });
        expect(off.status).toBe(200);
        const read = await request(app).get("/registry/my-shop");
        expect(read.status).toBe(200);
        expect(read.body.urls).toEqual([]);
        expect(read.body.off).toBe(true);
        const back = await request(app).put("/registry/my-shop").set(auth(ana)).send({ urls: ["https://shop.onrender.com/api"] });
        expect(back.status).toBe(200);
        expect((await request(app).get("/registry/my-shop")).body.off).toBe(undefined);
    });

    test("the built-in apps always keep a server", async () =>
    {
        const admin = await signIn("tanushchawla16@gmail.com");
        expect((await request(app).put("/registry/wethree").set(auth(admin)).send({ urls: [] })).status).toBe(400);
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
