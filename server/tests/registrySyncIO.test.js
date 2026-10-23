const { describe, test, beforeEach } = require("node:test");
const expect = require("./expect");
const Module = require("node:module");

let docs = [];
let updates = [];
let adminUsers = [];
let servicesFor = () => ({ services: [], accounts: new Map() });
let deploysImpl = async () => [{ deploy: { status: "live", createdAt: "2026-01-02T00:00:00Z" } }];

const chain = (value) => ({ lean: async () => value, limit: async () => value });
const RegistryStub = {
  find: () => chain(docs),
  findOne: ({ app }) => chain(docs.find((d) => d.app === app) || null),
  findOneAndUpdate: (filter, update) => { updates.push({ filter, update }); return chain({ app: filter.app, ...(update.$set || {}) }); }
};
const UserStub = { find: () => ({ limit: async () => adminUsers }) };
const stubs = {
  registry: RegistryStub, schema: UserStub,
  renderOps: { renderRequest: async (key, path) => deploysImpl(key, path) },
  projectStatus: { loadRenderServices: async (user) => servicesFor(user) }
};
const originalLoad = Module._load;
Module._load = function (request)
{
  if (request.endsWith("/models/registry")) return stubs.registry;
  if (request.endsWith("/models/schema")) return stubs.schema;
  if (request === "./renderOps") return stubs.renderOps;
  if (request === "./projectStatus") return stubs.projectStatus;
  return originalLoad.apply(this, arguments);
};
const { buildRegistrySync, setAutoSync, runAllRegistrySync } = require("../utils/registrySyncIO");
Module._load = originalLoad;

const REPO = "https://github.com/o/stashr";
const svc = (id, name, over = {}) => ({ id, name, repo: REPO, suspended: false, url: "https://" + name + ".onrender.com", accountId: "a1", accountName: "Prod", plan: "free", region: "singapore", dashboardUrl: "https://dashboard.render.com/web/" + id, ...over });
const admin = () => ({ _id: "admin", getDataKey: async () => "key" });
const accountsMap = new Map([["a1", { id: "a1", name: "Prod", apiKey: "k" }]]);

beforeEach(() =>
{
  docs = []; updates = []; adminUsers = [];
  servicesFor = () => ({ services: [], accounts: accountsMap });
  deploysImpl = async () => [{ deploy: { status: "live", createdAt: "2026-01-02T00:00:00Z" } }];
});

describe("Servers tab view", () =>
{
  test("matches each URL to its Render service and shows live state", async () =>
  {
    docs = [{ app: "stashr", urls: ["https://password-manager-server-xxdr.onrender.com", "https://password-manager-server-8gvj.onrender.com"] }];
    servicesFor = () => ({ services: [svc("s1", "password-manager-server-xxdr"), svc("s2", "password-manager-server-8gvj", { suspended: true }), svc("s3", "extra-node")], accounts: accountsMap });
    const { apps } = await buildRegistrySync(admin());
    const stashr = apps.find((a) => a.app === "stashr");
    expect(stashr.items.map((i) => i.service?.state).join(",")).toBe("active,suspended");
    expect(stashr.items[0].service.lastDeploy.status).toBe("live");
    expect(stashr.willRemove.join(",")).toContain("8gvj");
    expect(stashr.add.map((a) => a.name).join(",")).toBe("extra-node");
    expect(stashr.autoSync).toBe(true);
    expect(apps.find((a) => a.app === "dealradar").items[0].kind).toBe("external");
  });

  test("survives deploy lookups failing and an unconnected Render account", async () =>
  {
    servicesFor = () => ({ services: [svc("s1", "password-manager-server-xxdr")], accounts: accountsMap });
    deploysImpl = async () => { throw new Error("boom"); };
    const stashr = (await buildRegistrySync(admin())).apps.find((a) => a.app === "stashr");
    expect(stashr.items[0].service.lastDeploy).toBeNull();
    servicesFor = () => ({ services: [], accounts: new Map() });
    const none = (await buildRegistrySync(admin())).apps.find((a) => a.app === "stashr");
    expect(none.renderConnected).toBe(false);
    expect(none.items[0].kind).toBe("unmatched");
  });
});

describe("Servers tab background sync", () =>
{
  test("drops a suspended Render URL while another remains, with an audit log entry", async () =>
  {
    adminUsers = [admin()];
    docs = [{ app: "stashr", urls: ["https://password-manager-server-xxdr.onrender.com", "https://password-manager-server-8gvj.onrender.com"] }];
    servicesFor = () => ({ services: [svc("s1", "password-manager-server-xxdr"), svc("s2", "password-manager-server-8gvj", { suspended: true })], accounts: accountsMap });
    const summary = await runAllRegistrySync();
    expect(summary.urlsRemoved).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].update.$set.urls.join(",")).toBe("https://password-manager-server-xxdr.onrender.com");
    expect(updates[0].update.$set.updatedBy).toBe("render-sync");
    expect(updates[0].update.$push.syncLog.$each[0].url).toContain("8gvj");
  });

  test("never empties a list: all-suspended or single-URL lists are left alone", async () =>
  {
    adminUsers = [admin()];
    servicesFor = () => ({ services: [svc("s1", "password-manager-server-xxdr", { suspended: true }), svc("s2", "password-manager-server-8gvj", { suspended: true })], accounts: accountsMap });
    const summary = await runAllRegistrySync();
    expect(summary.urlsRemoved).toBe(0);
    expect(updates).toHaveLength(0);
  });

  test("does nothing when auto-sync is off, nothing is suspended, or no admin has Render connected", async () =>
  {
    adminUsers = [admin()];
    const suspended = [svc("s1", "password-manager-server-xxdr"), svc("s2", "password-manager-server-8gvj", { suspended: true })];
    servicesFor = () => ({ services: suspended, accounts: accountsMap });
    docs = [{ app: "stashr", urls: ["https://password-manager-server-xxdr.onrender.com", "https://password-manager-server-8gvj.onrender.com"], autoSync: false }];
    expect((await runAllRegistrySync()).urlsRemoved).toBe(0);
    docs = [];
    servicesFor = () => ({ services: suspended.map((s) => ({ ...s, suspended: false })), accounts: accountsMap });
    expect((await runAllRegistrySync()).urlsRemoved).toBe(0);
    adminUsers = [];
    expect((await runAllRegistrySync()).appsChecked).toBe(0);
    expect(updates).toHaveLength(0);
  });

  test("custom domains and unmatched URLs are never touched", async () =>
  {
    adminUsers = [admin()];
    docs = [{ app: "dealradar", urls: ["https://dealradar.ggnhome.com", "https://not-in-my-account.onrender.com"], autoSync: true }];
    servicesFor = () => ({ services: [svc("s1", "something-else")], accounts: accountsMap });
    await runAllRegistrySync();
    expect(updates.filter((u) => u.filter.app === "dealradar")).toHaveLength(0);
  });

  test("setAutoSync only accepts known apps", async () =>
  {
    expect(await setAutoSync("nope", true, "a@b.c")).toBeNull();
    const doc = await setAutoSync("stashr", false, "a@b.c");
    expect(doc.autoSync).toBe(false);
  });
});
