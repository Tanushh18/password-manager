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

describe("needsPrimaryCheck", () =>
{
    const { needsPrimaryCheck } = require("../utils/stashrMainChange");
    const previous = ["https://old.onrender.com", "https://backup.onrender.com"];
    test("a changed primary on the Stashr list needs a health check", () =>
    {
        expect(needsPrimaryCheck({ app: "stashr", previousUrls: previous, urls: ["https://new.onrender.com", "https://old.onrender.com"], force: false })).toBe(true);
    });
    test("saving with the same primary, or only changing backups, needs no check", () =>
    {
        expect(needsPrimaryCheck({ app: "stashr", previousUrls: previous, urls: ["https://old.onrender.com"], force: false })).toBe(false);
        expect(needsPrimaryCheck({ app: "stashr", previousUrls: previous, urls: ["https://old.onrender.com", "https://new-backup.onrender.com"], force: false })).toBe(false);
    });
    test("an explicit force skips the check, and other apps are never checked", () =>
    {
        expect(needsPrimaryCheck({ app: "stashr", previousUrls: previous, urls: ["https://new.onrender.com"], force: true })).toBe(false);
        expect(needsPrimaryCheck({ app: "ggnhome", previousUrls: previous, urls: ["https://new.onrender.com"], force: false })).toBe(false);
    });
    test("a first-ever save has no previous primary to compare with", () =>
    {
        expect(needsPrimaryCheck({ app: "stashr", previousUrls: [], urls: ["https://new.onrender.com"], force: false })).toBe(false);
    });
});
