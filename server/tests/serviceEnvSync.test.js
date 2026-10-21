const { describe, test } = require("node:test");
const expect = require("./expect");
const { planEnvSync, pendingNames } = require("../utils/serviceEnvSync");
const { retargetService } = require("../utils/projectServiceAccount");

describe("Env sync between servers of one project", () =>
{
    test("sorts source variables into create, update, same and extra", () =>
    {
        const plan = planEnvSync(
            [{ key: "A", value: "1" }, { key: "B", value: "2" }, { key: "C", value: "3" }],
            [{ key: "B", value: "x" }, { key: "C", value: "3" }, { key: "Z", value: "9" }]
        );
        expect(plan.create.join(",")).toBe("A");
        expect(plan.update.join(",")).toBe("B");
        expect(plan.same.join(",")).toBe("C");
        expect(plan.extra.join(",")).toBe("Z");
    });

    test("never copies empty values or invalid names", () =>
    {
        const plan = planEnvSync([{ key: "EMPTY", value: "" }, { key: "bad-name", value: "x" }, { key: "OK", value: "1" }], []);
        expect(plan.skipped).toBe(2);
        expect(plan.create.join(",")).toBe("OK");
    });

    test("only writes differing values when overwrite is requested", () =>
    {
        const plan = planEnvSync([{ key: "A", value: "1" }, { key: "B", value: "2" }], [{ key: "B", value: "x" }]);
        expect(pendingNames(plan).join(",")).toBe("A");
        expect(pendingNames(plan, { overwrite: true }).join(",")).toBe("A,B");
    });
});

describe("Moving a service to another account", () =>
{
    const fields = {
        renderAccountId: "acc1", renderServiceId: "srv1",
        renderServices: [{ accountId: "acc1", serviceId: "srv1", name: "api" }, { accountId: "acc1", serviceId: "srv2", name: "web" }]
    };

    test("retargets the primary service and its entry", () =>
    {
        const patch = retargetService(fields, "srv1", "acc2");
        expect(patch.renderAccountId).toBe("acc2");
        expect(patch.renderServices[0].accountId).toBe("acc2");
        expect(patch.renderServices[1].accountId).toBe("acc1");
    });

    test("retargets an extra service without touching the primary link", () =>
    {
        const patch = retargetService(fields, "srv2", "acc2");
        expect(patch.renderAccountId).toBe(undefined);
        expect(patch.renderServices[1].accountId).toBe("acc2");
    });

    test("returns null for a service the project does not know", () =>
    {
        expect(retargetService(fields, "nope", "acc2")).toBe(null);
    });
});

describe("Projects that deploy the same repository", () =>
{
    const { projectsSharingRepo } = require("../utils/projectServiceSync");
    const mine = { id: "a", name: "api", repoUrl: "https://github.com/Acme/app" };
    const projects = [
        mine,
        { id: "b", name: "api copy", repoUrl: "https://github.com/acme/APP.git" },
        { id: "c", name: "other", repoUrl: "https://github.com/acme/else" },
        { id: "d", name: "broken", repoUrl: "https://github.com/acme/app", broken: true }
    ];

    test("finds the other projects on the same repository, ignoring case and .git", () =>
    {
        expect(projectsSharingRepo(projects, mine).map((p) => p.id).join(",")).toBe("b");
    });

    test("a project without a GitHub repo shares nothing", () =>
    {
        expect(projectsSharingRepo(projects, { id: "z", repoUrl: "" }).length).toBe(0);
    });
});
