const test = require("node:test");
const expect = require("./expect");
const { buildLiveDashboard, appendSnapshot, limitPeriod, providerCache } = require("../utils/usageDashboard");

const NOW = Date.parse("2026-10-14T12:00:00Z");
const accounts = new Map([["a1", { id: "a1", name: "Main", apiKey: "k" }]]);
const svc = (o) => ({ id: "srv-1", name: "api", type: "web_service", plan: "free", suspended: false, accountId: "a1", createdAt: "2026-10-01T00:00:00Z", ...o });
const request = (env, deploys = [{ deploy: { status: "live" } }]) => async (_a, path) =>
  path.includes("/deploys") ? deploys : env.map(([key, value]) => ({ envVar: { key, value } }));

test("only live services are listed; suspended and never-live ones are skipped", async () => {
  providerCache.clear();
  const data = await buildLiveDashboard({
    services: [svc({}), svc({ id: "srv-2", name: "old", suspended: true }), svc({ id: "srv-3", name: "failing" })],
    accounts, request: async (a, p) => (p.includes("srv-3") && p.includes("/deploys") ? [{ deploy: { status: "build_failed" } }] : request([["GROQ_API_KEY", "x"]])(a, p)),
    providers: {}, now: NOW
  });
  expect(data.projects.map((p) => p.name)).toEqual(["api"]);
  expect(data.liveCount).toBe(1);
  expect(data.totalCount).toBe(3);
});

test("provider usage is projected and secrets never appear in the output", async () => {
  providerCache.clear();
  const providers = { mongodb: { run: async () => ({ ok: true, reports: [{ label: "db", plan: "Atlas", metrics: [{ key: "cluster-storage", label: "Storage", used: 256 * 1048576, limit: 512 * 1048576, unit: "bytes" }] }] }) } };
  const data = await buildLiveDashboard({ services: [svc({})], accounts, request: request([["MONGO_URI", "mongodb+srv://u:topsecret@c.mongodb.net/app"]]), providers, now: NOW });
  const m = data.projects[0].services[0];
  expect(m.state).toBe("ok");
  expect(m.reports[0].metrics[0].percent).toBe(50);
  expect(m.reports[0].metrics[0].remaining).toBe(256 * 1048576);
  expect(JSON.stringify(data)).not.toContain("topsecret");
  expect(Object.values(data.snapshotValues)[0]).toBe(256 * 1048576);
});

test("a provider error is reported per service without failing the dashboard", async () => {
  providerCache.clear();
  const providers = { mongodb: { run: async () => ({ ok: false, code: "auth", error: "rejected" }) } };
  const data = await buildLiveDashboard({ services: [svc({})], accounts, request: request([["MONGO_URI", "mongodb+srv://u:p@c.mongodb.net/app"]]), providers, now: NOW });
  expect(data.projects[0].services[0].state).toBe("error");
  expect(data.projects[0].services[0].error.code).toBe("auth");
});

test("services can be switched off and configured limits carry their period", async () => {
  providerCache.clear();
  const env = [["MONGO_URI", "mongodb+srv://u:p@c.mongodb.net/app"], ["GROQ_API_KEY", "g"], ["GROQ_RPD", "14400"]];
  const providers = { mongodb: { run: async () => { throw new Error("must not run"); } } };
  const data = await buildLiveDashboard({ services: [svc({})], accounts, request: request(env), providers, settings: { disabled: { "srv-1|mongodb": true } }, now: NOW });
  const list = data.projects[0].services;
  expect(list.find((s) => s.key === "mongodb").state).toBe("disabled");
  expect(list.find((s) => s.key === "groq").configuredLimits[0].period).toBe("day");
});

test("services deployed from the same repo are merged into one project", async () => {
  providerCache.clear();
  let runs = 0;
  const providers = { mongodb: { run: async () => { runs += 1; return { ok: true, reports: [{ label: "db", metrics: [] }] }; } } };
  const repo = "https://github.com/Owner/Deal_Radar";
  const data = await buildLiveDashboard({
    services: [svc({ id: "srv-b", name: "dealradar-93do", repo }), svc({ id: "srv-a", name: "dealradar", repo: repo + ".git" }), svc({ id: "srv-c", name: "other", repo: "https://github.com/Owner/Other" })],
    accounts, request: request([["MONGO_URI", "mongodb+srv://u:p@c.mongodb.net/app"]]), providers,
    settings: { disabled: {} }, now: NOW
  });
  expect(data.projects.map((p) => p.name)).toEqual(["Deal_Radar", "other"]);
  expect(data.projectCount).toBe(2);
  expect(data.liveCount).toBe(3);
  const merged = data.projects[0];
  expect(merged.id).toBe("srv-a");
  expect(merged.deployments.map((d) => d.id).sort()).toEqual(["srv-a", "srv-b"]);
  expect(merged.services.filter((s) => s.key === "mongodb").length).toBe(1);
  expect(JSON.stringify(data)).not.toContain('"fp"');
  expect(runs).toBe(1);
});

test("snapshots are rate limited and bounded", () => {
  let h = appendSnapshot([], { a: 1 }, NOW);
  expect(h.length).toBe(1);
  h = appendSnapshot(h, { a: 2 }, NOW + 60000);
  expect(h.length).toBe(1);
  h = appendSnapshot(h, { a: 2 }, NOW + 2 * 3600000);
  expect(h.length).toBe(2);
  expect(appendSnapshot(h, {}, NOW + 9e9).length).toBe(2);
  expect(limitPeriod("OPENAI_RPD")).toBe("day");
});
