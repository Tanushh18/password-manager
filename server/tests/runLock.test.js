const { describe, test } = require("node:test");
const expect = require("./expect");
const { withRunLock } = require("../utils/runLock");

const busy = { skipped: "busy" };

describe("withRunLock", () =>
{
    test("runs the work and returns its result when nothing else is running", async () =>
    {
        expect(await withRunLock("a", async () => "done", busy)).toBe("done");
    });

    test("a second call for the same key while the first runs gets the busy result", async () =>
    {
        let release;
        const first = withRunLock("a", () => new Promise((resolve) => { release = resolve; }), busy);
        const second = await withRunLock("a", async () => "should not run", busy);
        expect(second).toEqual(busy);
        release("first");
        expect(await first).toBe("first");
    });

    test("different keys do not block each other", async () =>
    {
        let release;
        const first = withRunLock("a", () => new Promise((resolve) => { release = resolve; }), busy);
        expect(await withRunLock("b", async () => "other", busy)).toBe("other");
        release("first");
        await first;
    });

    test("the key is free again after a run finishes or throws", async () =>
    {
        expect(await withRunLock("c", async () => 1, busy)).toBe(1);
        await withRunLock("c", async () => { throw new Error("boom"); }, busy).catch(() => {});
        expect(await withRunLock("c", async () => 2, busy)).toBe(2);
    });
});
