const { describe, test } = require("node:test");
const expect = require("./expect");
const { merge, parseUpdate, DEFAULTS } = require("../utils/shineSite");

describe("shine site status", () =>
{
    test("defaults and added sectors", () =>
    {
        const m = merge([], [{ key: "sector 12", label: "Sector 12" }, { key: "sec 4", label: "Sector 4" }]);
        expect(m.map((p) => p.key)).toEqual([...DEFAULTS.map((d) => d.key), "sector 12"]);
        expect(m[m.length - 1]).toEqual({ key: "sector 12", name: "Sector 12", status: "Ongoing", area: "", progress: 0, stage: "", eta: "" });
    });
    test("saved values win; completed forces 100%", () =>
    {
        const m = merge([{ key: "sec 42", progress: 85, stage: "Finishing" }, { key: "reliance met city", status: "Completed", progress: 40 }]);
        expect(m.find((p) => p.key === "sec 42").progress).toBe(85);
        expect(m.find((p) => p.key === "reliance met city")).toMatchObject({ progress: 100, stage: "" });
    });
    test("update validation", () =>
    {
        expect(parseUpdate({ progress: 50, stage: "Structure" }).value).toEqual({ progress: 50, stage: "Structure" });
        expect(parseUpdate({ progress: 140 }).error).toBeTruthy();
        expect(parseUpdate({ stage: "Painting" }).error).toBeTruthy();
        expect(parseUpdate({ name: "x" }).error).toBeTruthy();
    });
});
