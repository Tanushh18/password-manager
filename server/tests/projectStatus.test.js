const { describe, test, beforeEach } = require("node:test");
const expect = require("./expect");
const Module = require("node:module");

const ID = (n) => String(n).padStart(24, "0");
const saves = [];
let envSyncCalls = [];
let renderCalls = [];
let githubCalls = [];
let users = [];
let renderImpl, githubImpl, githubAccounts, incidents, resolveImpl;

const UserStub = {
  publicEntry: (entry) => ({ ...(entry.data?.sealed ?? entry.fields), _id: entry._id }),
  sealEntry: (key, fields) => ({ sealed: JSON.parse(JSON.stringify(fields)) }),
  updateOne: async (filter, update) => { saves.push({ filter, update }); },
  find: () => ({ limit: async () => users })
};
const stubs = {
  schema: UserStub,
  renderOps: { renderRequest: async (key, path) => { renderCalls.push(path); return renderImpl(key, path); }, encryptedList: () => incidents },
  githubClient: {
    githubGet: async (token, path) => { githubCalls.push(path); return githubImpl(token, path); },
    loadGithubAccounts: () => githubAccounts,
    resolveRepo: async (accounts, target) => resolveImpl(accounts, target)
  },
  envSync: { syncProjectEnv: async (user, id, opts) => { envSyncCalls.push({ id, opts }); return { added: [], updated: [] }; } }
};
const originalLoad = Module._load;
Module._load = function (request, parent)
{
  if (request.endsWith("/models/schema")) return stubs.schema;
  if (request === "./renderOps") return stubs.renderOps;
  if (request === "./githubClient") return stubs.githubClient;
  if (request === "./renderEnvSync") return stubs.envSync;
  return originalLoad.apply(this, arguments);
};
const { getProjectStatuses, runAllAutoLink } = require("../utils/projectStatus");
Module._load = originalLoad;

const REPO = "https://github.com/Tanushh18/Deal_Radar";
const renderService = (id, name, over = {}) => ({ service: { id, name, repo: REPO, branch: "main", suspended: "not_suspended", dashboardUrl: "https://dashboard.render.com/web/" + id, serviceDetails: { url: "https://" + name + ".onrender.com", region: "singapore", plan: "free" }, ...over }, cursor: "c" + id });
const project = (n, fields) => ({ _id: ID(n), enc: "udk", fields: { name: "P" + n, ...fields } });
let userSeq = 0;
const makeUser = (projects) => ({ _id: "u" + (++userSeq), projects, renderAccounts: [{ _id: ID(9), enc: "udk", fields: { apiKey: "rnd_k", name: "Prod" } }], getDataKey: async () => "key" });
const fieldsOf = (entry) => UserStub.publicEntry(entry);

beforeEach(() =>
{
  saves.length = 0; envSyncCalls = []; renderCalls = []; githubCalls = []; users = []; incidents = []; githubAccounts = [];
  renderImpl = async (key, path) =>
  {
    if (path.startsWith("/v1/services?")) return [renderService("srv-1", "dealradar-api")];
    if (path.includes("/deploys")) return [{ deploy: { id: "d1", status: "live", createdAt: "2026-01-02T00:00:00Z", commit: { id: "aaaaaaa1111", message: "Ship it\nbody" } } }];
    return [];
  };
  githubImpl = async () => ({ ok: true, status: 200, body: {} });
  resolveImpl = async () => ({ repo: { full_name: "Tanushh18/Deal_Radar", html_url: REPO, default_branch: "main" }, used: { token: "t" }, base: "/repos/Tanushh18/Deal_Radar" });
});

describe("automatic project linking", () =>
{
  test("links an unambiguous project, fills only empty fields, turns on auto-sync and pulls env vars", async () =>
  {
    const entry = project(1, { repoUrl: REPO, hostingRegion: "mumbai" });
    const user = makeUser([entry]);
    const result = await getProjectStatuses(user, { refresh: true });
    expect(result.linkedNow).toHaveLength(1);
    expect(saves).toHaveLength(1);
    const saved = fieldsOf(entry);
    expect(saved.renderServiceId).toBe("srv-1");
    expect(saved.renderAccountId).toBe(ID(9));
    expect(saved.renderAutoSync).toBe("on");
    expect(saved.renderAutoLinked).toBe("yes");
    expect(saved.hostingRegion).toBe("mumbai");
    expect(saved.hostingPlan).toBe("free");
    expect(envSyncCalls).toHaveLength(1);
    expect(envSyncCalls[0].opts.resolveConflicts).toBe(false);
    expect(result.statuses[0].linked).toBe(true);
    expect(result.statuses[0].autoLinked).toBe(true);
  });

  test("never links when the repo matches several services, and says so", async () =>
  {
    renderImpl = async (key, path) => (path.startsWith("/v1/services?") ? [renderService("srv-1", "a"), renderService("srv-2", "b")] : []);
    const user = makeUser([project(1, { repoUrl: REPO })]);
    const result = await getProjectStatuses(user, { refresh: true });
    expect(saves).toHaveLength(0);
    expect(result.statuses[0].linked).toBe(false);
    expect(result.statuses[0].ambiguous).toBe(2);
  });

  test("respects a manual unlink and leaves already-linked projects alone", async () =>
  {
    const optedOut = project(1, { repoUrl: REPO, renderAutoLinked: "off" });
    const linked = project(2, { repoUrl: REPO, renderAccountId: ID(9), renderServiceId: "srv-1" });
    await getProjectStatuses(makeUser([optedOut, linked]), { refresh: true });
    expect(saves).toHaveLength(0);
    expect(envSyncCalls).toHaveLength(0);
  });

  test("a project with no Render accounts connected makes no Render calls", async () =>
  {
    const user = { ...makeUser([project(1, { repoUrl: REPO })]), renderAccounts: [] };
    const result = await getProjectStatuses(user, { refresh: true });
    expect(renderCalls).toHaveLength(0);
    expect(result.statuses).toHaveLength(1);
    expect(result.statuses[0].health.level).toBe("unknown");
  });
});

describe("project status and health", () =>
{
  const linkedProject = () => project(1, { repoUrl: REPO, renderAccountId: ID(9), renderServiceId: "srv-1", renderAutoSync: "on", renderSyncedAt: new Date().toISOString() });

  test("combines deploy, CI and drift into a red score with reasons", async () =>
  {
    renderImpl = async (key, path) =>
    {
      if (path.startsWith("/v1/services?")) return [renderService("srv-1", "dealradar-api")];
      return [
        { deploy: { id: "d2", status: "build_failed", createdAt: "2026-01-03T00:00:00Z", commit: { id: "bbbbbbb2222", message: "Broken" } } },
        { deploy: { id: "d1", status: "live", createdAt: "2026-01-02T00:00:00Z", commit: { id: "aaaaaaa1111", message: "Ship it" } } }
      ];
    };
    githubAccounts = [{ token: "t" }];
    githubImpl = async (token, path) =>
    {
      if (path.includes("/actions/runs")) return { ok: true, status: 200, body: { workflow_runs: [{ name: "CI", status: "completed", conclusion: "failure", head_branch: "main" }] } };
      if (path.includes("/compare/")) return { ok: true, status: 200, body: { status: "ahead", ahead_by: 3, commits: [] } };
      return { ok: false, status: 404, body: null };
    };
    const result = await getProjectStatuses(makeUser([linkedProject()]), { refresh: true });
    const s = result.statuses[0];
    expect(s.health.level).toBe("red");
    expect(s.deploy.status).toBe("build_failed");
    expect(s.live.sha).toBe("aaaaaaa");
    expect(s.drift.behindBy).toBe(3);
    expect(s.ci.state).toBe("failing");
    const text = s.health.reasons.map((r) => r.text).join("|");
    expect(text).toContain("Latest deployment failed");
    expect(text).toContain("3 commits not deployed yet");
    expect(githubCalls.some((p) => p.includes("/compare/aaaaaaa1111...main"))).toBe(true);
    expect(JSON.stringify(s)).not.toContain("rnd_k");
  });

  test("healthy project is green; open monitoring incidents count against it", async () =>
  {
    githubAccounts = [{ token: "t" }];
    githubImpl = async (token, path) => (path.includes("/actions/runs")
      ? { ok: true, status: 200, body: { workflow_runs: [{ name: "CI", status: "completed", conclusion: "success", head_branch: "main" }] } }
      : { ok: true, status: 200, body: { status: "identical", ahead_by: 0, commits: [] } });
    const green = await getProjectStatuses(makeUser([linkedProject()]), { refresh: true });
    expect(green.statuses[0].health.level).toBe("green");
    incidents = [{ groupId: "g", serviceKey: ID(9) + ":srv-1", type: "memory", state: "open", at: "2026-01-01T00:00:00Z" }];
    const amber = await getProjectStatuses(makeUser([linkedProject()]), { refresh: true });
    expect(amber.statuses[0].health.reasons.map((r) => r.text).join("|")).toContain("open monitoring incident");
    expect(amber.statuses[0].health.score).toBe(85);
  });

  test("without a GitHub token Render signals still produce a score", async () =>
  {
    const result = await getProjectStatuses(makeUser([linkedProject()]), { refresh: true });
    const s = result.statuses[0];
    expect(s.github.connected).toBe(false);
    expect(s.health.level).toBe("green");
    expect(githubCalls).toHaveLength(0);
  });

  test("a GitHub failure is reported as partial, not as a failing project", async () =>
  {
    githubAccounts = [{ token: "t" }];
    resolveImpl = async () => ({ error: { status: 404, message: "Repository not found, or the token has no access to it." } });
    const s = (await getProjectStatuses(makeUser([linkedProject()]), { refresh: true })).statuses[0];
    expect(s.github.error).toMatch(/not found/);
    expect(s.partial.includes("GitHub")).toBe(true);
    expect(s.health.level).toBe("green");
  });

  test("results are cached briefly and refresh bypasses the cache", async () =>
  {
    const user = makeUser([linkedProject()]);
    await getProjectStatuses(user, { refresh: true });
    const first = renderCalls.length;
    await getProjectStatuses(user);
    expect(renderCalls.length).toBe(first);
    await getProjectStatuses(user, { refresh: true });
    expect(renderCalls.length > first).toBe(true);
  });

  test("can compute a single project", async () =>
  {
    const a = linkedProject();
    const b = { ...project(2, { name: "Other" }), _id: ID(2) };
    const result = await getProjectStatuses(makeUser([a, b]), { only: ID(2), refresh: true });
    expect(result.statuses).toHaveLength(1);
    expect(result.statuses[0].projectId).toBe(ID(2));
  });
});

describe("background auto-link pass", () =>
{
  test("links only users that have something to link, isolating failures", async () =>
  {
    const needs = makeUser([project(1, { repoUrl: REPO })]);
    const done = makeUser([project(2, { repoUrl: REPO, renderAccountId: ID(9), renderServiceId: "srv-1" })]);
    const broken = { ...makeUser([project(3, { repoUrl: REPO })]), getDataKey: async () => { throw new Error("no key"); } };
    users = [needs, done, broken];
    const summary = await runAllAutoLink();
    expect(summary.projectsLinked).toBe(1);
    expect(summary.usersChecked).toBe(1);
    expect(summary.errors).toBe(1);
    expect(saves).toHaveLength(1);
  });
});
