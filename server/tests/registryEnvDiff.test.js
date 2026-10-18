const { describe, test } = require("node:test");
const expect = require("./expect");
const { planEnvAlign } = require("../utils/registryEnvDiff");

const v = (key, value) => ({ key, value });
const four = () => [
  { id: "a", name: "A", vars: [v("DB", "1"), v("KEY", "k"), v("RENDER_EXTERNAL_URL", "x")] },
  { id: "b", name: "B", vars: [v("DB", "1")] },
  { id: "c", name: "C", vars: [v("DB", "2"), v("KEY", "k"), v("GEN", "")] },
  { id: "d", name: "D", vars: [] }
];

describe("planEnvAlign", () => {
  test("lists missing names per server and fills gaps from the first server that has a value", () => {
    const plan = planEnvAlign(four());
    expect(plan.perServer[1].missing).toEqual(["KEY"]);
    expect(plan.perServer[3].missing).toEqual(["DB", "KEY"]);
    expect(plan.additions.find((a) => a.serverId === "b" && a.key === "KEY").value).toBe("k");
    expect(plan.inSync).toBe(false);
  });
  test("reports different values without overwriting them", () => {
    const plan = planEnvAlign(four());
    expect(plan.perServer[2].differs).toEqual(["DB"]);
    expect(plan.additions.some((a) => a.serverId === "c")).toBe(false);
  });
  test("ignores Render-managed names and reports names with no copyable value", () => {
    const plan = planEnvAlign(four());
    expect(plan.perServer.some((s) => s.missing.includes("RENDER_EXTERNAL_URL"))).toBe(false);
    expect(plan.noValue).toEqual(["GEN"]);
  });
  test("identical servers are in sync", () => {
    const same = [{ id: "a", name: "A", vars: [v("X", "1")] }, { id: "b", name: "B", vars: [v("X", "1")] }];
    expect(planEnvAlign(same).inSync).toBe(true);
  });
});
