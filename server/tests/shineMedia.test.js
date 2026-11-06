const { describe, test } = require("node:test");
const expect = require("./expect");
const { sectorFromLabel, sign, BUILT_IN } = require("../utils/shineMedia");

describe("shine media helpers", () =>
{
    test("sectorFromLabel builds a folder key and tag", () =>
    {
        expect(sectorFromLabel("  Sector   12 ")).toEqual({ key: "sector 12", label: "Sector 12", tag: "sector12" });
        expect(sectorFromLabel("Green Valley!")).toEqual({ key: "green valley", label: "Green Valley!", tag: "greenvalley" });
        expect(sectorFromLabel("!")).toBeNull();
        expect(sectorFromLabel("")).toBeNull();
    });
    test("sign matches Cloudinary's sorted-params SHA-1", () =>
    {
        expect(sign({ timestamp: 1, folder: "a", tags: "b" }, "s")).toBe(require("node:crypto").createHash("sha1").update("folder=a&tags=b&timestamp=1s").digest("hex"));
    });
    test("built-in sectors match the Tasks app", () => expect(BUILT_IN.map((s) => s.key)).toEqual(["sec 4", "sec 9", "sec 42", "sec 46", "reliance met city"]));
});
