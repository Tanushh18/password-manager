const { describe, test } = require("node:test");
const expect = require("./expect");
const { makeProviders, isPrivateHost, mongoHosts, mongoDbName } = require("../utils/usageProviders");

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const MB = 1024 * 1024;
const NOW = new Date("2026-10-11T12:00:00Z");

const providers = (fetchImpl, MongoClient) => makeProviders({ fetchImpl, MongoClient, now: () => NOW });

describe("Mongo host safety", () =>
{
    test("refuses loopback, private and internal hosts, accepts public ones", () =>
    {
        for (const h of ["localhost", "127.0.0.1", "10.0.0.5", "192.168.1.9", "172.20.0.1", "169.254.169.254", "mongo", "db.internal", "::1", "0.0.0.0"]) expect(isPrivateHost(h)).toBe(true);
        for (const h of ["cluster0.ab12.mongodb.net", "203.0.113.7", "db.example.com"]) expect(isPrivateHost(h)).toBe(false);
    });

    test("extracts hosts and db name without leaking credentials", () =>
    {
        expect(mongoHosts("mongodb+srv://user:p@ss@cluster0.x.mongodb.net/app?retryWrites=true").join()).toBe("cluster0.x.mongodb.net");
        expect(mongoHosts("mongodb://u:p@h1.example.com:27017,h2.example.com:27017/db").join()).toBe("h1.example.com,h2.example.com");
        expect(mongoDbName("mongodb+srv://u:p@c.mongodb.net/dealradar?x=1")).toBe("dealradar");
        expect(mongoDbName("mongodb+srv://u:p@c.mongodb.net")).toBe("test");
    });
});

describe("MongoDB usage", () =>
{
    const fakeClient = (behaviour = {}) => class
    {
        constructor() { this.closed = false; }
        async connect() { if (behaviour.connectError) throw behaviour.connectError; }
        db(name) { return { command: async (cmd) => { if (cmd.dbStats) return behaviour.stats || { dataSize: 100 * MB, indexSize: 20 * MB, objects: 5000 }; if (cmd.listDatabases) { if (behaviour.noList) throw new Error("not authorized"); return { totalSize: 300 * MB }; } return {}; } }; }
        async close() { behaviour.onClose && behaviour.onClose(); }
    };

    test("reports cluster and database storage against your 512 MB setting", async () =>
    {
        let closed = false;
        const r = await providers(null, fakeClient({ onClose: () => { closed = true; } })).mongodb.run({ uri: "mongodb+srv://u:p@c.ab.mongodb.net/shop" }, { settings: { mongoLimitMb: 512 } });
        expect(r.ok).toBe(true);
        const [cluster, db, docs] = r.reports[0].metrics;
        expect(cluster.used).toBe(300 * MB);
        expect(cluster.limit).toBe(512 * MB);
        expect(cluster.limitAssumed).toBe(true);
        expect(db.used).toBe(120 * MB);
        expect(db.limit).toBeNull();
        expect(docs.used).toBe(5000);
        expect(r.reports[0].plan).toMatch(/Atlas.*512 MB/);
        expect(closed).toBe(true);
    });

    test("without permission to list databases it falls back to the one database", async () =>
    {
        const r = await providers(null, fakeClient({ noList: true })).mongodb.run({ uri: "mongodb+srv://u:p@c.mongodb.net/shop" }, { settings: { mongoLimitMb: 256 } });
        const metrics = r.reports[0].metrics;
        expect(metrics.find((m) => m.key === "cluster-storage")).toBeUndefined();
        expect(metrics.find((m) => m.key === "db-storage").limit).toBe(256 * MB);
    });

    test("blocks private hosts, maps auth and network failures, and never leaks the URI", async () =>
    {
        expect((await providers(null, fakeClient()).mongodb.run({ uri: "mongodb://u:p@localhost:27017/x" })).code).toBe("blocked");
        const auth = await providers(null, fakeClient({ connectError: Object.assign(new Error("bad auth : Authentication failed. u:p@c"), { code: 18 }) })).mongodb.run({ uri: "mongodb+srv://u:secretpw@c.mongodb.net/x" });
        expect(auth.code).toBe("auth");
        expect(JSON.stringify(auth)).not.toContain("secretpw");
        const net = await providers(null, fakeClient({ connectError: new Error("getaddrinfo ENOTFOUND c.mongodb.net") })).mongodb.run({ uri: "mongodb+srv://u:secretpw@c.mongodb.net/x" });
        expect(net.code).toBe("unavailable");
        expect(JSON.stringify(net)).not.toContain("secretpw");
        expect((await providers(null, undefined).mongodb.run({ uri: "mongodb+srv://u:p@c.mongodb.net/x" })).code).toBe("unsupported");
    });
});

describe("Cloudinary usage", () =>
{
    test("credit plan: credits against the limit, with the monthly period and other numbers for context", async () =>
    {
        const calls = [];
        const f = async (url, o) => { calls.push({ url, o }); return reply(200, { plan: "Free", credits: { usage: 3.4, limit: 25, used_percent: 13.6 }, storage: { usage: 200 * MB }, bandwidth: { usage: 1000 * MB }, transformations: { usage: 120 }, objects: { usage: 80 } }); };
        const r = await providers(f).cloudinary.run({ sets: [{ label: "default", cloudName: "demo", apiKey: "k", apiSecret: "s" }] });
        const m = Object.fromEntries(r.reports[0].metrics.map((x) => [x.key, x]));
        expect(m.credits.used).toBe(3.4);
        expect(m.credits.limit).toBe(25);
        expect(m.credits.period.type).toBe("month");
        expect(m.storage.limit).toBeNull();
        expect(r.reports[0].plan).toBe("Free");
        expect(calls[0].url).toBe("https://api.cloudinary.com/v1_1/demo/usage");
        expect(calls[0].o.headers.Authorization).toBe("Basic " + Buffer.from("k:s").toString("base64"));
    });

    test("several accounts are reported separately and one failing does not hide the others", async () =>
    {
        const f = async (url) => (url.includes("/bad/") ? reply(401, {}) : reply(200, { plan: "Free", credits: { usage: 1, limit: 25 } }));
        const r = await providers(f).cloudinary.run({ sets: [{ label: "default", cloudName: "good", apiKey: "k", apiSecret: "s" }, { label: "shine", cloudName: "bad", apiKey: "k", apiSecret: "s" }] });
        expect(r.reports).toHaveLength(1);
        expect(r.reports[0].label).toBe("good");
        const all = await providers(async () => reply(401, {})).cloudinary.run({ sets: [{ label: "default", cloudName: "x", apiKey: "k", apiSecret: "s" }] });
        expect(all.code).toBe("auth");
        expect(all.error).not.toContain("secret");
    });

    test("tolerates an unexpected response shape", async () =>
    {
        const r = await providers(async () => reply(200, { weird: true })).cloudinary.run({ sets: [{ label: "default", cloudName: "x", apiKey: "k", apiSecret: "s" }] });
        expect(r.ok).toBe(true);
        expect(r.reports[0].metrics).toHaveLength(0);
    });
});

describe("Brevo, Twilio and Deepgram", () =>
{
    test("Brevo: send-limit plans report the plan limit, credit plans report a balance", async () =>
    {
        const free = await providers(async () => reply(200, { companyName: "Acme", plan: [{ type: "free", credits: 300, creditsType: "sendLimit" }] })).brevo.run({ apiKey: "k" });
        expect(free.reports[0].metrics[0]).toEqual({ key: "send-limit", label: "Sending limit (plan)", used: null, limit: 300, unit: "emails", note: "Brevo reports the plan limit, not today's remaining count." });
        const paid = await providers(async () => reply(200, { plan: [{ type: "payAsYouGo", credits: 4200, creditsType: "sendLimit2" }] })).brevo.run({ apiKey: "k" });
        expect(paid.reports[0].metrics[0].remaining).toBe(4200);
        expect(paid.reports[0].metrics[0].kind).toBe("balance");
        expect((await providers(async () => reply(401, {})).brevo.run({ apiKey: "k" })).code).toBe("auth");
    });

    test("Twilio: balance with currency, Basic auth with the right user", async () =>
    {
        let seen;
        const r = await providers(async (url, o) => { seen = { url, o }; return reply(200, { balance: "12.3400", currency: "USD" }); }).twilio.run({ accountSid: "AC1", user: "SK1", pass: "sec" });
        expect(r.reports[0].metrics[0].remaining).toBe(12.34);
        expect(r.reports[0].metrics[0].unit).toBe("USD");
        expect(seen.url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC1/Balance.json");
        expect(seen.o.headers.Authorization).toBe("Basic " + Buffer.from("SK1:sec").toString("base64"));
    });

    test("Deepgram: project lookup then balance; empty projects and errors are handled", async () =>
    {
        const f = async (url) => (url.endsWith("/projects") ? reply(200, { projects: [{ project_id: "p1", name: "Main" }] }) : reply(200, { balances: [{ amount: 42.5, units: "usd" }] }));
        const r = await providers(f).deepgram.run({ apiKey: "k" });
        expect(r.reports[0].metrics[0].remaining).toBe(42.5);
        const none = await providers(async () => reply(200, { projects: [] })).deepgram.run({ apiKey: "k" });
        expect(none.reports[0].notes[0]).toMatch(/No project/);
        expect((await providers(async () => reply(403, {})).deepgram.run({ apiKey: "k" })).code).toBe("auth");
    });

    test("a network failure or rate limit becomes a clear, safe message", async () =>
    {
        const down = await providers(async () => { throw new Error("ECONNRESET k=secret"); }).twilio.run({ accountSid: "A", user: "u", pass: "p" });
        expect(down.ok).toBe(false);
        expect(JSON.stringify(down)).not.toContain("secret");
        expect((await providers(async () => reply(429, {})).twilio.run({ accountSid: "A", user: "u", pass: "p" })).code).toBe("rate-limit");
    });
});
