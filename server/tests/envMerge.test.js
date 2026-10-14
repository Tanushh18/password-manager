const { describe, test } = require("node:test");
const expect = require("./expect");
const { mergeRenderEnv } = require("../utils/envMerge");

const names = (r) => r.envVars.map((v) => v.name).join(",");
const find = (r, n) => r.envVars.find((v) => v.name === n);

describe("Render -> project env merge", () =>
{
    test("adds variables that are new in Render and marks them as linked", () =>
    {
        const r = mergeRenderEnv([], [{ key: "A", value: "1" }, { key: "B", value: "2" }]);
        expect(names(r)).toBe("A,B");
        expect(r.added.join(",")).toBe("A,B");
        expect(find(r, "A").source).toBe("render");
        expect(r.changed).toBe(true);
    });

    test("updates values that came from Render and keeps the purpose note", () =>
    {
        const r = mergeRenderEnv([{ name: "A", value: "old", purpose: "db", source: "render" }], [{ key: "A", value: "new" }]);
        expect(find(r, "A").value).toBe("new");
        expect(find(r, "A").purpose).toBe("db");
        expect(r.updated.join(",")).toBe("A");
    });

    test("never deletes: a variable removed from Render is kept and flagged once", () =>
    {
        const first = mergeRenderEnv([{ name: "GONE", value: "secret", source: "render" }], []);
        expect(find(first, "GONE").value).toBe("secret");
        expect(find(first, "GONE").source).toBe("render-removed");
        expect(first.removed.join(",")).toBe("GONE");
        const again = mergeRenderEnv(first.envVars, []);
        expect(again.removed).toHaveLength(0);
        expect(again.changed).toBe(false);
    });

    test("a removed variable that returns to Render is re-linked", () =>
    {
        const r = mergeRenderEnv([{ name: "A", value: "x", source: "render-removed" }], [{ key: "A", value: "y" }]);
        expect(find(r, "A").source).toBe("render");
        expect(find(r, "A").value).toBe("y");
    });

    test("leaves project-only variables untouched", () =>
    {
        const r = mergeRenderEnv([{ name: "LOCAL", value: "mine", purpose: "x" }], [{ key: "A", value: "1" }]);
        expect(find(r, "LOCAL").value).toBe("mine");
        expect(find(r, "LOCAL").source).toBeUndefined();
        expect(r.removed).toHaveLength(0);
    });

    test("manual entry with the same value is adopted without changing it", () =>
    {
        const r = mergeRenderEnv([{ name: "A", value: "1", purpose: "p" }], [{ key: "A", value: "1" }]);
        expect(find(r, "A").source).toBe("render");
        expect(r.unchanged.join(",")).toBe("A");
        expect(r.conflicts).toHaveLength(0);
    });

    test("manual entry with a different value is a conflict that is skipped by default", () =>
    {
        const r = mergeRenderEnv([{ name: "A", value: "mine" }], [{ key: "A", value: "render" }]);
        expect(r.conflicts.join(",")).toBe("A");
        expect(find(r, "A").value).toBe("mine");
        expect(r.updated).toHaveLength(0);
    });

    test("resolveConflicts lets Render win and links the variable", () =>
    {
        const r = mergeRenderEnv([{ name: "A", value: "mine" }], [{ key: "A", value: "render" }], { resolveConflicts: true });
        expect(find(r, "A").value).toBe("render");
        expect(find(r, "A").source).toBe("render");
        expect(r.updated.join(",")).toBe("A");
    });

    test("is idempotent: syncing twice changes nothing the second time", () =>
    {
        const remote = [{ key: "A", value: "1" }, { key: "B", value: "2" }];
        const once = mergeRenderEnv([{ name: "C", value: "c" }], remote);
        const twice = mergeRenderEnv(once.envVars, remote);
        expect(twice.changed).toBe(false);
        expect(twice.added).toHaveLength(0);
        expect(twice.updated).toHaveLength(0);
    });

    test("ignores invalid names, tolerates junk input and never mutates its inputs", () =>
    {
        const existing = Object.freeze([Object.freeze({ name: "A", value: "1", source: "render" })]);
        const r = mergeRenderEnv(existing, [{ key: "bad name", value: "x" }, { key: "1BAD", value: "x" }, null, { key: "A", value: undefined }]);
        expect(names(r)).toBe("A");
        expect(find(r, "A").value).toBe("");
        expect(mergeRenderEnv(undefined, undefined).envVars).toHaveLength(0);
        expect(existing[0].value).toBe("1");
    });

    test("duplicate local rows: only the first is managed", () =>
    {
        const r = mergeRenderEnv([{ name: "A", value: "1", source: "render" }, { name: "A", value: "dup" }], [{ key: "A", value: "2" }]);
        expect(r.envVars[0].value).toBe("2");
        expect(r.envVars[1].value).toBe("dup");
    });
});
