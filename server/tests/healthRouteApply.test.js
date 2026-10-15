const { describe, test, beforeEach, afterEach } = require("node:test");
const expect = require("./expect");
const { applyHealthRoute } = require("../utils/healthRouteApply");

/* A fake GitHub: a repo with a few files. Records every write so we can see exactly what would be pushed. */
let repoFiles, writes, realFetch, opts;
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const b64 = (text) => Buffer.from(text, "utf8").toString("base64");
const accounts = [{ id: "a1", name: "me", login: "o", token: "ghp_" + "x".repeat(30) }];

beforeEach(() => {
    writes = []; opts = { mergeOk: true, scopes: "repo" };
    realFetch = global.fetch;
    global.fetch = async (url, init = {}) => {
        url = String(url).replace("https://api.github.com", "");
        const method = init.method || "GET";
        if (url === "/user") return json({ login: "o" }, 200, { "x-oauth-scopes": opts.scopes });
        if (url === "/repos/o/demo") return json({ full_name: "o/demo", default_branch: "main", owner: { login: "o" }, name: "demo" });
        if (url.startsWith("/repos/o/demo/git/ref/heads/main")) return json({ object: { sha: "abc123" } });
        if (method === "GET" && url.startsWith("/repos/o/demo/contents/")) {
            const path = decodeURIComponent(url.slice("/repos/o/demo/contents/".length).split("?")[0]);
            return repoFiles[path] != null ? json({ type: "file", content: b64(repoFiles[path]), sha: "sha-" + path }) : json({ message: "Not Found" }, 404);
        }
        writes.push({ method, url, body: init.body ? JSON.parse(init.body) : null });
        if (method === "POST" && url.endsWith("/git/refs")) return json({}, 201);
        if (method === "PUT" && url.includes("/contents/")) return json({}, 201);
        if (method === "POST" && url.endsWith("/pulls")) return json({ number: 7, html_url: "https://github.com/o/demo/pull/7" }, 201);
        if (method === "PUT" && url.endsWith("/merge")) return opts.mergeOk ? json({ merged: true }) : json({ message: "Merge blocked" }, 405);
        if (method === "DELETE") return json({}, 204);
        return json({}, 404);
    };
});
afterEach(() => { global.fetch = realFetch; });

const committed = () => writes.find((w) => w.method === "PUT" && w.url.includes("/contents/"));
const text = (w) => Buffer.from(w.body.content, "base64").toString("utf8");

describe("adding a missing /health route to the repository", () => {
    test("Express: inserts the route, commits on a branch, opens a PR and merges it (Render redeploys)", async () => {
        repoFiles = { "package.json": JSON.stringify({ main: "server.js", dependencies: { express: "^4" } }), "server.js": 'const express = require("express");\nconst app = express();\napp.get("/", (req, res) => res.send("hi"));\n' };
        const r = await applyHealthRoute({ accounts, repoUrl: "https://github.com/o/demo", merge: true });
        expect(r.status).toBe(200);
        expect(r.body.ok).toBe(true);
        expect(r.body.merged).toBe(true);
        expect(r.body.file).toBe("server.js");
        const c = committed();
        expect(text(c)).toContain('app.get("/health"');
        expect(text(c)).toContain('app.get("/", (req, res) => res.send("hi"));'); // existing code untouched
        expect(c.body.branch).toMatch(/^stashr\/health-route-/);
        expect(c.body.sha).toBe("sha-server.js");
        expect(writes.some((w) => w.method === "DELETE")).toBe(true); // only Stashr's own temp branch is removed
    });

    test("Next.js: creates app/health/route.js as a new file", async () => {
        repoFiles = { "package.json": JSON.stringify({ dependencies: { next: "15", react: "19" } }), "app/layout.js": "export default function L(){}" };
        const r = await applyHealthRoute({ accounts, repoUrl: "https://github.com/o/demo", merge: true });
        expect(r.body.file).toBe("app/health/route.js");
        expect(text(committed())).toContain('Response.json({ status: "ok" })');
        expect(committed().body.sha).toBeUndefined();
    });

    test("a repo that already has /health is left alone", async () => {
        repoFiles = { "package.json": JSON.stringify({ main: "server.js", dependencies: { express: "^4" } }), "server.js": 'const app = express();\napp.get("/health", h);\n' };
        const r = await applyHealthRoute({ accounts, repoUrl: "https://github.com/o/demo", merge: true });
        expect(r.body.already).toBe(true);
        expect(writes).toHaveLength(0);
    });

    test("without merge it only opens a pull request", async () => {
        repoFiles = { "package.json": JSON.stringify({ main: "server.js", dependencies: { express: "^4" } }), "server.js": "const app = express();\n" };
        const r = await applyHealthRoute({ accounts, repoUrl: "https://github.com/o/demo", merge: false });
        expect(r.body.merged).toBe(false);
        expect(writes.some((w) => w.url.endsWith("/merge"))).toBe(false);
    });

    test("a refused merge is reported, the PR stays open and nothing is deleted", async () => {
        opts.mergeOk = false;
        repoFiles = { "package.json": JSON.stringify({ main: "server.js", dependencies: { express: "^4" } }), "server.js": "const app = express();\n" };
        const r = await applyHealthRoute({ accounts, repoUrl: "https://github.com/o/demo", merge: true });
        expect(r.body.merged).toBe(false);
        expect(r.body.mergeError).toMatch(/Merge blocked/);
        expect(writes.some((w) => w.method === "DELETE")).toBe(false);
    });

    test("read-only tokens, unsupported stacks and missing repos explain themselves and write nothing", async () => {
        repoFiles = { "package.json": JSON.stringify({ dependencies: { express: "^4" } }), "server.js": "const app = express();\n" };
        opts.scopes = "read:user"; // scopes are cached per token, so use a different token for the read-only case
        const readOnly = [{ ...accounts[0], token: "ghp_" + "r".repeat(30) }];
        expect((await applyHealthRoute({ accounts: readOnly, repoUrl: "https://github.com/o/demo", merge: true })).body.error).toMatch(/read-only/);
        opts.scopes = "repo";
        repoFiles = { "main.go": "package main" };
        const go = await applyHealthRoute({ accounts, repoUrl: "https://github.com/o/demo", merge: true });
        expect(go.status).toBe(422);
        expect(go.body.error).toMatch(/Could not tell the framework/);
        expect((await applyHealthRoute({ accounts, repoUrl: "not a url" })).status).toBe(400);
        expect((await applyHealthRoute({ accounts: [], repoUrl: "https://github.com/o/demo" })).status).toBe(400);
        expect(writes).toHaveLength(0);
    });
});
