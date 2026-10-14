const test = require("node:test");
const expect = require("./expect");
const { duplicateGroups, pickPrimary, mergeProjects } = require("../utils/projectMerge");

const p = (o) => ({ _id: o.id, name: "deal-radar", repoUrl: "https://github.com/Tanushh18/Deal_Radar", envVars: [], ...o });

test("projects from the same repo (or same name without a repo) are grouped", () => {
  const groups = duplicateGroups([
    p({ id: "a" }), p({ id: "b", name: "Deal-Radar", repoUrl: "https://github.com/tanushh18/deal_radar.git" }), p({ id: "c", name: "Deal-radar" }),
    p({ id: "d", name: "ggnHome", repoUrl: "https://github.com/x/ggnHome" }),
    { _id: "e", name: "Job Hunter" }, { _id: "f", name: "job-hunter" }, { _id: "g", broken: true }
  ]);
  expect(groups.map((g) => g.ids)).toEqual([["a", "b", "c"], ["e", "f"]]);
});

test("merge keeps the primary's values, fills gaps, combines env vars and keeps every Render link", () => {
  const a = p({ id: "a", description: "", liveUrl: "https://a", renderAccountId: "acc", renderServiceId: "srv-1", renderServiceName: "dealradar",
    envVars: [{ name: "MONGO_URI", value: "m1" }, { name: "KEY", value: "k" }], databases: [{ name: "db" }], createdAt: "2026-10-01" });
  const b = p({ id: "b", description: "Deals", liveUrl: "https://b", renderAccountId: "acc", renderServiceId: "srv-2", renderServiceName: "dealradar-93do",
    envVars: [{ name: "MONGO_URI", value: "m2" }, { name: "EXTRA", value: "e" }], databases: [{ name: "db" }, { name: "cache" }] });
  expect(pickPrimary([b, a])._id).toBe("b"); // same env count, b has more filled in
  expect(pickPrimary([p({ id: "x", envVars: [{ name: "A" }] }), p({ id: "y", envVars: [], description: "more" })])._id).toBe("x");
  const { fields, conflicts } = mergeProjects(a, [b]);
  expect(fields.liveUrl).toBe("https://a");
  expect(fields.description).toBe("Deals");
  expect(fields.envVars.map((v) => v.name)).toEqual(["MONGO_URI", "KEY", "EXTRA"]);
  expect(fields.envVars[0].value).toBe("m1");
  expect(conflicts).toEqual(["MONGO_URI"]);
  expect(fields.databases.length).toBe(2);
  expect(fields.renderServiceId).toBe("srv-1");
  expect(fields.renderServices.map((s) => s.serviceId)).toEqual(["srv-1", "srv-2"]);
  expect(fields._id).toBe(undefined);
});

const { refreshLinks } = require("../utils/projectLink");
test("links follow Render: deleted services drop off, new deployments of the repo are added", () => {
  const repo = "https://github.com/Tanushh18/Deal_Radar";
  const svc = (id, o = {}) => ({ id, name: id, repo, accountId: "acc1", suspended: false, ...o });
  const project = { repoUrl: repo, renderAccountId: "acc1", renderServiceId: "gone", renderServiceName: "gone",
    renderServices: [{ accountId: "acc1", serviceId: "gone" }, { accountId: "acc1", serviceId: "s1" }, { accountId: "acc9", serviceId: "other-acc" }] };
  const patch = refreshLinks(project, [svc("s1", { suspended: true }), svc("s2", { accountId: "acc2" })], new Set(["acc1", "acc2"]));
  expect(patch.renderServiceId).toBe("s2");
  expect(patch.renderAccountId).toBe("acc2");
  expect(patch.renderServices.map((s) => s.serviceId)).toEqual(["s1", "s2", "other-acc"]);
  // nothing to change
  const stable = { repoUrl: repo, renderAccountId: "acc1", renderServiceId: "s1" };
  expect(refreshLinks(stable, [svc("s1")], new Set(["acc1"]))).toBe(null);
  // account that failed to load: never drop its links
  expect(refreshLinks(stable, [], new Set())).toBe(null);
});
