const { describe, test, beforeEach } = require("node:test");
const expect = require("./expect");
const Module = require("node:module");

const ID = (n) => String(n).padStart(24, "0");
let writes, envSyncs, ensureCalls, repoResults, renderData, user;

const UserStub = {
  publicEntry: (entry) => ({ ...(entry.data?.sealed ?? entry.fields), _id: entry._id }),
  sealEntry: (key, fields) => ({ sealed: JSON.parse(JSON.stringify(fields)) }),
  updateOne: async (filter, update) => { writes.push({ filter, update }); },
  findById: async () => user
};
const stubs = {
  "/models/schema": UserStub,
  "./projectStatus": { loadRenderServices: async () => renderData, ensureLinks: async (...args) => { ensureCalls.push(args); return { linkedNow: [], refreshed: 0 }; } },
  "./githubClient": { loadGithubAccounts: () => [{ id: "t1", token: "tok1" }, { id: "t2", token: "tok2" }] },
  "./githubRepos": { listRepos: async (token) => repoResults[token] },
  "./renderEnvSync": { syncProjectEnv: async (u, id) => { envSyncs.push(id); } }
};
const originalLoad = Module._load;
Module._load = function (request, parent) {
  for (const [name, stub] of Object.entries(stubs)) if (request.endsWith(name) || request === name) return stub;
  return originalLoad.apply(this, arguments);
};
const { autoSyncProjects } = require("../utils/projectAutoSync");
Module._load = originalLoad;

const repo = (name, o = {}) => ({ key: "tanushh18/" + name.toLowerCase(), owner: "Tanushh18", name, url: "https://github.com/Tanushh18/" + name, description: "", language: "", archived: false, ...o });
const entry = (n, fields) => ({ _id: ID(n), enc: "udk", data: { sealed: fields } });
const makeUser = (n, projects) => ({ _id: ID(n), projects, renderAccounts: [{ _id: "acc1" }], getDataKey: async () => "k" });
const pushed = () => writes.filter((w) => w.update.$push?.projects).flatMap((w) => w.update.$push.projects.$each);
const patched = () => writes.filter((w) => w.update.$set).map((w) => ({ id: String(w.filter["projects._id"]), data: w.update.$set["projects.$.data"].sealed }));

beforeEach(() => {
  writes = []; envSyncs = []; ensureCalls = [];
  repoResults = { tok1: { ok: true, repos: [repo("StreamHub"), repo("Deal_Radar")] }, tok2: { ok: true, repos: [repo("Tasks")] } };
  renderData = { services: [], accounts: new Map(), listed: new Set() };
});

describe("automatic project sync", () => {
  test("creates a project for every repo of every token, skips ones you already have, never touches yours", async () => {
    user = makeUser(1, [entry(1, { name: "Deal-Radar", repoUrl: "https://github.com/Tanushh18/Deal_Radar" })]);
    const summary = await autoSyncProjects(user, { force: true });
    expect(summary.created).toEqual(["StreamHub", "Tasks"]);
    const docs = pushed();
    expect(docs.length).toBe(2);
    expect(docs[0].data.sealed.autoSource).toBe("github");
    expect(docs[0].data.sealed.repoUrl).toBe("https://github.com/Tanushh18/StreamHub");
    expect(patched().length).toBe(0);
    expect(summary.github.repos).toBe(3);
  });

  test("a second call within the throttle window does nothing new; force syncs again without duplicating", async () => {
    user = makeUser(2, []);
    const first = await autoSyncProjects(user, { force: true });
    expect(first.created.length).toBe(3);
    const again = await autoSyncProjects(user);
    expect(again.throttled).toBe(true);
    expect(pushed().length).toBe(3);
    // the created projects are now part of the user's list, so a forced sync adds nothing
    pushed().forEach((d) => user.projects.push(d));
    writes = [];
    const forced = await autoSyncProjects(user, { force: true });
    expect(forced.created.length).toBe(0);
    expect(pushed().length).toBe(0);
  });

  test("a project Stashr created is archived when its repo is gone, but only if every GitHub read worked", async () => {
    const mine = entry(3, { name: "Old", repoUrl: "https://github.com/Tanushh18/Old", autoSource: "github", status: "in_progress" });
    const handMade = entry(4, { name: "Old2", repoUrl: "https://github.com/Tanushh18/Old2", status: "in_progress" });
    user = makeUser(3, [mine, handMade]);
    repoResults.tok2 = { ok: false, status: 401 };
    let summary = await autoSyncProjects(user, { force: true });
    expect(summary.archived).toBe(0);
    expect(summary.github.failed).toBe(1);
    repoResults.tok2 = { ok: true, repos: [repo("Tasks")] };
    summary = await autoSyncProjects(user, { force: true });
    expect(summary.archived).toBe(1);
    const archivedPatch = patched().find((p) => p.id === ID(3));
    expect(archivedPatch.data.status).toBe("archived");
    expect(archivedPatch.data.autoStale).toBe("yes");
    expect(patched().some((p) => p.id === ID(4))).toBe(false);
  });

  test("a new Render-linked project pulls its env vars and links follow Render", async () => {
    user = makeUser(4, []);
    repoResults = { tok1: { ok: true, repos: [repo("StreamHub")] }, tok2: { ok: true, repos: [] } };
    renderData = {
      services: [{ id: "srv-1", name: "streamhub", repo: "https://github.com/Tanushh18/StreamHub", suspended: false, accountId: "acc1" }],
      accounts: new Map([["acc1", { id: "acc1", name: "Main" }]]), listed: new Set(["acc1"])
    };
    const summary = await autoSyncProjects(user, { force: true });
    expect(summary.created).toEqual(["StreamHub"]);
    expect(pushed()[0].data.sealed.renderServiceId).toBe("srv-1");
    expect(pushed()[0].data.sealed.status).toBe("deployed");
    expect(envSyncs.length).toBe(1);
    expect(ensureCalls.length).toBe(1);
  });
});
