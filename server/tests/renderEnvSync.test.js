const { describe, test, beforeEach } = require("node:test");
const expect = require("./expect");
const Module = require("node:module");

/* The sync orchestration is tested against stubs for Mongoose, the User model and the Render client. */
const ID = (n) => String(n).padStart(24, "0");
const saves = [];
let users = [];
let renderCalls = [];
let renderImpl = async () => [];

const UserStub = {
  publicEntry: (entry) => ({ ...entry.fields, _id: entry._id }),
  sealEntry: (key, fields) => ({ sealed: JSON.parse(JSON.stringify(fields)) }),
  updateOne: async (filter, update) => { saves.push({ filter, update }); },
  find: () => ({ limit: async () => users })
};
const stubs = {
  mongoose: { isValidObjectId: (v) => /^[a-f0-9]{24}$/.test(String(v)) },
  schema: UserStub,
  renderOps: { renderRequest: async (key, path) => { renderCalls.push({ key, path }); return renderImpl(key, path); } }
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain)
{
  if (request === "mongoose") return stubs.mongoose;
  if (request.endsWith("/models/schema")) return stubs.schema;
  if (request === "./renderOps" && parent && /renderEnvSync\.js$/.test(parent.filename)) return stubs.renderOps;
  return originalLoad.apply(this, arguments);
};
const { syncProjectEnv, runAllEnvSync } = require("../utils/renderEnvSync");
Module._load = originalLoad;

const project = (over = {}) => ({ _id: ID(1), enc: "udk", fields: { name: "P", renderAccountId: ID(9), renderServiceId: "srv-1", envVars: [], ...over } });
const account = { _id: ID(9), enc: "udk", fields: { apiKey: "rnd_key", name: "Prod" } };
const user = (projects, accounts = [account]) => ({ _id: "u1", projects, renderAccounts: accounts, getDataKey: async () => "key" });
const envList = (pairs) => pairs.map(([key, value]) => ({ envVar: { key, value }, cursor: "c" + key }));

beforeEach(() => { saves.length = 0; renderCalls = []; users = []; renderImpl = async () => envList([["A", "1"], ["B", "2"]]); });

describe("syncProjectEnv", () =>
{
    test("preview reports names only and saves nothing", async () =>
    {
        const result = await syncProjectEnv(user([project()]), ID(1), { apply: false });
        expect(result.added.join(",")).toBe("A,B");
        expect(result.applied).toBe(false);
        expect(saves).toHaveLength(0);
        expect(JSON.stringify(result)).not.toContain('"1"');
        expect(renderCalls[0].path).toContain("/v1/services/srv-1/env-vars");
        expect(renderCalls[0].key).toBe("rnd_key");
    });

    test("apply saves merged variables and the sync time, without internal fields", async () =>
    {
        const result = await syncProjectEnv(user([project({ envVars: [{ name: "LOCAL", value: "x", purpose: "" }] })]), ID(1), { apply: true });
        expect(result.applied).toBe(true);
        expect(saves).toHaveLength(1);
        const saved = saves[0].update.$set["projects.$.data"].sealed;
        expect(saved.envVars.map((v) => v.name).join(",")).toBe("LOCAL,A,B");
        expect(saved.envVars[1].source).toBe("render");
        expect(typeof saved.renderSyncedAt).toBe("string");
        expect(saved._id).toBeUndefined();
        expect(saved.name).toBe("P");
        expect(JSON.stringify(result)).not.toContain('"2"');
    });

    test("a manual value is a conflict unless explicitly resolved", async () =>
    {
        const p = project({ envVars: [{ name: "A", value: "mine" }] });
        const skipped = await syncProjectEnv(user([p]), ID(1), { apply: true });
        expect(skipped.conflicts.join(",")).toBe("A");
        expect(saves[0].update.$set["projects.$.data"].sealed.envVars[0].value).toBe("mine");
        saves.length = 0;
        const resolved = await syncProjectEnv(user([p]), ID(1), { apply: true, resolveConflicts: true });
        expect(resolved.updated.join(",")).toBe("A");
        expect(saves[0].update.$set["projects.$.data"].sealed.envVars[0].value).toBe("1");
    });

    test("rejects unlinked projects, missing projects and disconnected accounts", async () =>
    {
        const bad = async (u, id) => { try { await syncProjectEnv(u, id, { apply: true }); return null; } catch (e) { return e.status; } };
        expect(await bad(user([project({ renderServiceId: "" })]), ID(1))).toBe(400);
        expect(await bad(user([project()]), ID(7))).toBe(404);
        expect(await bad(user([project()]), "not-an-id")).toBe(404);
        expect(await bad(user([project()], []), ID(1))).toBe(404);
        expect(await bad(user([project({ renderServiceId: "../x" })]), ID(1))).toBe(400);
        expect(saves).toHaveLength(0);
    });

    test("refuses to act on a partial listing", async () =>
    {
        let page = 0;
        renderImpl = async () => { page += 1; return Array.from({ length: 100 }, (_, i) => ({ envVar: { key: "K" + page + "_" + i, value: "v" }, cursor: "p" + page + "_" + i })); };
        let status = null;
        try { await syncProjectEnv(user([project()]), ID(1), { apply: true }); } catch (e) { status = e.status; }
        expect(status).toBe(422);
        expect(saves).toHaveLength(0);
    });

    test("a deleted Render service maps to a clear 404 and saves nothing", async () =>
    {
        renderImpl = async () => { throw Object.assign(new Error("nope"), { status: 404 }); };
        let status = null;
        try { await syncProjectEnv(user([project()]), ID(1), { apply: true }); } catch (e) { status = e.status; }
        expect(status).toBe(404);
        expect(saves).toHaveLength(0);
    });
});

describe("runAllEnvSync (background pass)", () =>
{
    const old = new Date(Date.now() - 3600 * 1000).toISOString();
    test("only syncs linked projects with auto-sync on that are due", async () =>
    {
        users = [user([
            project({ renderAutoSync: "on", renderSyncedAt: old }),
            { ...project({ renderAutoSync: "" }), _id: ID(2) },
            { ...project({ renderAutoSync: "on", renderSyncedAt: new Date().toISOString() }), _id: ID(3) },
            { ...project({ renderAutoSync: "on", renderAccountId: "" }), _id: ID(4) }
        ])];
        const summary = await runAllEnvSync();
        expect(summary.projectsSynced).toBe(1);
        expect(summary.varsAdded).toBe(2);
        expect(summary.errors).toBe(0);
        expect(saves).toHaveLength(1);
    });

    test("never overwrites a hand-typed value and survives per-project failures", async () =>
    {
        users = [user([
            project({ renderAutoSync: "on", envVars: [{ name: "A", value: "mine" }] }),
            { ...project({ renderAutoSync: "on", renderServiceId: "srv-bad" }), _id: ID(2) }
        ])];
        renderImpl = async (key, path) => { if (path.includes("srv-bad")) throw new Error("boom"); return envList([["A", "1"]]); };
        const summary = await runAllEnvSync();
        expect(summary.projectsSynced).toBe(1);
        expect(summary.errors).toBe(1);
        expect(saves[0].update.$set["projects.$.data"].sealed.envVars[0].value).toBe("mine");
    });
});
