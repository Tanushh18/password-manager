const { describe, test, beforeEach } = require("node:test");
const expect = require("./expect");
const Module = require("node:module");
const { compareEnv } = require("../utils/envCompare");

describe("env comparison across servers", () => {
  const vars = (o) => Object.entries(o).map(([key, value]) => ({ key, value }));
  test("common, different and partial variables, with the same letter for the same value", () => {
    const r = compareEnv([
      { id: "s1", vars: vars({ MONGO_URI: "m1", PORT: "10000", ONLY_MAIN: "x", EMPTY: "" }) },
      { id: "s2", vars: vars({ MONGO_URI: "m2", PORT: "10000", EMPTY: "" }) },
      { id: "s3", vars: vars({ MONGO_URI: "m1", PORT: "10000" }) },
      { id: "gone", vars: null }
    ]);
    const by = Object.fromEntries(r.rows.map((x) => [x.name, x]));
    expect(by.PORT.status).toBe("common");
    expect(by.MONGO_URI.status).toBe("different");
    expect(by.MONGO_URI.cells.s1.variant).toBe("A");
    expect(by.MONGO_URI.cells.s2.variant).toBe("B");
    expect(by.MONGO_URI.cells.s3.variant).toBe("A");
    expect(by.ONLY_MAIN.status).toBe("partial");
    expect(by.ONLY_MAIN.cells.s2.state).toBe("missing");
    expect(by.EMPTY.cells.s1.state).toBe("empty");
    expect(by.PORT.cells.gone.state).toBe("unknown"); // unreadable servers never change the verdict
    expect(r.summary).toEqual({ total: 4, common: 1, different: 1, partial: 2, stashrOnly: 0 });
  });
  test("no value is ever present in the output", () => {
    const r = compareEnv([{ id: "a", vars: [{ key: "SECRET", value: "hunter2-super-secret" }] }, { id: "b", vars: [{ key: "SECRET", value: "other-secret-value" }] }]);
    const text = JSON.stringify(r);
    expect(text.includes("hunter2")).toBe(false);
    expect(text.includes("other-secret")).toBe(false);
  });
});

/* The IO function, with Render and the database stubbed. */
let renderImpl;
const stubs = { renderOps: { renderRequest: (...args) => renderImpl(...args) } };
const UserStub = { publicEntry: (entry) => ({ ...(entry.data?.sealed ?? entry.fields), _id: entry._id }) };
const originalLoad = Module._load;
Module._load = function (request) {
  if (request.endsWith("/models/schema")) return UserStub;
  if (request === "./renderOps") return stubs.renderOps;
  return originalLoad.apply(this, arguments);
};
const { getProjectDeployments } = require("../utils/projectDeployments");
Module._load = originalLoad;

const ID = (n) => String(n).padStart(24, "0");
let renderCalls, env;
beforeEach(() => {
  renderCalls = [];
  env = { "srv-1": [["MONGO_URI", "m1"], ["PORT", "10000"], ["SECRET_KEY", "topsecret-1"]], "srv-2": [["MONGO_URI", "m2"], ["PORT", "10000"]] };
  renderImpl = (() => {
    return async (key, path) => {
      renderCalls.push(path);
      const id = path.split("/")[3];
      if (id === "srv-gone") { const e = new Error("nf"); e.status = 404; throw e; }
      if (path.includes("/env-vars")) return (env[id] || []).map(([k, v]) => ({ envVar: { key: k, value: v } }));
      if (path.includes("/deploys")) return [{ deploy: { status: "live", createdAt: "2026-10-14T00:00:00Z", commit: { message: "fix: thing\nbody", id: "abcdef123" } } }];
      return { service: { id, name: id === "srv-1" ? "dealradar" : id, type: "web_service", suspended: id === "srv-2" ? "suspended" : "not_suspended", dashboardUrl: "https://dashboard.render.com/web/" + id,
        serviceDetails: { url: "https://" + id + ".onrender.com", region: "singapore", plan: "free" }, branch: "main" } };
    };
  })();
});

describe("project deployments", () => {
  test("lists every linked server with its URL and compares env, never returning values", async () => {
    const user = {
      renderAccounts: [{ _id: ID(9), enc: "udk", fields: { name: "Main", apiKey: "k" } }],
      projects: [{ _id: ID(1), enc: "udk", fields: { name: "Deal-Radar", renderAccountId: ID(9), renderServiceId: "srv-1", envVars: [{ name: "MONGO_URI", value: "m1" }, { name: "SAVED_ONLY", value: "z" }],
        renderServices: [{ accountId: ID(9), serviceId: "srv-1", name: "dealradar" }, { accountId: ID(9), serviceId: "srv-2", name: "dealradar-93do" }, { accountId: ID(9), serviceId: "srv-gone", name: "old" }] } }],
      getDataKey: async () => "k"
    };
    const data = await getProjectDeployments(user, ID(1));
    expect(data.servers.map((s) => s.id)).toEqual(["srv-1", "srv-2", "srv-gone"]);
    expect(data.servers[0].isMain).toBe(true);
    expect(data.servers[0].url).toBe("https://srv-1.onrender.com");
    expect(data.servers[1].suspended).toBe(true);
    expect(data.servers[0].latestDeploy.status).toBe("live");
    expect(data.servers[0].latestDeploy.commit).toBe("fix: thing");
    expect(data.servers[2].gone).toBe(true);
    const by = Object.fromEntries(data.env.rows.map((r) => [r.name, r]));
    expect(by.PORT.status).toBe("common");
    expect(by.MONGO_URI.status).toBe("different");
    expect(by.MONGO_URI.cells.stashr.variant).toBe(by.MONGO_URI.cells["srv-1"].variant); // Stashr's copy matches srv-1
    expect(by.SECRET_KEY.status).toBe("partial");
    expect(by.SAVED_ONLY.cells["srv-1"].state).toBe("missing");
    expect(by.SAVED_ONLY.status).toBe("stashr_only"); // only the Stashr copy has it: not on any server
    expect(by.PORT.cells.stashr.state).toBe("missing"); // the Stashr column informs but never decides
    const text = JSON.stringify(data);
    expect(["topsecret-1", "m1", "m2", "10000"].some((v) => text.includes('"' + v + '"'))).toBe(false);
    expect(data.stashr.envCount).toBe(2);
  });

  test("a project with no Render link returns an empty comparison", async () => {
    const user = { renderAccounts: [], projects: [{ _id: ID(2), enc: "udk", fields: { name: "Manual" } }], getDataKey: async () => "k" };
    const data = await getProjectDeployments(user, ID(2));
    expect(data.servers).toEqual([]);
    expect(data.env.summary.total).toBe(0);
  });
});
