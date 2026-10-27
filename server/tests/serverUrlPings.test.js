const { describe, test } = require("node:test");
const expect = require("./expect");
const { withServerUrls, defaultJobs } = require("../utils/pings");

describe("cron for the Server URLs lists", () =>
{
    const services = [
        { id: "s1", accountId: "a", name: "api", type: "web_service", url: "https://api-x.onrender.com" },
        { id: "s2", accountId: "a", name: "web", type: "static_site", url: "https://web-x.onrender.com" }
    ];
    const base = () => defaultJobs(services, []);

    test("static sites are never pinged by default", () =>
    {
        expect(base().map((j) => j.name)).toEqual(["api"]);
    });

    test("a server's custom domain and its onrender.com address are ONE job, pointed at the domain", () =>
    {
        const jobs = withServerUrls(base(), [{ name: "ggnHome", urls: ["https://api.ggnhome.com", "https://api-x.onrender.com"] }], services, new Map([["s1", ["api.ggnhome.com"]]]));
        expect(jobs.length).toBe(1);
        expect(jobs[0].url).toBe("https://api.ggnhome.com");
        expect(jobs[0].serviceKey).toBe("a:s1");
    });

    test("with only the onrender.com address listed, the single job stays on it", () =>
    {
        const jobs = withServerUrls(base(), [{ name: "x", urls: ["https://api-x.onrender.com"] }], services, new Map([["s1", ["api.ggnhome.com"]]]));
        expect(jobs.map((j) => j.url)).toEqual(["https://api-x.onrender.com"]);
    });

    test("a job the person configured keeps its own address", () =>
    {
        const own = [{ serviceKey: "a:s1", name: "api", url: "https://api-x.onrender.com", path: "/ping", everyMinutes: 5, enabled: true }];
        const jobs = withServerUrls(own, [{ name: "x", urls: ["https://api.ggnhome.com"] }], services, new Map([["s1", ["api.ggnhome.com"]]]));
        expect(jobs.length).toBe(1);
        expect(jobs[0].url).toBe("https://api-x.onrender.com");
        expect(jobs[0].path).toBe("/ping");
    });

    test("a server that is not on Render gets one job; clients are left out", () =>
    {
        const jobs = withServerUrls(base(), [{ name: "other", urls: ["https://api.elsewhere.com/x", "https://api.elsewhere.com", "https://web-x.onrender.com", "https://site.vercel.app", "https://a.netlify.app", "https://b.pages.dev", "http://plain.example.com"] }], services, new Map());
        expect(jobs.map((j) => j.url)).toEqual(["https://api-x.onrender.com", "https://api.elsewhere.com"]);
    });
});
