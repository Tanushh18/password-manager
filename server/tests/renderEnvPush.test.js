const { describe, test, beforeEach } = require("node:test");
const expect = require("./expect");
const Module = require("node:module");

const ID = (n) => String(n).padStart(24, "0");
const saves = [];
let calls = [];
let remote = [];
let putFails = new Set();
const hash = require("../utils/envHash").hashValue;

const UserStub = {
  publicEntry: (entry) => ({ ...(entry.data?.sealed ?? entry.fields), _id: entry._id }),
  sealEntry: (key, fields) => ({ sealed: JSON.parse(JSON.stringify(fields)) }),
  updateOne: async (filter, update) => { saves.push({ filter, update }); }
};
const originalLoad = Module._load;
Module._load = function (request)
{
  if (request === "mongoose") return { isValidObjectId: (v) => /^[a-f0-9]{24}$/.test(String(v)) };
  if (request.endsWith("/models/schema")) return UserStub;
  if (request === "./renderOps") return { renderRequest: async (key, path, options = {}) =>
  {
    calls.push({ key, path, ...options });
    if (options.method === "PUT") { const name = decodeURIComponent(path.split("/").pop()); if (putFails.has(name)) throw new Error("Render refused " + name); return {}; }
    if (options.method === "POST") return {};
    return remote.map((v) => ({ envVar: v, cursor: "c" + v.key }));
  } };
  return originalLoad.apply(this, arguments);
};
const { pushProjectEnv } = require("../utils/renderEnvPush");
Module._load = originalLoad;

const row = (name, value, renderHash) => ({ name, value, purpose: "", source: "render", renderHash });
const project = (envVars, over = {}) => ({ _id: ID(1), enc: "udk", fields: { name: "P", renderAccountId: ID(9), renderServiceId: "srv-1", envVars, ...over } });
const user = (p) => ({ _id: "u1", projects: [p], renderAccounts: [{ _id: ID(9), enc: "udk", fields: { apiKey: "rnd_key" } }], getDataKey: async () => "key" });
const puts = () => calls.filter((c) => c.method === "PUT").map((c) => decodeURIComponent(c.path.split("/").pop()));

beforeEach(() => { saves.length = 0; calls = []; putFails = new Set(); remote = [{ key: "KEEP", value: "k" }, { key: "EDITED", value: "old" }, { key: "CONFLICT", value: "theirs" }, { key: "RENDER_ONLY", value: "r" }]; });

describe("pushProjectEnv", () =>
{
  const vars = () => [row("NEW", "n"), row("EDITED", "mine", hash("old")), row("CONFLICT", "mine", hash("old")), row("KEEP", "k", hash("k"))];

  test("preview lists categories by name only and writes nothing", async () =>
  {
    const result = await pushProjectEnv(user(project(vars())), ID(1), { apply: false });
    expect(result.create.join()).toBe("NEW");
    expect(result.update.join()).toBe("EDITED");
    expect(result.conflicts.join()).toBe("CONFLICT");
    expect(result.onlyInRender.join()).toBe("RENDER_ONLY");
    expect(puts()).toHaveLength(0);
    expect(saves).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain('"mine"');
  });

  test("apply pushes only the approved names and leaves conflicts and Render-only variables alone", async () =>
  {
    const result = await pushProjectEnv(user(project(vars())), ID(1), { apply: true, names: ["NEW", "EDITED", "CONFLICT"] });
    expect(puts().sort().join()).toBe("EDITED,NEW");
    expect(result.pushed.sort().join()).toBe("EDITED,NEW");
    expect(result.skippedConflicts.join()).toBe("CONFLICT");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(calls.find((c) => c.method === "PUT" && c.path.endsWith("/NEW")).body).toEqual({ value: "n" });
  });

  test("a conflict is overwritten only when it is both approved and explicitly forced", async () =>
  {
    await pushProjectEnv(user(project(vars())), ID(1), { apply: true, names: ["CONFLICT"], overwrite: [] });
    expect(puts()).toHaveLength(0);
    await pushProjectEnv(user(project(vars())), ID(1), { apply: true, names: ["CONFLICT"], overwrite: ["CONFLICT"] });
    expect(puts().join()).toBe("CONFLICT");
  });

  test("saves fingerprints for what was pushed, not values twice, and stamps the sync time", async () =>
  {
    await pushProjectEnv(user(project(vars())), ID(1), { apply: true, names: ["NEW", "EDITED"] });
    const saved = saves[0].update.$set["projects.$.data"].sealed;
    expect(saved.envVars.find((r) => r.name === "NEW").renderHash).toBe(hash("n"));
    expect(saved.envVars.find((r) => r.name === "EDITED").renderHash).toBe(hash("mine"));
    expect(saved.envVars.find((r) => r.name === "CONFLICT").renderHash).toBe(hash("old"));
    expect(typeof saved.renderSyncedAt).toBe("string");
    expect(saved._id).toBeUndefined();
  });

  test("a variable Render refuses is reported and not marked as pushed", async () =>
  {
    putFails = new Set(["EDITED"]);
    const result = await pushProjectEnv(user(project(vars())), ID(1), { apply: true, names: ["NEW", "EDITED"] });
    expect(result.pushed.join()).toBe("NEW");
    expect(result.failed[0].name).toBe("EDITED");
    const saved = saves[0].update.$set["projects.$.data"].sealed;
    expect(saved.envVars.find((r) => r.name === "EDITED").renderHash).toBe(hash("old"));
  });

  test("deploy runs only after something was actually pushed", async () =>
  {
    const none = await pushProjectEnv(user(project(vars())), ID(1), { apply: true, names: [], deploy: true });
    expect(none.deployed).toBe(false);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    const some = await pushProjectEnv(user(project(vars())), ID(1), { apply: true, names: ["NEW"], deploy: true });
    expect(some.deployed).toBe(true);
    expect(calls.find((c) => c.method === "POST").path).toContain("/services/srv-1/deploys");
  });

  test("rejects unlinked or missing projects and disconnected accounts, writing nothing", async () =>
  {
    const bad = async (u, id) => { try { await pushProjectEnv(u, id, { apply: true, names: ["NEW"] }); return null; } catch (e) { return e.status; } };
    expect(await bad(user(project(vars(), { renderServiceId: "" })), ID(1))).toBe(400);
    expect(await bad(user(project(vars())), ID(7))).toBe(404);
    expect(await bad({ ...user(project(vars())), renderAccounts: [] }, ID(1))).toBe(404);
    expect(await bad(user(project(vars(), { renderServiceId: "../x" })), ID(1))).toBe(400);
    expect(puts()).toHaveLength(0);
  });

  test("refuses to act on a partial Render listing", async () =>
  {
    let page = 0;
    const big = () => Array.from({ length: 100 }, (_, i) => ({ key: "K" + page + "_" + i, value: "v" }));
    const originalRemote = remote;
    remote = { map: (fn) => { page += 1; return big().map(fn); } };
    let status = null;
    try { await pushProjectEnv(user(project(vars())), ID(1), { apply: true, names: ["NEW"] }); } catch (e) { status = e.status; }
    remote = originalRemote;
    expect(status).toBe(422);
    expect(puts()).toHaveLength(0);
  });
});
