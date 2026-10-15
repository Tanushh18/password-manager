const test = require("node:test");
const expect = require("./expect");
const { buildAutoGroups, isAutoGroup } = require("../utils/monitorGroups");

test("every running service is watched, grouped by app; suspended ones and your own groups are left out", () => {
  const repo = "https://github.com/Tanushh18/Deal_Radar";
  const groups = buildAutoGroups([
    { id: "s1", name: "dealradar", repo, accountId: "a1" },
    { id: "s2", name: "dealradar-x", repo: repo + ".git", accountId: "a2" },
    { id: "s3", name: "dealradar-old", repo, accountId: "a1", suspended: true },
    { id: "s4", name: "tasks", repo: "https://github.com/Tanushh18/Tasks", accountId: "a1" },
    { id: "s5", name: "worker", repo: "", accountId: "a1" },
    { id: "s6", name: "mine", repo: "https://github.com/x/Mine", accountId: "a1" }
  ], [{ id: "g1", serviceKeys: ["a1:s6"] }]);
  expect(groups.map((g) => [g.id, g.serviceKeys])).toEqual([
    ["auto-tanushh18-deal_radar", ["a1:s1", "a2:s2"]],
    ["auto-tanushh18-tasks", ["a1:s4"]],
    ["auto-svc-s5", ["a1:s5"]]
  ]);
  expect(groups.every((g) => isAutoGroup(g.id) && /^[A-Za-z0-9_-]{1,80}$/.test(g.id))).toBe(true);
  expect(isAutoGroup("g1")).toBe(false);
});
