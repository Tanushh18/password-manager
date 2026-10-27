const { describe, test } = require("node:test");
const expect = require("./expect");
const { classifyFile, verdict, thingsOf, usageForProject } = require("../utils/serverUsage");

describe("classifyFile", () =>
{
    test("a file that reads the Stashr registry is marked, and its fallbacks are noted", () =>
    {
        const code = 'const REG = "https://password-manager-server-xxdr.onrender.com/registry/ggnhome";\nconst FALLBACK = process.env.REACT_APP_Base_API;';
        const r = classifyFile("client/src/utils/apiBase.js", code);
        expect(r.registry).toBe(true);
        expect(r.env).toEqual(["REACT_APP_Base_API"]);
        expect(r.hardcoded.length).toBe(0);
    });

    test("a literal onrender.com server is hardcoded; localhost, comments and Stashr itself are not", () =>
    {
        const code = '// old: https://old.onrender.com\nconst A = "https://we-three-api.onrender.com/api";\nconst B = "http://localhost:4000";\nconst C = "https://password-manager-server-xxdr.onrender.com";';
        const r = classifyFile("src/api.js", code);
        expect(r.hardcoded.map((h) => h.origin)).toEqual(["https://we-three-api.onrender.com"]);
        expect(r.hardcoded[0].line).toBe(2);
        expect(r.registry).toBe(false);
    });

    test("a project's own custom-domain server is hardcoded too", () =>
    {
        const r = classifyFile("src/api.js", 'fetch("https://api.ggnhome.com/x")', ["https://api.ggnhome.com/api"]);
        expect(r.hardcoded.map((h) => h.origin)).toEqual(["https://api.ggnhome.com"]);
    });
});

describe("verdict", () =>
{
    const files = [
        { path: "client/a.js", registry: false, env: ["VITE_API_BASE"], hardcoded: [] },
        { path: "server/b.js", registry: false, env: [], hardcoded: [{ origin: "https://x.onrender.com", file: "server/b.js", line: 4 }] },
        { path: "site/c.js", registry: true, env: ["VITE_API_BASE"], hardcoded: [] }
    ];
    test("Stashr beats everything, then hardcoded, then env, then none", () =>
    {
        expect(verdict(files, "site").state).toBe("stashr");
        expect(verdict(files, "server").state).toBe("hardcoded");
        expect(verdict(files, "client").state).toBe("env");
        expect(verdict(files, "nothing").state).toBe("none");
        expect(verdict(files, "").state).toBe("stashr");
    });
    test("a Stashr verdict reports what is left as fallback", () =>
    {
        expect(verdict(files, "site").fallbacks).toEqual({ env: 1, hardcoded: 0 });
    });
});

describe("usageForProject", () =>
{
    const user = { githubAccounts: [] };
    test("asks for a repository, and for a GitHub connection, before scanning", async () =>
    {
        expect((await usageForProject(user, null, {}, [])).error.length > 0).toBe(true);
        expect((await usageForProject(user, null, { repoUrl: "https://github.com/a/b" }, [])).error).toMatch(/Connect GitHub/);
    });
    test("lists render servers and host sites as the deployed things", () =>
    {
        const things = thingsOf({ renderServiceId: "s1", renderAccountId: "a", renderServices: [{ accountId: "a", serviceId: "s1", name: "api", url: "https://api.onrender.com" }], hostLinks: [{ id: "h1", provider: "vercel", name: "site" }] }, [{ id: "s1", type: "web_service", url: "https://api.onrender.com", rootDir: "server" }]);
        expect(things.map((t) => [t.provider, t.kind, t.folder])).toEqual([["Render", "server", "server"], ["vercel", "site", ""]]);
    });
});
