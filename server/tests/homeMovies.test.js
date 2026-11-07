const { describe, test, before: beforeAll, after: afterAll, beforeEach } = require("node:test");
const expect = require("./expect");
const http = require("http");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const request = require("supertest");

process.env.SECRET_KEY = "test-secret";
process.env.CRYPTO_SECRET_KEY = "test-crypto-secret";
process.env.RATE_LIMIT_MAX = "1000";
process.env.ALLOW_SIGNUP = "true";

const app = require("../app");
const User = require("../models/schema");
const HomeDevice = require("../models/homeDevice");
const MovieSettings = require("../models/homeMovieSettings");
const store = require("../utils/photoStore");

const FOLDER = "FOLDERID1234567890";
let mongo, google, drive, deletes;

// A stand-in for Google Drive: one folder with two movies and a text file.
const startGoogle = () => new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
        const u = new URL(req.url, "http://x");
        if (req.headers.authorization !== "Bearer tok") { res.statusCode = 401; return res.end("{}"); }
        const m = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
        if (u.pathname === "/drive/v3/files") {
            if (!u.searchParams.get("q").includes(`'${FOLDER}' in parents`)) { res.statusCode = 404; return res.end("{}"); }
            res.setHeader("Content-Type", "application/json");
            return res.end(JSON.stringify({ files: [...drive].map(([id, f]) => ({ id, name: f.name, size: String(f.data.length), modifiedTime: "2026-11-01T10:00:00Z" })) }));
        }
        if (m && req.method === "DELETE") { deletes.push(m[1]); drive.delete(m[1]); res.statusCode = 204; return res.end(); }
        if (m && u.searchParams.get("alt") === "media") {
            const f = drive.get(m[1]);
            if (!f) { res.statusCode = 404; return res.end(); }
            const r = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
            if (!r) { res.setHeader("Content-Length", f.data.length); return res.end(f.data); }
            const a = Number(r[1]), b = r[2] ? Number(r[2]) : f.data.length - 1;
            res.statusCode = 206;
            res.setHeader("Content-Range", `bytes ${a}-${b}/${f.data.length}`);
            return res.end(f.data.subarray(a, b + 1));
        }
        res.statusCode = 404; res.end();
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
});

beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    google = await startGoogle();
    process.env.GOOGLE_API_URL = "http://127.0.0.1:" + google.address().port;
});
afterAll(async () => { google.close(); await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => {
    await User.deleteMany({}); await HomeDevice.deleteMany({}); await MovieSettings.deleteMany({});
    drive = new Map([["a1", { name: "Film One.mp4", data: Buffer.alloc(40000, 1) }], ["b2", { name: "Film Two.mkv", data: Buffer.alloc(25000, 2) }], ["c3", { name: "notes.txt", data: Buffer.from("hi") }]]);
    deletes = [];
});

/** An account with a Google connection (full Drive access or read-only) and a signed-in tablet. */
async function setUp({ full = true, email = "ana@example.com" } = {}) {
    await request(app).post("/register").send({ name: "Ana", email, password: "master-pass", cpassword: "master-pass" });
    const login = await request(app).post("/login").send({ email, password: "master-pass", client: "mobile" });
    const auth = { Authorization: `Bearer ${login.body.token}` };
    const user = await User.findOne({ email });
    const key = await user.getDataKey();
    const scopes = ["https://www.googleapis.com/auth/drive.readonly", ...(full ? ["https://www.googleapis.com/auth/drive"] : [])];
    const entry = store.encoded(key, { id: "g1", email: "ana@gmail.com", label: "Ana's Google", provider: "Google Drive", status: "connected", accessToken: "tok", refreshToken: "ref", expiresAt: Date.now() + 3600000, scopes });
    await User.updateOne({ _id: user._id }, { $push: { photoConnections: entry } });
    const tablet = (await request(app).post("/home/devices").set(auth).send({ name: "Tablet", kind: "hub" })).body;
    return { auth, tablet, tabletAuth: { Authorization: `Bearer ${tablet.token}` }, userId: user._id };
}
const choose = (auth, extra = {}) => request(app).put("/home/movies/settings").set(auth).send({ connectionId: "g1", folder: `https://drive.google.com/drive/folders/${FOLDER}?usp=sharing`, ...extra });
const tvReport = (tablet, movies) => request(app).post("/home/agent/report").set({ Authorization: `Bearer ${tablet.token}` }).send({ status: {}, children: [{ key: "tv", name: "TV", status: { screen: "on", movies } }] });

describe("home movies: choosing the folder", () => {
    test("Connect Google Drive works from Smart home without Photo Cloud: read-only by default, full access on request", async () => {
        process.env.GOOGLE_CLIENT_ID = "client-id";
        const { auth } = await setUp();
        const scopeOf = (r) => new URL(r.body.url).searchParams.get("scope").split(" ");
        const stateOf = (r) => require("jsonwebtoken").verify(new URL(r.body.url).searchParams.get("state"), process.env.SECRET_KEY);
        const read = await request(app).get("/home/movies/google/start").set(auth);
        expect(read.status).toBe(200);
        expect(scopeOf(read).includes("https://www.googleapis.com/auth/drive.readonly")).toBe(true);
        expect(scopeOf(read).includes("https://www.googleapis.com/auth/drive")).toBe(false);
        expect(stateOf(read)).toMatchObject({ kind: "movies", full: false, returnTo: "/smart-home" });
        const full = await request(app).get("/home/movies/google/start?full=1").set(auth);
        expect(scopeOf(full).includes("https://www.googleapis.com/auth/drive")).toBe(true);
        expect(stateOf(full).full).toBe(true);
        expect((await request(app).get("/home/movies/google/start")).status).toBe(401);
        delete process.env.GOOGLE_CLIENT_ID;
    });

    test("the Google accounts are listed without their tokens, and a folder link or id is understood", async () => {
        const { auth } = await setUp();
        const r = await request(app).get("/home/movies/settings").set(auth);
        expect(r.status).toBe(200);
        expect(r.body.connections).toEqual([{ id: "g1", label: "Ana's Google", email: "ana@gmail.com", canDelete: true }]);
        expect(JSON.stringify(r.body)).not.toContain("tok");
        expect((await choose(auth)).status).toBe(200);
        expect((await choose(auth, { folder: FOLDER })).status).toBe(200);
        const after = await request(app).get("/home/movies/settings").set(auth);
        expect(after.body.settings.folderId).toBe(FOLDER);
        expect(after.body.waiting.map((f) => f.name).sort()).toEqual(["Film One.mp4", "Film Two.mkv"]);
    });

    test("a bad link, or deleting without full Drive access, is refused", async () => {
        const { auth } = await setUp({ full: false });
        expect((await choose(auth, { folder: "not a link" })).status).toBe(400);
        expect((await choose(auth, { deleteAfterSync: true })).status).toBe(400);
        expect((await choose(auth, { deleteAfterSync: false })).status).toBe(200);
    });

    test("without a signed-in account nothing is shown", async () => {
        expect((await request(app).get("/home/movies/settings")).status).toBe(401);
        expect((await request(app).put("/home/movies/settings").send({})).status).toBe(401);
    });
});

describe("home movies: what the TV is given", () => {
    test("the TV gets the refresh token, folder and mode to download on its own", async () => {
        const { auth, tabletAuth } = await setUp();
        await choose(auth);
        const g = await request(app).get("/home/movies/grant").set(tabletAuth);
        expect(g.status).toBe(200);
        expect(g.body.folderId).toBeTruthy();
        expect(g.body.mode).toBe("mirror");
        expect(g.body.refreshToken).toBeTruthy();
        await choose(auth, { deleteAfterSync: true });
        expect((await request(app).get("/home/movies/grant").set(tabletAuth)).body.mode).toBe("move");
    });

    test("no folder chosen gets 404, and a wrong token gets nothing", async () => {
        const { tabletAuth } = await setUp();
        expect((await request(app).get("/home/movies/grant").set(tabletAuth)).status).toBe(404);
        expect((await request(app).get("/home/movies/grant")).status).toBe(401);
        expect((await request(app).get("/home/movies/grant").set({ Authorization: "Bearer sh_" + "0".repeat(48) })).status).toBe(401);
    });

    test("the old server copy routes are gone", async () => {
        const { auth, tabletAuth } = await setUp();
        await choose(auth);
        expect((await request(app).get("/home/movies/file?path=a1").set(tabletAuth)).status).toBe(404);
        expect((await request(app).get("/home/movies/manifest").set(tabletAuth)).status).toBe(404);
    });
});

describe("home movies: clearing Drive once the TV has the movie", () => {
    test("only an exact, complete copy on the USB drive is removed from Drive", async () => {
        const { auth, tablet } = await setUp();
        await choose(auth, { deleteAfterSync: true });
        const settled = async () => { await new Promise((r) => setTimeout(r, 150)); };
        await tvReport(tablet, [{ name: "Film One.mp4", size: 39999, where: "Synced" }]);   // wrong size
        await settled();
        expect(deletes).toEqual([]);
        await tvReport(tablet, [{ name: "Film One.mp4", size: 40000, where: "Movies" }]);   // not from the sync folder
        await settled();
        expect(deletes).toEqual([]);
        await tvReport(tablet, [{ name: "Other.mp4", size: 40000, where: "Synced" }]);      // not in Drive
        await settled();
        expect(deletes).toEqual([]);
        await tvReport(tablet, [{ name: "Film One.mp4", size: 40000, where: "Synced" }]);   // exactly right
        await settled();
        expect(deletes).toEqual(["a1"]);
        expect(drive.has("b2")).toBe(true);
        const s = await request(app).get("/home/movies/settings").set(auth);
        expect(s.body.lastDelete.name).toBe("Film One.mp4");
        expect(s.body.waiting.map((f) => f.name)).toEqual(["Film Two.mkv"]);
    });

    test("nothing is removed while delete-after-sync is off", async () => {
        const { auth, tablet } = await setUp();
        await choose(auth, { deleteAfterSync: false });
        await tvReport(tablet, [{ name: "Film One.mp4", size: 40000, where: "Synced" }]);
        await new Promise((r) => setTimeout(r, 150));
        expect(deletes).toEqual([]);
    });
});
