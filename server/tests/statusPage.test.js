const { describe, test } = require("node:test");
const expect = require("./expect");
const { normalizeSlug, buildSnapshot } = require("../utils/statusPage");

describe("normalizeSlug", () =>
{
    test("accepts a lowercase slug of 4 to 40 characters with dashes inside", () =>
    {
        expect(normalizeSlug("WeCode-Status")).toBe("wecode-status");
    });

    test("rejects too short, leading or trailing dashes, and symbols", () =>
    {
        expect(normalizeSlug("ab")).toBe(null);
        expect(normalizeSlug("-wecode")).toBe(null);
        expect(normalizeSlug("we/code")).toBe(null);
    });
});

describe("buildSnapshot", () =>
{
    const services = [
        { id: "srv-1", name: "api", suspended: false, url: "https://secret.onrender.com" },
        { id: "srv-2", name: "web", suspended: true, url: "https://web.onrender.com" },
        { id: "srv-3", name: "hidden", suspended: false }
    ];

    test("only the chosen services are published, with names and states", () =>
    {
        const s = buildSnapshot(services, ["srv-1", "srv-2"], new Date("2026-10-10T00:00:00Z"));
        expect(s.services.map((x) => x.name)).toEqual(["api", "web"]);
        expect(s.services[1].state).toBe("suspended");
        expect(s.overall).toBe("degraded");
    });

    test("no URLs, ids or other fields leak into the public view", () =>
    {
        const s = buildSnapshot(services, ["srv-1"]);
        const text = JSON.stringify(s);
        expect(text.includes("secret.onrender.com")).toBe(false);
        expect(text.includes("srv-1")).toBe(false);
    });

    test("all running is operational, and nothing chosen is unknown", () =>
    {
        expect(buildSnapshot(services, ["srv-1", "srv-3"]).overall).toBe("operational");
        expect(buildSnapshot(services, []).overall).toBe("unknown");
    });
});
