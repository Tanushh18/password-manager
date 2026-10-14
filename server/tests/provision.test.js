const { describe, test } = require("node:test");
const expect = require("./expect");
const { TEMPLATES, RUNTIMES, REGIONS } = require("../utils/templates");
const { validateProvisionInput, buildRenderPayload, slugify } = require("../utils/provisionInput");
const { diffEnvPush, selectPushes } = require("../utils/envPush");
const { hashValue } = require("../utils/envHash");
const { provision, pushInstructions } = require("../utils/provision");

const base = (over = {}) => ({ name: "My Cool App", template: "node", visibility: "private", region: "singapore", githubAccountId: "g1", renderAccountId: "r1", envVars: [{ name: "API_KEY", value: "s3cret" }], ...over });
const valid = (over) => { const r = validateProvisionInput(base(over)); if (!r.value) throw new Error(r.error); return r.value; };

describe("starter templates", () =>
{
    test("every template ships a .gitignore that excludes .env", () =>
    {
        for (const [key, t] of Object.entries(TEMPLATES)) expect(t.files("demo")[".gitignore"]).toContain(".env");
    });

    test("node: valid package.json whose start script matches the Render start command", () =>
    {
        const files = TEMPLATES.node.files("demo");
        const pkg = JSON.parse(files["package.json"]);
        expect(pkg.scripts.start).toBe("node server.js");
        expect(TEMPLATES.node.render.startCommand).toBe("npm start");
        expect(files["server.js"]).toContain("process.env.PORT");
        expect(files["server.js"]).toContain('"/health"');
        expect(Boolean(pkg.dependencies.express)).toBe(true);
    });

    test("python: the start command's module path exists and binds to $PORT on 0.0.0.0", () =>
    {
        const files = TEMPLATES.python.files("demo");
        expect(Object.keys(files)).toContain("app/main.py");
        expect(TEMPLATES.python.render.startCommand).toBe("uvicorn app.main:app --host 0.0.0.0 --port $PORT");
        expect(files["requirements.txt"]).toContain("fastapi");
        expect(files["app/main.py"]).toContain('"/health"');
        expect(files["app/__init__.py"].length > 0).toBe(true);
    });

    test("static: a plain index.html and no start command; no workflow files anywhere", () =>
    {
        expect(Object.keys(TEMPLATES.static.files("demo")).includes("index.html")).toBe(true);
        for (const t of Object.values(TEMPLATES)) expect(Object.keys(t.files("x")).some((p) => p.startsWith(".github"))).toBe(false);
    });
});

describe("create & deploy input validation", () =>
{
    test("accepts a normal request and derives a safe repo name", () =>
    {
        const v = valid();
        expect(v.repoName).toBe("my-cool-app");
        expect(v.visibility).toBe("private");
        expect(slugify("  Hello_World!! v2 ")).toBe("hello_world-v2");
    });

    test("rejects bad names, templates, regions and runtimes", () =>
    {
        for (const body of [{ name: "" }, { name: "..." }, { template: "php" }, { region: "mars" }, { template: "empty", runtime: "cobol" }, { template: "existing" }])
            expect(Boolean(validateProvisionInput(base(body)).error)).toBe(true);
        expect(REGIONS.includes("singapore")).toBe(true);
    });

    test("env vars: valid names only, no duplicates, bounded", () =>
    {
        expect(validateProvisionInput(base({ envVars: [{ name: "BAD NAME", value: "x" }] })).error).toMatch(/not a valid variable name/);
        expect(validateProvisionInput(base({ envVars: [{ name: "A", value: "1" }, { name: "A", value: "2" }] })).error).toMatch(/twice/);
        expect(Boolean(validateProvisionInput(base({ envVars: Array.from({ length: 51 }, (_, i) => ({ name: "K" + i, value: "v" })) })).error)).toBe(true);
        expect(validateProvisionInput(base({ envVars: [{ name: "", value: "" }] })).value.envVars).toHaveLength(0);
    });

    test("own-code mode takes your commands; templates ignore client-supplied commands", () =>
    {
        const own = valid({ template: "empty", runtime: "python", buildCommand: "pip install x", startCommand: "python run.py" });
        expect(own.startCommand).toBe("python run.py");
        const tpl = valid({ template: "node", buildCommand: "rm -rf /", startCommand: "evil" });
        expect(tpl.startCommand).toBe("npm start");
        expect(tpl.buildCommand).toBe("npm install");
        expect(Boolean(validateProvisionInput(base({ template: "empty", startCommand: "a\nb" })).error)).toBe(true);
    });
});

describe("Render payload is free-plan only", () =>
{
    const opts = { ownerId: "own-1", repoUrl: "https://github.com/o/r", branch: "main" };

    test("web services always carry plan: free, whatever the client sends", () =>
    {
        for (const body of [{}, { plan: "pro" }, { plan: "standard", serviceDetails: { plan: "pro_max" } }, { template: "python" }, { template: "empty", runtime: "node" }])
        {
            const payload = buildRenderPayload(valid(body), opts);
            expect(payload.type).toBe("web_service");
            expect(payload.serviceDetails.plan).toBe("free");
        }
    });

    test("static sites use the static type with no paid plan field, and env vars are mapped", () =>
    {
        const payload = buildRenderPayload(valid({ template: "static" }), opts);
        expect(payload.type).toBe("static_site");
        expect(payload.serviceDetails.plan).toBeUndefined();
        expect(payload.envVars[0].key).toBe("API_KEY");
        expect(payload.autoDeploy).toBe("yes");
        expect(payload.repo).toBe("https://github.com/o/r");
    });
});

describe("pushing env vars to Render (diff)", () =>
{
    const project = (arr) => arr.map(([name, value, renderHash]) => ({ name, value, source: "render", renderHash }));

    test("classifies create / update / conflict / unchanged / render-only / empty", () =>
    {
        const plan = diffEnvPush(
            project([["NEW", "1"], ["SAME", "2", hashValue("2")], ["EDITED", "mine", hashValue("old")], ["CONFLICT", "mine", hashValue("old")], ["EMPTY", ""]]),
            [{ key: "SAME", value: "2" }, { key: "EDITED", value: "old" }, { key: "CONFLICT", value: "changed in render" }, { key: "ONLY_RENDER", value: "x" }]
        );
        expect(plan.create.join()).toBe("NEW");
        expect(plan.unchanged.join()).toBe("SAME");
        expect(plan.update.join()).toBe("EDITED");
        expect(plan.conflicts.join()).toBe("CONFLICT");
        expect(plan.onlyInRender.join()).toBe("ONLY_RENDER");
        expect(plan.skippedEmpty.join()).toBe("EMPTY");
    });

    test("a differing value with no sync history is a conflict, never silently overwritten", () =>
    {
        expect(diffEnvPush([{ name: "A", value: "x" }], [{ key: "A", value: "y" }]).conflicts.join()).toBe("A");
    });

    test("only approved names are pushed; conflicts also need an explicit overwrite", () =>
    {
        const plan = diffEnvPush(project([["NEW", "1"], ["EDITED", "mine", hashValue("old")], ["CONFLICT", "mine", hashValue("old")]]), [{ key: "EDITED", value: "old" }, { key: "CONFLICT", value: "theirs" }]);
        expect(selectPushes(plan, { names: [] })).toHaveLength(0);
        expect(selectPushes(plan, { names: ["NEW", "EDITED", "CONFLICT"] }).map((p) => p.name).join()).toBe("NEW,EDITED");
        const forced = selectPushes(plan, { names: ["CONFLICT"], overwrite: ["CONFLICT"] });
        expect(forced[0].action).toBe("overwrite");
        expect(forced[0].value).toBe("mine");
        expect(selectPushes(plan, { names: ["NOT_IN_PLAN"] })).toHaveLength(0);
    });

    test("variables flagged removed-from-Render and invalid names are never pushed", () =>
    {
        const plan = diffEnvPush([{ name: "GONE", value: "x", source: "render-removed" }, { name: "bad name", value: "x" }], []);
        expect(plan.create).toHaveLength(0);
    });
});

/* ---------- orchestration with fake GitHub / Render ---------- */
const makeDeps = (over = {}) =>
{
    const calls = [];
    const saved = [];
    const github = {
        login: "tanush",
        send: async (method, path, body) =>
        {
            calls.push({ api: "github", method, path, body });
            if (over.github) { const r = over.github(method, path, body); if (r) return r; }
            if (method === "POST" && path === "/user/repos") return { ok: true, status: 201, body: { name: body.name, owner: { login: "tanush" }, default_branch: "main" } };
            if (method === "GET") return { ok: true, status: 200, body: { name: path.split("/").pop(), owner: { login: "tanush" }, default_branch: "main" } };
            return { ok: true, status: 201, body: {} };
        }
    };
    const render = {
        request: async (path, options = {}) =>
        {
            calls.push({ api: "render", path, ...options });
            if (over.render) { const r = over.render(path, options); if (r !== undefined) return r; }
            if (path.startsWith("/v1/owners")) return [{ owner: { id: "own-1", name: "Me" } }];
            if (path === "/v1/services") return { service: { id: "srv-new", name: options.body.name, dashboardUrl: "https://dashboard.render.com/web/srv-new", serviceDetails: { plan: "free", url: "https://" + options.body.name + ".onrender.com" } }, deployId: "dep-1" };
            return {};
        }
    };
    return { calls, saved, github, render, saveProject: async (fields) => { if (over.saveFails) throw new Error("db"); saved.push(fields); return "proj-1"; }, audit: async (d) => { calls.push({ api: "audit", d }); } };
};
const run = (deps, input) => provision({ input, github: deps.github, render: deps.render, saveProject: deps.saveProject, audit: deps.audit });

describe("provision orchestration", () =>
{
    test("happy path: repo, starter files, free service with env vars, linked project", async () =>
    {
        const deps = makeDeps();
        const r = await run(deps, valid());
        expect(r.ok).toBe(true);
        expect(r.steps.map((s) => s.step + ":" + s.status).join()).toBe("github-repo:done,github-files:done,render-service:done,stashr-project:done");
        expect(deps.calls.find((c) => c.path === "/user/repos").body.private).toBe(true);
        const files = deps.calls.filter((c) => c.method === "PUT").map((c) => c.path.split("/contents/")[1]);
        expect(files.includes("package.json") && files.includes("server.js") && files.includes(".gitignore")).toBe(true);
        const create = deps.calls.find((c) => c.path === "/v1/services");
        expect(create.body.serviceDetails.plan).toBe("free");
        expect(create.body.envVars[0]).toEqual({ key: "API_KEY", value: "s3cret" });
        expect(create.body.repo).toBe("https://github.com/tanush/my-cool-app");
        expect(deps.saved[0].renderServiceId).toBe("srv-new");
        expect(deps.saved[0].hostingPlan).toBe("free");
        expect(deps.saved[0].envVars[0].renderHash).toBe(hashValue("s3cret"));
        expect(r.firstDeploy).toBe("started");
        expect(r.projectId).toBe("proj-1");
        expect(JSON.stringify(r)).not.toContain("s3cret");
    });

    test("empty repo: no files committed, push commands returned, deploy waits for the first push", async () =>
    {
        const deps = makeDeps();
        const r = await run(deps, valid({ template: "empty", runtime: "python" }));
        expect(r.ok).toBe(true);
        expect(deps.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
        expect(r.firstDeploy).toBe("waiting-for-code");
        expect(r.repo.https).toBe("https://github.com/tanush/my-cool-app.git");
        expect(r.repo.ssh).toBe("git@github.com:tanush/my-cool-app.git");
        expect(r.repo.commands.join("\n")).toContain("git push -u origin main");
        expect(r.repo.commands.join("\n")).not.toContain("ghp_");
        expect(deps.calls.find((c) => c.path === "/v1/services").body.serviceDetails.envSpecificDetails.startCommand).toContain("uvicorn");
    });

    test("name already taken: stops before touching Render and offers reuse", async () =>
    {
        const deps = makeDeps({ github: (m, p) => (m === "POST" ? { ok: false, status: 422, body: {} } : null) });
        const r = await run(deps, valid());
        expect(r.ok).toBe(false);
        expect(r.failedStep).toBe("github-repo");
        expect(r.canReuseRepo).toBe(true);
        expect(deps.calls.some((c) => c.api === "render")).toBe(false);
    });

    test("retry with useExistingRepo reuses the repo and does not recommit starter files", async () =>
    {
        const deps = makeDeps({ github: (m) => (m === "POST" ? { ok: false, status: 422, body: {} } : null) });
        const r = await run(deps, valid({ useExistingRepo: true }));
        expect(r.ok).toBe(true);
        expect(r.steps[0].status).toBe("skipped");
        expect(deps.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    });

    test("a token without the repo scope gets a clear permission error", async () =>
    {
        const deps = makeDeps({ github: (m) => (m === "POST" ? { ok: false, status: 403, body: {} } : null) });
        const r = await run(deps, valid());
        expect(r.error).toMatch(/“repo” scope/);
    });

    test("a failed file commit keeps the repo, reports it, and never calls Render", async () =>
    {
        const deps = makeDeps({ github: (m, p) => (m === "PUT" && p.endsWith("server.js") ? { ok: false, status: 500, body: {} } : null) });
        const r = await run(deps, valid());
        expect(r.failedStep).toBe("github-files");
        expect(r.repo.url).toBe("https://github.com/tanush/my-cool-app");
        expect(deps.calls.some((c) => c.api === "render")).toBe(false);
        expect(deps.calls.some((c) => c.method === "DELETE")).toBe(false);
    });

    test("Render refusing the service keeps the repo, hints about the GitHub app for private repos, never deletes", async () =>
    {
        const deps = makeDeps({ render: (p) => { if (p === "/v1/services") throw Object.assign(new Error("repo not accessible"), { status: 400 }); } });
        const r = await run(deps, valid({ visibility: "private" }));
        expect(r.failedStep).toBe("render-service");
        expect(r.error).toMatch(/GitHub app/);
        expect(r.repo.url).toContain("tanush/my-cool-app");
        expect(r.canReuseRepo).toBe(true);
        expect(deps.saved).toHaveLength(0);
        expect(deps.calls.some((c) => c.method === "DELETE")).toBe(false);
    });

    test("refuses loudly if Render ever returns a non-free plan", async () =>
    {
        const deps = makeDeps({ render: (p, o) => (p === "/v1/services" ? { service: { id: "s", name: "x", serviceDetails: { plan: "starter" } } } : undefined) });
        const r = await run(deps, valid());
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/not free/);
        expect(deps.saved).toHaveLength(0);
    });

    test("a failing Stashr save still reports the created repo and service", async () =>
    {
        const r = await run(makeDeps({ saveFails: true }), valid());
        expect(r.ok).toBe(true);
        expect(r.steps.find((s) => s.step === "stashr-project").status).toBe("failed");
        expect(r.projectId).toBeNull();
        expect(r.service.id).toBe("srv-new");
    });

    test("workspace choice must belong to the Render account; existing repos are verified first", async () =>
    {
        const deps = makeDeps();
        const r = await provision({ input: valid(), github: deps.github, render: deps.render, ownerId: "someone-else", saveProject: deps.saveProject, audit: deps.audit });
        expect(r.ok).toBe(false);
        const none = makeDeps({ github: (m) => (m === "GET" ? { ok: false, status: 404, body: null } : null) });
        const e = await run(none, valid({ template: "existing", existingRepoUrl: "https://github.com/o/missing" }));
        expect(e.failedStep).toBe("github-repo");
        expect(e.error).toMatch(/not found|no access/);
        expect(none.calls.some((c) => c.api === "render")).toBe(false);
    });

    test("static template creates a static_site service", async () =>
    {
        const deps = makeDeps();
        await run(deps, valid({ template: "static" }));
        expect(deps.calls.find((c) => c.path === "/v1/services").body.type).toBe("static_site");
    });

    test("pushInstructions never contains credentials", () =>
    {
        const p = pushInstructions({ owner: "o", repo: "r", branch: "trunk" });
        expect(p.commands.join(" ")).toContain("git branch -M trunk");
        expect(p.https).not.toContain("@");
    });
});
