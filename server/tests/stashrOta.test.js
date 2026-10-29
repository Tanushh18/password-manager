const { describe, test } = require("node:test");
const expect = require("./expect");
const { otaWorkflowFor, publishOta } = require("../utils/stashrOta");

describe("stashrOta", () =>
{
    test("only the listed mobile apps have an OTA workflow", () =>
    {
        expect(otaWorkflowFor("https://github.com/Tanushh18/Deal_Radar")).toBe("eas-update.yml");
        expect(otaWorkflowFor("https://github.com/Tanushh18/Tasks")).toBe("publish-ota.yml");
        expect(otaWorkflowFor("https://github.com/ggnhome629-git/ggnHome")).toBe("");
    });
    test("saves the variable then dispatches the workflow", async () =>
    {
        const calls = [];
        const deps = {
            loadAccounts: () => [{ token: "t" }],
            resolveRepo: async () => ({ used: { token: "t" }, base: "/repos/Tanushh18/Tasks", repo: { default_branch: "main" } }),
            githubSend: async (token, method, path, body) => { calls.push(method + " " + path); return { ok: true, status: 204 }; }
        };
        const r = await publishOta({}, null, "https://github.com/Tanushh18/Tasks", "https://x.onrender.com", deps);
        expect(r.ok).toBe(true);
        expect(calls).toEqual(["PATCH /repos/Tanushh18/Tasks/actions/variables/STASHR_SERVER_URL", "POST /repos/Tanushh18/Tasks/actions/workflows/publish-ota.yml/dispatches"]);
    });
    test("an unlisted repo is skipped and a missing connection is reported", async () =>
    {
        expect((await publishOta({}, null, "https://github.com/a/b", "https://x", { githubSend: async () => ({}) })).skipped).toBe(true);
        const r = await publishOta({}, null, "https://github.com/Tanushh18/Tasks", "https://x", { loadAccounts: () => [], githubSend: async () => ({ ok: true }) });
        expect(r.ok).toBe(false);
    });
});
