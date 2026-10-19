const { describe, test } = require("node:test");
const expect = require("./expect");
const { PROVIDERS, hostName } = require("../utils/hosts");

const ok = (body) => ({ ok: true, status: 200, body });
const bad = (status, body = null) => ({ ok: false, status, body });
const recorder = (handler) => { const calls = []; const http = async (url, opts = {}) => { calls.push({ url, ...opts }); return handler(url, opts); }; http.calls = calls; return http; };
const input = { name: "my-app", owner: "me", repo: "app", branch: "feature-x", defaultBranch: "main", envVars: [{ name: "A", value: "1" }, { name: "bad name", value: "x" }] };

describe("hosting providers", () => {
  test("hostName makes a safe slug", () => { expect(hostName("My Cool App!")).toBe("my-cool-app"); });

  test("vercel: validates the token and sends repo, branch and env to the right host", async () => {
    const http = recorder((url) => (url.includes("/v2/user") ? ok({ user: { username: "tan" } }) : url.includes("/v11/projects") ? ok({ id: "prj_1" }) : ok({ id: "dpl_1", url: "my-app-git-feature-x.vercel.app" })));
    expect((await PROVIDERS.vercel.validate("tok", {}, http)).label).toBe("tan");
    const r = await PROVIDERS.vercel.deploy("tok", {}, input, http);
    expect(r.ok).toBe(true);
    const project = http.calls.find((c) => c.url.includes("/v11/projects"));
    expect(project.json.gitRepository.repo).toBe("me/app");
    expect(project.json.environmentVariables.length).toBe(1);
    expect(http.calls.find((c) => c.url.includes("/v13/deployments")).json.gitSource.ref).toBe("feature-x");
    expect(r.service.url).toContain("feature-x");
    for (const c of http.calls) expect(c.url.startsWith("https://api.vercel.com/")).toBe(true);
  });

  test("vercel: a rejected token and a taken name give clear errors", async () => {
    expect((await PROVIDERS.vercel.validate("t", {}, recorder(() => bad(401)))).ok).toBe(false);
    const r = await PROVIDERS.vercel.deploy("t", {}, input, recorder(() => bad(409, { error: { code: "project_name_taken" } })));
    expect(r.error).toContain("already exists");
  });

  test("netlify: adds a deploy key to GitHub, then creates the site on the branch", async () => {
    const http = recorder((url) => (url.endsWith("/deploy_keys") ? ok({ id: "k1", public_key: "ssh-rsa AAA" }) : url.endsWith("/sites") ? ok({ id: "s1", ssl_url: "https://my-app.netlify.app", admin_url: "https://app.netlify.com/sites/my-app" }) : ok({ id: "b1" })));
    const gh = [];
    const r = await PROVIDERS.netlify.deploy("tok", {}, input, http, async (m, p, body) => { gh.push({ m, p, body }); return { ok: true, status: 201 }; });
    expect(r.ok).toBe(true);
    expect(gh[0].p).toBe("/repos/me/app/keys");
    expect(gh[0].body.read_only).toBe(true);
    expect(http.calls.find((c) => c.url.endsWith("/sites")).json.repo.repo_branch).toBe("feature-x");
  });

  test("netlify: refuses without a usable GitHub token", async () => {
    const http = recorder(() => ok({ id: "k", public_key: "ssh-rsa A" }));
    expect((await PROVIDERS.netlify.deploy("t", {}, input, http, async () => ({ ok: false, status: 403 }))).error).toContain("deploy key");
  });

  test("railway: creates the project on the branch, sets variables and a domain", async () => {
    const http = recorder((url, o) => {
      const q = o.json.query;
      if (q.includes("projectCreate")) return ok({ data: { projectCreate: { id: "p1", environments: { edges: [{ node: { id: "e1" } }] }, services: { edges: [{ node: { id: "sv1" } }] } } } });
      if (q.includes("serviceDomainCreate")) return ok({ data: { serviceDomainCreate: { domain: "my-app.up.railway.app" } } });
      return ok({ data: { variableCollectionUpsert: true } });
    });
    const r = await PROVIDERS.railway.deploy("tok", {}, input, http);
    expect(r.service.url).toBe("https://my-app.up.railway.app");
    expect(http.calls[0].json.variables.input.repo).toEqual({ fullRepoName: "me/app", branch: "feature-x" });
  });

  test("cloudflare: finds the account and creates a Pages project on the branch", async () => {
    const http = recorder((url) => (url.endsWith("/tokens/verify") ? ok({ result: { status: "active" } }) : url.endsWith("/accounts") ? ok({ result: [{ id: "acc1", name: "Me" }] }) : url.endsWith("/pages/projects") ? ok({ result: { id: "x", subdomain: "my-app.pages.dev" } }) : ok({ result: { id: "d1" } })));
    const v = await PROVIDERS.cloudflare.validate("tok", {}, http);
    expect(v.accountId).toBe("acc1");
    const r = await PROVIDERS.cloudflare.deploy("tok", { accountId: "acc1" }, input, http);
    expect(r.service.url).toBe("https://my-app.pages.dev");
    expect(http.calls.find((c) => c.url.endsWith("/pages/projects")).json.source.config.production_branch).toBe("feature-x");
  });
});
