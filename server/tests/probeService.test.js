const { describe, test, afterEach } = require("node:test");
const expect = require("./expect");
const { probeService } = require("../utils/renderOps");

const service = { serviceDetails: { url: "https://demo.onrender.com" } };
const realFetch = global.fetch;
const reply = (status, routing) => ({ status, headers: { get: (k) => (k === "x-render-routing" ? routing || null : null) }, body: { cancel: async () => {} } });
const stub = (handler) => { const calls = []; global.fetch = async (url) => { calls.push(String(url)); return handler(String(url), calls.length); }; return calls; };
afterEach(() => { global.fetch = realFetch; });

describe("service health probe", () =>
{
    test("200 is healthy", async () =>
    {
        stub(() => reply(200));
        expect((await probeService(service)).state).toBe("healthy");
    });

    test("an API that answers 404 on / but has /health is healthy", async () =>
    {
        const calls = stub((url) => reply(url.endsWith("/health") ? 200 : 404));
        const r = await probeService(service);
        expect(r.state).toBe("healthy");
        expect(r.path).toBe("/health");
        expect(calls[0]).toBe("https://demo.onrender.com/");
    });

    test("404 everywhere is still a live server, not an outage", async () =>
    {
        stub(() => reply(404));
        const r = await probeService(service);
        expect(r.state).toBe("healthy");
        expect(r.message).toMatch(/server is up/);
    });

    test("429 (rate limited) and 401/403 mean the server is up", async () =>
    {
        for (const status of [429, 401, 403]) { stub(() => reply(status)); expect((await probeService(service)).state).toBe("healthy"); }
    });

    test("Render's own no-server page is down, even though it is a 404", async () =>
    {
        stub(() => reply(404, "no-server"));
        const r = await probeService(service);
        expect(r.state).toBe("unhealthy");
        expect(r.message).toMatch(/no running server/);
    });

    test("500 is unhealthy; a cold start that recovers on the retry is healthy", async () =>
    {
        stub(() => reply(500));
        expect((await probeService(service)).state).toBe("unhealthy");
        stub((url, n) => (n === 1 ? reply(503) : reply(200)));
        expect((await probeService(service)).state).toBe("healthy");
    });

    test("timeouts are retried once, then reported as timeout", async () =>
    {
        let n = 0;
        global.fetch = async () => { n += 1; throw Object.assign(new Error("t"), { name: "TimeoutError" }); };
        const r = await probeService(service);
        expect(r.state).toBe("timeout");
        expect(n).toBe(2);
    });

    test("only Render-provided HTTPS URLs are probed", async () =>
    {
        const calls = stub(() => reply(200));
        expect((await probeService({ serviceDetails: { url: "https://evil.example.com" } })).state).toBe("unsupported");
        expect(calls).toHaveLength(0);
    });
});
