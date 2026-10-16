const { describe, test, before: beforeAll, after: afterAll, beforeEach } = require("node:test");
const expect = require("./expect");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");

process.env.SECRET_KEY = "test-secret";
process.env.CRYPTO_SECRET_KEY = "test-crypto-secret";

const { detectServices, credsFromRoles } = require("../utils/usageCatalog");
const { normalizeSettings } = require("../utils/usageIO");
const { needsReaderOf, buildLiveDashboard, clearServiceCaches } = require("../utils/usageDashboard");
const { recordNeedsReader, listNeedsReader, userHash } = require("../utils/unsupportedServices");
const Unsupported = require("../models/UnsupportedService");

let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => { await Unsupported.deleteMany({}); });

describe("user mapping of variables to services", () => {
  test("a variable the user assigns wins, and roles build the credentials whatever the names are", () => {
    const env = { MY_CLD: "shop", XK1: "key1", XS1: "sec1", NOTES: "hello" };
    const overrides = new Map([["MY_CLD", { key: "cloudinary", role: "cloudName" }], ["XK1", { key: "cloudinary", role: "apiKey" }], ["XS1", { key: "cloudinary", role: "apiSecret" }], ["NOTES", { key: "ignore" }]]);
    const r = detectServices(env, { overrides });
    const cld = r.services.find((s) => s.key === "cloudinary");
    expect(cld.hasCredentials).toBe(true);
    expect(cld.credentials.sets).toEqual([{ label: "default", cloudName: "shop", apiKey: "key1", apiSecret: "sec1" }]);
    expect(cld.vars.every((v) => v.via === "user")).toBe(true);
    expect(JSON.stringify(r.services.map(({ credentials, ...s }) => s))).not.toContain("sec1");
    expect(r.internal.map((v) => v.name)).toEqual(["NOTES"]);
  });

  test("two accounts of one provider are told apart by group", () => {
    const env = { A1: "c1", A2: "k1", A3: "s1", B1: "c2", B2: "k2", B3: "s2" };
    const overrides = new Map(Object.entries({ A1: ["cloudName", "main"], A2: ["apiKey", "main"], A3: ["apiSecret", "main"], B1: ["cloudName", "blog"], B2: ["apiKey", "blog"], B3: ["apiSecret", "blog"] }).map(([k, [role, group]]) => [k, { key: "cloudinary", role, group }]));
    const sets = detectServices(env, { overrides }).services[0].credentials.sets;
    expect(sets.map((s) => s.cloudName).sort()).toEqual(["c1", "c2"]);
  });

  test("a custom service gets the user's own name", () => {
    const r = detectServices({ ZZ_TOKEN: "abc" }, { overrides: new Map([["ZZ_TOKEN", { key: "custom:acme" }]]), customLabels: { acme: { label: "Acme Inc", category: "APIs" } } });
    expect(r.services[0]).toMatchObject({ key: "custom:acme", label: "Acme Inc", category: "APIs" });
  });

  test("credsFromRoles builds every reader's shape", () => {
    expect(credsFromRoles("brevo", { apiKey: "k" })).toEqual({ apiKey: "k" });
    expect(credsFromRoles("twilio", { accountSid: "AC1", authToken: "t" })).toEqual({ accountSid: "AC1", user: "AC1", pass: "t" });
    expect(credsFromRoles("turso", { url: "libsql://x.turso.io", token: "t" })).toEqual({ url: "https://x.turso.io", token: "t" });
    expect(credsFromRoles("mongodb", {})).toBeNull();
  });

  test("settings keep only valid mappings and custom services", () => {
    const s = normalizeSettings({
      customServices: { "acme-ai": { label: "Acme AI", category: "AI" }, "BAD KEY": { label: "x" } },
      mapping: { "*|MY_CLD": { key: "cloudinary", role: "cloudName", group: "shop" }, "p1|FOO": { key: "custom:acme-ai" }, "p1|BAR": { key: "custom:missing" }, "*|X": { key: "cloudinary", role: "bogus" }, "bad key|Y": { key: "ignore" } }
    });
    expect(Object.keys(s.customServices)).toEqual(["acme-ai"]);
    expect(s.mapping).toEqual({ "*|MY_CLD": { key: "cloudinary", role: "cloudName", group: "shop" }, "p1|FOO": { key: "custom:acme-ai" }, "*|X": { key: "cloudinary" } });
    // the server folder of each project: plain repo-relative paths only
    const f = normalizeSettings({ serverFolders: { "srv-1": "server", "srv-2": ".", "srv-3": "../etc", "bad id": "x", "srv-4": "a//b", "srv-5": "apps/api" } });
    expect(f.serverFolders).toEqual({ "srv-1": "server", "srv-2": ".", "srv-5": "apps/api" });
    expect(normalizeSettings({ enabled: true }, f).serverFolders).toEqual(f.serverFolders);
    // saving other settings leaves the mapping alone
    expect(normalizeSettings({ enabled: true }, s).mapping).toEqual(s.mapping);
  });
});

describe("the dashboard uses the mapping", () => {
  test("a mapped variable reads usage and its service is not reported as missing a reader", async () => {
    clearServiceCaches();
    const accounts = new Map([["a1", { id: "a1", name: "Main", apiKey: "k" }]]);
    const request = async (_a, path) => (path.includes("/deploys") ? [{ deploy: { status: "live" } }] : [{ envVar: { key: "MY_CLD", value: "shop" } }, { envVar: { key: "XK1", value: "key1" } }, { envVar: { key: "XS1", value: "sec1" } }, { envVar: { key: "ZZ_TOKEN", value: "abc" } }]);
    const providers = { cloudinary: { run: async ({ sets }) => ({ ok: true, reports: [{ label: sets[0].cloudName, metrics: [{ key: "credits", label: "Credits", used: 5, limit: 25, unit: "credits" }] }] }) } };
    const settings = { mapping: { "*|MY_CLD": { key: "cloudinary", role: "cloudName" }, "*|XK1": { key: "cloudinary", role: "apiKey" }, "*|XS1": { key: "cloudinary", role: "apiSecret" }, "*|ZZ_TOKEN": { key: "custom:acme" } }, customServices: { acme: { label: "Acme Inc", category: "APIs" } } };
    const data = await buildLiveDashboard({ services: [{ id: "srv-1", name: "api", type: "web_service", accountId: "a1", suspended: false }], accounts, request, providers, settings, now: Date.parse("2026-10-14T12:00:00Z") });
    const svcs = data.projects[0].services;
    expect(svcs.find((s) => s.key === "cloudinary").state).toBe("ok");
    expect(data.needsReader.map((n) => n.key)).toEqual(["custom:acme"]);
    expect(data.needsReader[0]).toMatchObject({ label: "Acme Inc", vars: ["ZZ_TOKEN"] });
  });

  test("services with nothing to track are never asked for", () => {
    const projects = [{ services: [{ key: "telegram", label: "Telegram", vars: [{ name: "BOT_TOKEN" }] }, { key: "groq", label: "Groq", category: "AI", vars: [{ name: "GROQ_API_KEY" }] }] }];
    expect(needsReaderOf(projects, {}).map((n) => n.key)).toEqual(["groq"]);
    expect(needsReaderOf(projects, { groq: {} })).toEqual([]);
  });
});

describe("admin list of services that need a reader", () => {
  test("counts other users only, hides services that now have a reader, stores no ids or values", async () => {
    const admin = new mongoose.Types.ObjectId(), u1 = new mongoose.Types.ObjectId(), u2 = new mongoose.Types.ObjectId();
    const item = { key: "groq", label: "Groq", category: "AI", vars: ["GROQ_API_KEY"], packages: ["groq-sdk"] };
    const t0 = Date.now() + 10 * 3600 * 1000;
    await recordNeedsReader(admin, [item], t0);
    await recordNeedsReader(u1, [item, { key: "custom:only-admin", label: "X" }], t0);
    await recordNeedsReader(u2, [{ ...item, vars: ["GROQ_MODEL"] }], t0);
    await recordNeedsReader(u2, [item], t0 + 10 * 60 * 1000); // inside the hour: no second write
    const list = await listNeedsReader({ adminUserId: admin, hasReader: () => false });
    expect(list.find((s) => s.key === "groq")).toMatchObject({ label: "Groq", userCount: 2, packages: ["groq-sdk"] });
    expect(list.find((s) => s.key === "groq").vars.sort()).toEqual(["GROQ_API_KEY", "GROQ_MODEL"]);
    expect((await listNeedsReader({ adminUserId: admin, hasReader: (k) => k === "groq" })).map((s) => s.key)).toEqual(["custom:only-admin"]);
    const raw = JSON.stringify(await Unsupported.find({}).lean());
    expect(raw).not.toContain(String(u1));
    expect(raw).toContain(userHash(u1));
  });
});
