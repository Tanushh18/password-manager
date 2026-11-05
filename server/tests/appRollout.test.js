const { describe, test, before: beforeAll, after: afterAll, beforeEach } = require("node:test");
const expect = require("./expect");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const request = require("supertest");

process.env.SECRET_KEY = "test-secret"; process.env.CRYPTO_SECRET_KEY = "test-crypto-secret"; process.env.RATE_LIMIT_MAX = "1000"; process.env.ALLOW_SIGNUP = "true"; delete process.env.YOUTUBE_API_KEY; process.env.HOME_ROUTING = "off";
process.env.REGISTRY_ADMINS = "ana@example.com";

const man = (pkg, version, code) => ({ packageName: pkg, version, versionCode: code, sha256: "b".repeat(64), sizeBytes: 5, releaseNotes: "Notes " + version });
const assets = (apk, mf, n) => [{ name: apk, url: `https://api.github.com/x/assets/${n}` }, { name: mf, url: `https://api.github.com/x/assets/${n + 1}` }];
const MANIFESTS = { 11: man("com.tanush.stashr.where", "1.7.0", 100020), 21: man("com.tanush.stashr.hub", "1.9.2", 100030), 31: man("com.tanush.stashr.com", "2.4.0", 100040) };
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
    const t = String(url);
    if (t.includes("api.github.com/repos") && t.includes("/releases?per_page=")) return new Response(JSON.stringify([
        { draft: false, prerelease: false, tag_name: "stashr-where-v1.7.0-build-100020", published_at: "2026-11-05T00:00:00Z", assets: assets("stashr-where.apk", "stashr-where-update.json", 10) },
        { draft: false, prerelease: false, tag_name: "stashr-hub-v1.9.2-build-100030", published_at: "2026-11-05T00:00:00Z", assets: assets("stashr-hub.apk", "stashr-hub-update.json", 20) }
    ]), { status: 200 });
    if (t.endsWith("/releases/latest")) return new Response(JSON.stringify({ draft: false, prerelease: false, tag_name: "stashr-v2.4.0-build-100040", published_at: "2026-11-05T00:00:00Z", assets: [{ name: "stashr-release.apk", url: "https://api.github.com/x/assets/30", browser_download_url: "https://github.com/x/dl/stashr-release.apk" }, { name: "stashr-update.json", url: "https://api.github.com/x/assets/31", browser_download_url: "https://github.com/x/dl/stashr-update.json" }] }), { status: 200 });
    const m = /assets\/(\d+)$/.exec(t);
    if (m && MANIFESTS[m[1]]) return new Response(JSON.stringify(MANIFESTS[m[1]]), { status: 200 });
    if (m) return new Response("apk", { status: 200 });
    return realFetch(url, opts);
};
const app = require("../app");
const User = require("../models/schema");
const HomeDevice = require("../models/homeDevice");
const AppRollout = require("../models/appRollout");
const rollout = require("../utils/rollout");

describe("the rule", () => {
    test("everyone / nobody / only the ticked devices; an anonymous check is offered only when everyone is", () => {
        const all = { defaultMode: "all", rules: {} }, hold = { defaultMode: "hold", rules: {} };
        expect(rollout.allows(all, 5, "")).toBe(true);
        expect(rollout.allows(hold, 5, "d1")).toBe(false);
        const sel = { defaultMode: "hold", rules: { 5: { mode: "selected", devices: ["d1"] } } };
        expect(rollout.allows(sel, 5, "d1")).toBe(true);
        expect(rollout.allows(sel, 5, "d2")).toBe(false);
        expect(rollout.allows(sel, 5, "")).toBe(false);
        expect(rollout.allows(sel, 6, "d1")).toBe(false);                       // the next release has no rule: it follows the default (hold)
        expect(rollout.allows({ defaultMode: "all", rules: { 5: { mode: "hold" } } }, 5, "d1")).toBe(false);
        expect(rollout.allows(null, 5, "")).toBe(true);
    });
});

describe("choosing who gets the update, end to end", () => {
    let mongo;
    beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
    afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); global.fetch = realFetch; });
    beforeEach(async () => { for (const M of [User, HomeDevice, AppRollout]) await M.deleteMany({}); require("../router/mobileUpdates")._resetCache(); });

    const signUp = async (email = "ana@example.com") => {
        await request(app).post("/register").send({ name: "Ana", email, password: "master-pass", cpassword: "master-pass" });
        const r = await request(app).post("/login").send({ email, password: "master-pass", client: "mobile" });
        return { Authorization: `Bearer ${r.body.token}` };
    };
    const link = async (auth, name) => {
        const code = (await request(app).get("/home/location-code").set(auth)).body.code;
        return (await request(app).post("/home/agent/link").send({ code, name })).body;
    };
    const check = (path, token) => request(app).get(path).set(token ? { Authorization: `Bearer ${token}` } : {});
    const offered = async (path, token) => (await check(path, token)).body.updateAvailable;

    test("by default Hub, TV and the main app are offered to everyone as before, but Location waits for your OK; the page lists each app's newest release and its devices", async () => {
        const auth = await signUp();
        const ph = await link(auth, "Papa");
        expect(await offered("/api/mobile-updates/hub/latest?currentVersionCode=100001")).toBe(true);
        expect(await offered("/api/mobile-updates/where/latest?currentVersionCode=100001")).toBe(false);          // held by default (Room Lab is tried on one phone first)
        expect(await offered("/api/mobile-updates/where/latest?currentVersionCode=100001", ph.token)).toBe(false);
        await request(app).put("/api/app-rollout/where").set(auth).send({ mode: "all" });
        expect(await offered("/api/mobile-updates/where/latest?currentVersionCode=100001")).toBe(true);
        await request(app).put("/api/app-rollout/where").set(auth).send({ defaultMode: "hold" });
        await AppRollout.deleteMany({}); require("../router/mobileUpdates")._resetCache();
        const page = (await request(app).get("/api/app-rollout").set(auth)).body;
        const where = page.apps.find((a) => a.key === "where");
        expect(page.apps.map((a) => a.key)).toEqual(["android", "where", "hub", "tv"]);
        expect(where.latest).toMatchObject({ version: "1.7.0", versionCode: 100020 });
        expect(where.rule).toMatchObject({ mode: "hold", explicit: false });
        expect(where.devices.map((d) => d.name)).toEqual(["Papa"]);
        expect(where.identityFrom).toBe("1.7.0");
        expect(where.devices[0].canIdentify).toBeNull();                          // its version is not known yet
        expect(page.apps.find((a) => a.key === "android").latest.version).toBe("2.4.0");
    });

    test("selecting one phone: only it is offered the update; a phone not ticked and an old anonymous app are not", async () => {
        const auth = await signUp();
        const test1 = await link(auth, "Test phone"), other = await link(auth, "Mom phone");
        const set = await request(app).put("/api/app-rollout/where").set(auth).send({ mode: "selected", devices: [test1.deviceId] });
        expect(set.status).toBe(200);
        const path = "/api/mobile-updates/where/latest?currentVersionCode=100001";
        expect(await offered(path, test1.token)).toBe(true);
        expect(await offered(path, other.token)).toBe(false);
        expect(await offered(path)).toBe(false);
        const where = (await request(app).get("/api/app-rollout").set(auth)).body.apps.find((a) => a.key === "where");
        expect(where.rule).toMatchObject({ mode: "selected", explicit: true });
        expect(where.devices.find((d) => d.name === "Test phone").offered).toBe(true);
        expect(where.devices.find((d) => d.name === "Mom phone").offered).toBe(false);
        // the other apps are untouched
        expect(await offered("/api/mobile-updates/hub/latest?currentVersionCode=100001")).toBe(true);
    });

    test("hold stops everyone; a newer release follows the default; 'new releases wait for me' holds the next one; all opens it again", async () => {
        const auth = await signUp();
        const ph = await link(auth, "Papa");
        const path = "/api/mobile-updates/where/latest?currentVersionCode=100001";
        await request(app).put("/api/app-rollout/where").set(auth).send({ mode: "hold" });
        expect(await offered(path, ph.token)).toBe(false);
        expect((await check(path)).body.versionCode).toBe(100020);                  // the release is still described; it is just not offered
        await request(app).put("/api/app-rollout/where").set(auth).send({ defaultMode: "hold" });
        MANIFESTS[11] = man("com.tanush.stashr.where", "1.7.1", 100021);            // a newer release appears: no rule for it yet
        require("../router/mobileUpdates")._resetCache();
        expect(await offered(path, ph.token)).toBe(false);
        await request(app).put("/api/app-rollout/where").set(auth).send({ mode: "all" });
        expect(await offered(path)).toBe(true);
        MANIFESTS[11] = man("com.tanush.stashr.where", "1.7.0", 100020);
    });

    test("the main app can be held or opened but not sent to chosen devices; only admins may change anything", async () => {
        const auth = await signUp();
        expect((await request(app).put("/api/app-rollout/android").set(auth).send({ mode: "selected", devices: ["x"] })).status).toBe(400);
        await request(app).put("/api/app-rollout/android").set(auth).send({ mode: "hold" });
        expect(await offered("/api/mobile-updates/android/latest?currentVersionCode=100001")).toBe(false);
        await request(app).put("/api/app-rollout/android").set(auth).send({ mode: "all" });
        expect(await offered("/api/mobile-updates/android/latest?currentVersionCode=100001")).toBe(true);
        const stranger = await signUp("bob@example.com");
        expect((await request(app).get("/api/app-rollout").set(stranger)).status).toBe(403);
        expect((await request(app).put("/api/app-rollout/where").set(stranger).send({ mode: "hold" })).status).toBe(403);
        expect((await request(app).get("/api/app-rollout")).status).toBe(401);
    });

    test("bad input is refused: no device ticked, an unknown device, an unknown mode or app", async () => {
        const auth = await signUp();
        await link(auth, "Papa");
        expect((await request(app).put("/api/app-rollout/where").set(auth).send({ mode: "selected", devices: [] })).status).toBe(400);
        expect((await request(app).put("/api/app-rollout/where").set(auth).send({ mode: "selected", devices: ["64b000000000000000000000"] })).status).toBe(400);
        expect((await request(app).put("/api/app-rollout/where").set(auth).send({ mode: "sometimes" })).status).toBe(400);
        expect((await request(app).put("/api/app-rollout/nope").set(auth).send({ mode: "all" })).status).toBe(404);
    });
});
