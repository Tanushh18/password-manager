const { describe, test } = require("node:test");
const expect = require("./expect");
const { isMainServer } = require("../utils/mainServer");
const { ENV_NAME, targetsOf, projectsToUpdate, mayRunAutomatically, applyToTargets, projectApplied } = require("../utils/stashrPropagation");

describe("isMainServer", () =>
{
    const urls = ["https://main.onrender.com", "https://backup.onrender.com"];
    test("the server whose address is first in the list is the main one", () =>
    {
        expect(isMainServer(urls, "https://main.onrender.com/")).toBe(true);
        expect(isMainServer(urls, "https://backup.onrender.com")).toBe(false);
    });
    test("it fails open when the server does not know its address or there is no list", () =>
    {
        expect(isMainServer(urls, "")).toBe(true);
        expect(isMainServer([], "https://backup.onrender.com")).toBe(true);
    });
});

describe("targetsOf", () =>
{
    test("the primary service and merged ones are listed once each", () =>
    {
        const t = targetsOf({ name: "Deal Radar", renderServiceId: "srv-1", renderAccountId: "acc-1", renderServices: [{ serviceId: "srv-1", name: "dup" }, { serviceId: "srv-2", accountId: "acc-2", name: "second" }] });
        expect(t.map((x) => x.serviceId)).toEqual(["srv-1", "srv-2"]);
        expect(t[1].accountId).toBe("acc-2");
    });
    test("invalid ids are dropped", () =>
    {
        expect(targetsOf({ renderServiceId: "../bad" })).toEqual([]);
    });
});

describe("projectsToUpdate / mayRunAutomatically", () =>
{
    test("only projects that did not get the current URL are updated", () =>
    {
        const state = { projectIds: ["a", "b"], applied: { a: "https://new", b: "https://old" } };
        expect(projectsToUpdate(state, "https://new")).toEqual(["b"]);
        expect(projectsToUpdate(state, "")).toEqual([]);
    });
    test("automatic runs need the switch on and a successful test", () =>
    {
        expect(mayRunAutomatically({ enabled: true })).toBe(false);
        expect(mayRunAutomatically({ enabled: true, testedAt: "2026-10-28T00:00:00Z" })).toBe(true);
        expect(mayRunAutomatically({ enabled: false, testedAt: "x" })).toBe(false);
    });
});

describe("applyToTargets", () =>
{
    const targets = [{ serviceId: "srv-1", accountId: "a1", name: "one" }, { serviceId: "srv-2", accountId: "a2", name: "two" }];
    test("writes only STASHR_SERVER_URL, then deploys", async () =>
    {
        const calls = [];
        const request = async (key, path, options) => { calls.push({ key, path, method: options.method, body: options.body }); };
        const results = await applyToTargets(targets, "https://main.example", { request, apiKeyFor: (id) => "key-" + id });
        expect(results.every((r) => r.ok && r.deployed)).toBe(true);
        const puts = calls.filter((c) => c.method === "PUT");
        expect(puts.map((c) => c.path)).toEqual(["/v1/services/srv-1/env-vars/" + ENV_NAME, "/v1/services/srv-2/env-vars/" + ENV_NAME]);
        expect(puts[0].body).toEqual({ value: "https://main.example" });
        expect(calls.filter((c) => c.method === "POST").length).toBe(2);
    });
    test("a service that refuses does not stop the others, and is not deployed", async () =>
    {
        const request = async (key, path, options) => { if (path.includes("srv-1") && options.method === "PUT") throw Object.assign(new Error("no"), { status: 404 }); };
        const results = await applyToTargets(targets, "https://main.example", { request, apiKeyFor: () => "k" });
        expect(results[0].ok).toBe(false);
        expect(results[0].error).toBe("Service no longer exists on Render.");
        expect(results[1].ok).toBe(true);
        expect(projectApplied(results)).toBe(false);
    });
    test("a disconnected account is reported, not called", async () =>
    {
        let called = false;
        const results = await applyToTargets(targets, "https://main.example", { request: async () => { called = true; }, apiKeyFor: () => null });
        expect(called).toBe(false);
        expect(results[0].error).toBe("Render account not connected.");
    });
    test("a failed deploy still counts as applied (the variable is saved)", async () =>
    {
        const request = async (key, path, options) => { if (options.method === "POST") throw new Error("suspended"); };
        const results = await applyToTargets([targets[0]], "https://main.example", { request, apiKeyFor: () => "k" });
        expect(results[0].ok).toBe(true);
        expect(results[0].deployed).toBe(false);
    });
});
