const { describe, test } = require("node:test");
const expect = require("./expect");
const { PROVIDERS } = require("../utils/hosts");

/* A fake provider API: `routes` maps "METHOD url-fragment" to { ok, status, body }. Records every call. */
const fakeHttp = (routes) => {
  const calls = [];
  const http = async (url, opts = {}) => {
    const method = opts.method || "GET";
    calls.push({ method, url, json: opts.json });
    const key = Object.keys(routes).find((k) => { const [m, frag] = k.split(" "); return m === method && url.includes(frag); });
    return key ? { ok: true, status: 200, body: null, ...routes[key] } : { ok: false, status: 404, body: { message: "not found" } };
  };
  return { http, calls };
};
const acct = { token: "t", teamId: "", accountId: "acc1" };
const link = { remoteId: "site1", meta: { projectId: "p1", serviceId: "s1", environmentId: "e1" }, branch: "main" };

describe("Vercel variables, deploys, logs and branch", () =>
{
    test("reads variables and hides sensitive values, once per name", async () =>
    {
        const { http } = fakeHttp({ "GET /v10/projects/site1/env": { body: { envs: [{ key: "A", value: "1", type: "plain" }, { key: "A", value: "1", type: "plain" }, { key: "S", value: "x", type: "sensitive" }] } } });
        const r = await PROVIDERS.vercel.envRead("t", acct, link, http);
        expect(r.ok).toBe(true);
        expect(r.vars.map((v) => v.key).join(",")).toBe("A,S");
        expect(r.vars[1].value).toBe(null);
    });

    test("writes a variable with upsert and sends it to production and preview", async () =>
    {
        const { http, calls } = fakeHttp({ "POST /v10/projects/site1/env": { ok: true } });
        const r = await PROVIDERS.vercel.envWrite("t", { ...acct, teamId: "team9" }, link, "KEY", "v", http);
        expect(r.ok).toBe(true);
        expect(calls[0].url).toContain("teamId=team9");
        expect(calls[0].json.target.join(",")).toBe("production,preview");
    });

    test("lists deploys with status and commit", async () =>
    {
        const { http } = fakeHttp({ "GET /v6/deployments": { body: { deployments: [{ uid: "d1", readyState: "READY", created: 1700000000000, meta: { githubCommitMessage: "fix login\nmore", githubCommitRef: "dev", githubCommitSha: "abcdef123" } }] } } });
        const r = await PROVIDERS.vercel.deploys("t", acct, link, http);
        expect(r.deploys[0].id).toBe("d1");
        expect(r.deploys[0].status).toBe("live");
        expect(r.deploys[0].commit).toBe("fix login");
    });

    test("changes the production branch", async () =>
    {
        const { http, calls } = fakeHttp({ "PATCH /v9/projects/site1": { ok: true } });
        const r = await PROVIDERS.vercel.setBranch("t", acct, link, "dev", http);
        expect(r.ok).toBe(true);
        expect(calls[0].json.productionBranch).toBe("dev");
    });
});

describe("Netlify", () =>
{
    test("finds the account slug first, then reads variables and hides secrets", async () =>
    {
        const { http, calls } = fakeHttp({
            "GET /api/v1/sites/site1": { body: { account_slug: "acme" } },
            "GET /api/v1/accounts/acme/env": { body: [{ key: "A", values: [{ context: "all", value: "1" }] }, { key: "B", is_secret: true, values: [{ context: "all", value: "2" }] }] }
        });
        const r = await PROVIDERS.netlify.envRead("t", acct, link, http);
        expect(r.ok).toBe(true);
        expect(r.vars[0].value).toBe("1");
        expect(r.vars[1].value).toBe(null);
        expect(calls[1].url).toContain("site_id=site1");
    });

    test("says plainly that build logs are not available", async () =>
    {
        const r = await PROVIDERS.netlify.logs("t", acct, link, "d1", fakeHttp({}).http);
        expect(r.ok).toBe(false);
        expect(r.error).toContain("does not publish build logs");
        expect(PROVIDERS.netlify.logsSupported).toBe(false);
    });
});

describe("Railway", () =>
{
    test("reads the service variables through GraphQL", async () =>
    {
        const { http, calls } = fakeHttp({ "POST https://backboard": { body: { data: { variables: { PORT: "8080", EMPTY: "" } } } } });
        const r = await PROVIDERS.railway.envRead("t", acct, link, (u, o) => http("https://backboard.railway.com/graphql", o));
        expect(r.ok).toBe(true);
        expect(r.vars.map((v) => v.key).join(",")).toBe("PORT,EMPTY");
        expect(calls[0].json.variables.p).toBe("p1");
    });

    test("changes the branch of the service instance", async () =>
    {
        const { http, calls } = fakeHttp({ "POST https://backboard": { body: { data: { serviceInstanceUpdate: true } } } });
        const r = await PROVIDERS.railway.setBranch("t", acct, link, "dev", (u, o) => http("https://backboard.railway.com/graphql", o));
        expect(r.ok).toBe(true);
        expect(calls[0].json.variables.i.branch).toBe("dev");
    });
});

describe("Cloudflare Pages", () =>
{
    const cfProject = (envVars) => ({ "GET /pages/projects/site1": { body: { result: { deployment_configs: { production: { env_vars: envVars } } } } } });

    test("adds a variable and keeps the existing plain ones", async () =>
    {
        const { http, calls } = fakeHttp({ ...cfProject({ OLD: { type: "plain_text", value: "o" } }), "PATCH /pages/projects/site1": { ok: true, body: {} } });
        const r = await PROVIDERS.cloudflare.envWrite("t", { accountId: "acc" }, link, "NEW", "n", http);
        expect(r.ok).toBe(true);
        const sent = calls.find((c) => c.method === "PATCH").json.deployment_configs.production.env_vars;
        expect(sent.OLD.value).toBe("o");
        expect(sent.NEW.value).toBe("n");
    });

    test("refuses to rewrite a project that has secret variables", async () =>
    {
        const { http, calls } = fakeHttp(cfProject({ TOKEN: { type: "secret_text" } }));
        const r = await PROVIDERS.cloudflare.envWrite("t", { accountId: "acc" }, link, "NEW", "n", http);
        expect(r.ok).toBe(false);
        expect(r.error).toContain("secret variables");
        expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    });

    test("hides secret values when reading", async () =>
    {
        const { http } = fakeHttp(cfProject({ TOKEN: { type: "secret_text" }, PLAIN: { type: "plain_text", value: "v" } }));
        const r = await PROVIDERS.cloudflare.envRead("t", { accountId: "acc" }, link, http);
        expect(r.vars[0].value).toBe(null);
        expect(r.vars[1].value).toBe("v");
    });
});
