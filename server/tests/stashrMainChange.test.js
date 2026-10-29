const { describe, test } = require("node:test");
const expect = require("./expect");
const { frontendValue, frontendTargets } = require("../utils/stashrMainChange");

describe("frontendValue", () =>
{
    test("lists every Stashr URL, main first, comma separated, without trailing slashes or blanks", () =>
    {
        expect(frontendValue(["https://new.onrender.com/", " https://backup.onrender.com ", ""])).toBe("https://new.onrender.com,https://backup.onrender.com");
    });
    test("is empty for an empty list", () =>
    {
        expect(frontendValue([])).toBe("");
    });
});

describe("frontendTargets", () =>
{
    const stashrProject = {
        repoUrl: "https://github.com/Tanushh18/password-manager",
        renderServiceId: "srv-api",
        renderAccountId: "acc-1",
        name: "password-manager",
        renderServices: [{ serviceId: "srv-front", accountId: "acc-2", name: "stashr-client" }]
    };
    test("finds the stashr-client service in the Stashr project", () =>
    {
        expect(frontendTargets(stashrProject)).toEqual([{ serviceId: "srv-front", accountId: "acc-2", name: "stashr-client" }]);
    });
    test("ignores other projects even when they have a service with the same name", () =>
    {
        expect(frontendTargets({ ...stashrProject, repoUrl: "https://github.com/someone/else" })).toEqual([]);
    });
});

describe("isFrontendService", () =>
{
    const { isFrontendService } = require("../utils/stashrMainChange");
    test("matches the stashr-client service by name", () =>
    {
        expect(isFrontendService({ id: "srv-1", name: "stashr-client" })).toBe(true);
        expect(isFrontendService({ id: "srv-2", name: "password-manager-server" })).toBe(false);
    });
    test("rejects a stashr-client service that Render reports from another repo", () =>
    {
        expect(isFrontendService({ id: "srv-3", name: "stashr-client", repo: "https://github.com/someone/else" })).toBe(false);
        expect(isFrontendService({ id: "srv-4", name: "stashr-client", repo: "https://github.com/Tanushh18/password-manager" })).toBe(true);
    });
});
