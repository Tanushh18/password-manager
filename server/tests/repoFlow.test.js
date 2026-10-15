const { describe, test } = require("node:test");
const expect = require("./expect");
const { createRepo, checkRepo, repoReadyError, PRIVATE_ERROR } = require("../utils/repoFlow");
const { provision } = require("../utils/provision");
const { validateProvisionInput } = require("../utils/provisionInput");

const input = (over = {}) => { const r = validateProvisionInput({ name: "My App", template: "empty", visibility: "public", region: "singapore", ...over }); if (!r.value) throw new Error(r.error); return r.value; };
const fakeGithub = (handler) => { const calls = []; return { calls, login: "tanush", send: async (method, path, body) => { calls.push({ method, path, body }); return handler(method, path, body); } }; };
const ok = (body, status = 200) => ({ ok: true, status, body });
const fail = (status, body = {}) => ({ ok: false, status, body });

describe("guided flow: create the repository", () =>
{
    test("creates a PUBLIC repo and returns push commands (empty repo)", async () =>
    {
        const github = fakeGithub((m) => (m === "POST" ? ok({ name: "my-app", owner: { login: "tanush" }, default_branch: "main" }, 201) : null));
        const r = await createRepo({ input: input(), github });
        expect(r.ok).toBe(true);
        expect(github.calls[0].body.private).toBe(false);
        expect(r.hasStarter).toBe(false);
        expect(r.repo.commands.join("\n")).toContain("git remote add origin https://github.com/tanush/my-app.git");
        expect(r.repo.commands.join("\n")).toContain("git push -u origin main");
        expect(r.repo.private).toBe(false);
    });

    test("private is refused before GitHub is touched", async () =>
    {
        const github = fakeGithub(() => ok({}));
        const r = await createRepo({ input: input({ visibility: "private" }), github });
        expect(r.ok).toBe(false);
        expect(r.error).toBe(PRIVATE_ERROR);
        expect(github.calls).toHaveLength(0);
    });

    test("a starter template is committed and the commands become clone-based", async () =>
    {
        const github = fakeGithub((m, p) => (m === "POST" ? ok({ name: "my-app", owner: { login: "tanush" }, default_branch: "main" }, 201) : m === "GET" ? ok({ default_branch: "main" }) : ok({}, 201)));
        const r = await createRepo({ input: input({ template: "nextjs" }), github });
        expect(r.ok).toBe(true);
        expect(r.hasStarter).toBe(true);
        expect(github.calls.filter((c) => c.method === "PUT").some((c) => c.path.endsWith("app/page.js"))).toBe(true);
        expect(r.repo.commands[0]).toBe("git clone https://github.com/tanush/my-app.git");
    });

    test("a name clash reuses nothing silently and an existing private repo is refused", async () =>
    {
        const clash = fakeGithub((m) => (m === "POST" ? fail(422) : ok({ name: "my-app", private: true, owner: { login: "tanush" } })));
        expect((await createRepo({ input: input(), github: clash })).error).toBe(PRIVATE_ERROR);
        const taken = fakeGithub((m) => (m === "POST" ? fail(422) : fail(404)));
        expect((await createRepo({ input: input(), github: taken })).error).toMatch(/already exists/);
    });

    test("a token without the repo scope gets a clear error", async () =>
    {
        const github = fakeGithub((m) => (m === "POST" ? fail(403) : null));
        expect((await createRepo({ input: input(), github })).error).toMatch(/“repo” scope/);
    });
});

describe("guided flow: has the code arrived?", () =>
{
    test("an empty repository (409) is not an error, it just has no code", async () =>
    {
        const github = fakeGithub((m, p) => (p.includes("/commits") ? fail(409) : ok({ private: false, default_branch: "main" })));
        const r = await checkRepo({ github, owner: "o", repo: "r" });
        expect(r.ok).toBe(true);
        expect(r.hasCode).toBe(false);
    });

    test("a repository with a commit has code", async () =>
    {
        const github = fakeGithub((m, p) => (p.includes("/commits") ? ok([{ sha: "abc" }]) : ok({ private: false, default_branch: "trunk" })));
        const r = await checkRepo({ github, owner: "o", repo: "r" });
        expect(r.hasCode).toBe(true);
        expect(r.branch).toBe("trunk");
        expect(github.calls[1].path).toContain("sha=trunk");
    });

    test("private and missing repositories are rejected", async () =>
    {
        expect((await checkRepo({ github: fakeGithub(() => ok({ private: true })), owner: "o", repo: "r" })).error).toBe(PRIVATE_ERROR);
        const missing = await checkRepo({ github: fakeGithub(() => fail(404)), owner: "o", repo: "r" });
        expect(missing.ok).toBe(false);
        expect(missing.status).toBe(404);
    });
});

describe("guided flow: deploy is gated on pushed code", () =>
{
    const render = { request: async (path, options = {}) => (path.startsWith("/v1/owners") ? [{ owner: { id: "own-1", name: "Me" } }] : { service: { id: "srv-1", name: options.body.name, serviceDetails: { plan: "free", url: "https://x.onrender.com" } }, deployId: "d1" }) };
    const deployInput = () => input({ template: "existing", existingRepoUrl: "https://github.com/o/r", runtime: "nextjs" });
    const run = (github, extra = {}) => provision({ input: deployInput(), github, render, saveProject: async () => "proj-1", audit: async () => {}, precheck: repoReadyError, ...extra });

    test("no code yet: stops before Render with a clear message", async () =>
    {
        const calls = [];
        const github = fakeGithub((m, p) => (p.includes("/commits") ? fail(409) : ok({ private: false, name: "r", owner: { login: "o" }, default_branch: "main" })));
        const r = await run(github, { render: { request: async (...a) => { calls.push(a); return {}; } } });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/No code has been pushed/);
        expect(calls).toHaveLength(0);
    });

    test("private repo: refused before Render", async () =>
    {
        const github = fakeGithub(() => ok({ private: true, name: "r", owner: { login: "o" }, default_branch: "main" }));
        expect((await run(github)).error).toBe(PRIVATE_ERROR);
    });

    test("public repo with code deploys on the free plan", async () =>
    {
        const github = fakeGithub((m, p) => (p.includes("/commits") ? ok([{ sha: "abc" }]) : ok({ private: false, name: "r", owner: { login: "o" }, default_branch: "main" })));
        const r = await run(github);
        expect(r.ok).toBe(true);
        expect(r.service.plan).toBe("free");
    });
});
