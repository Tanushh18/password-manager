const { describe, test } = require("node:test");
const expect = require("./expect");
const { planBranchDeletes, branchPath } = require("../utils/githubBranches");

describe("Branch delete planning", () =>
{
    test("never allows the default branch", () =>
    {
        const r = planBranchDeletes(["main", "feature/a"], { defaultBranch: "main" });
        expect(r.allowed.map((a) => a.name)).toEqual(["feature/a"]);
        expect(r.refused[0].name).toBe("main");
    });

    test("refuses names that are not valid branch names", () =>
    {
        const r = planBranchDeletes(["../etc", "-rf", "ok-branch"], { defaultBranch: "main" });
        expect(r.allowed.map((a) => a.name)).toEqual(["ok-branch"]);
        expect(r.refused.length).toBe(2);
    });

    test("flags branches that are live on a server, and de-duplicates", () =>
    {
        const r = planBranchDeletes(["dev", "dev", "old"], { defaultBranch: "main", live: ["dev"] });
        expect(r.allowed).toEqual([{ name: "dev", live: true }, { name: "old", live: false }]);
    });

    test("caps a single request", () =>
    {
        const names = Array.from({ length: 60 }, (_, i) => "b" + i);
        const r = planBranchDeletes(names, { defaultBranch: "main" });
        expect(r.allowed.length).toBe(50);
        expect(r.refused.length).toBe(10);
    });

    test("encodes each path segment but keeps slashes", () =>
    {
        expect(branchPath("feature/a b")).toBe("feature/a%20b");
    });
});
