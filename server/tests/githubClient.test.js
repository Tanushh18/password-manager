const { describe, test, beforeEach } = require("node:test");
const expect = require("./expect");
const Module = require("node:module");

const originalLoad = Module._load;
Module._load = function (request)
{
  if (request.endsWith("/models/schema")) return { publicEntry: () => ({}) };
  return originalLoad.apply(this, arguments);
};
const { probeScopes, githubSend } = require("../utils/githubClient");
Module._load = originalLoad;

let fetchCalls = [];
let respond;
const realFetch = global.fetch;
beforeEach(() =>
{
  fetchCalls = [];
  global.fetch = async (url, options = {}) => { fetchCalls.push({ url, options }); return respond(url, options); };
});
const reply = (status, headers = {}, body = {}) => ({ ok: status >= 200 && status < 300, status, headers: new Map(Object.entries(headers)), json: async () => body });
let n = 0;
const token = () => "ghp_" + String(++n).padStart(36, "x");

describe("GitHub token capabilities", () =>
{
  test("a classic token with repo + workflow is write-capable and not risky", async () =>
  {
    respond = () => reply(200, { "x-oauth-scopes": "repo, workflow" });
    const caps = await probeScopes(token());
    expect(caps.valid).toBe(true);
    expect(caps.write).toBe(true);
    expect(caps.workflow).toBe(true);
    expect(caps.risky).toHaveLength(0);
  });

  test("risky scopes such as delete_repo and admin:org are surfaced", async () =>
  {
    respond = () => reply(200, { "x-oauth-scopes": "repo, delete_repo, admin:org, gist" });
    const caps = await probeScopes(token());
    expect(caps.write).toBe(true);
    expect(caps.risky.join()).toBe("delete_repo,admin:org");
  });

  test("a token without the repo scope, or a fine-grained token (no header), is not treated as write-capable", async () =>
  {
    respond = () => reply(200, { "x-oauth-scopes": "read:user" });
    expect((await probeScopes(token())).write).toBe(false);
    respond = () => reply(200, {});
    const fine = await probeScopes(token());
    expect(fine.write).toBe(false);
    expect(fine.scopes).toBeNull();
  });

  test("an invalid token is reported invalid, and results are cached per token", async () =>
  {
    respond = () => reply(401);
    const t = token();
    expect((await probeScopes(t)).valid).toBe(false);
    const before = fetchCalls.length;
    await probeScopes(t);
    expect(fetchCalls.length).toBe(before);
  });

  test("a network failure is not cached as a verdict", async () =>
  {
    respond = () => { throw new Error("offline"); };
    const t = token();
    expect((await probeScopes(t)).valid).toBe(false);
    respond = () => reply(200, { "x-oauth-scopes": "repo" });
    expect((await probeScopes(t)).write).toBe(true);
  });
});

describe("GitHub write requests", () =>
{
  test("send JSON with the bearer token, only to api.github.com", async () =>
  {
    respond = () => reply(201, {}, { ok: 1 });
    await githubSend("ghp_secret", "POST", "/user/repos", { name: "x" });
    const call = fetchCalls[0];
    expect(call.url).toBe("https://api.github.com/user/repos");
    expect(call.options.method).toBe("POST");
    expect(call.options.headers.Authorization).toBe("Bearer ghp_secret");
    expect(call.options.body).toBe('{"name":"x"}');
  });
});
global.fetch = realFetch;
