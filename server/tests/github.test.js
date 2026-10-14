const { describe, test } = require("node:test");
const expect = require("./expect");
const { parseGithubRepo, orderAccounts, ciSummary, shapeRepoDetails, githubError } = require("../utils/github");

describe("GitHub repo URL parsing", () =>
{
    test("accepts the forms people actually paste", () =>
    {
        const want = { owner: "Tanushh18", repo: "Deal_Radar" };
        for (const url of [
            "https://github.com/Tanushh18/Deal_Radar", "https://github.com/Tanushh18/Deal_Radar.git",
            "http://www.github.com/Tanushh18/Deal_Radar/", "github.com/Tanushh18/Deal_Radar/tree/main/app",
            "git@github.com:Tanushh18/Deal_Radar.git", "ssh://git@github.com/Tanushh18/Deal_Radar.git",
            "Tanushh18/Deal_Radar", "  https://github.com/Tanushh18/Deal_Radar?tab=readme  "
        ]) expect(parseGithubRepo(url)).toEqual(want);
    });

    test("rejects other hosts, lookalikes, credentials and malformed input", () =>
    {
        for (const url of [
            "https://gitlab.com/o/r", "https://evil.com/github.com/o/r", "https://github.com.evil.com/o/r",
            "https://user:pw@github.com/o/r", "https://github.com/o", "https://github.com/", "javascript:alert(1)",
            "https://github.com/-bad/r", "https://github.com/o/..", "", null, undefined, "x".repeat(400)
        ]) expect(parseGithubRepo(url)).toBeNull();
    });
});

describe("GitHub token selection", () =>
{
    test("tries the token whose login matches the repo owner first, case-insensitively", () =>
    {
        const accounts = [{ login: "work" }, { login: "Tanushh18" }, { login: "other" }];
        expect(orderAccounts(accounts, "tanushh18").map((a) => a.login).join(",")).toBe("Tanushh18,work,other");
        expect(orderAccounts(accounts, "nobody").map((a) => a.login).join(",")).toBe("work,Tanushh18,other");
        expect(orderAccounts([], "x")).toHaveLength(0);
    });
});

describe("GitHub CI summary", () =>
{
    const run = (over) => ({ name: "CI", status: "completed", conclusion: "success", head_branch: "main", html_url: "u", updated_at: "t", ...over });

    test("maps run status and conclusion to a simple state", () =>
    {
        expect(ciSummary([run()], "main").state).toBe("passing");
        expect(ciSummary([run({ conclusion: "failure" })], "main").state).toBe("failing");
        expect(ciSummary([run({ conclusion: "timed_out" })], "main").state).toBe("failing");
        expect(ciSummary([run({ status: "in_progress", conclusion: null })], "main").state).toBe("running");
        expect(ciSummary([run({ conclusion: "cancelled" })], "main").state).toBe("other");
    });

    test("prefers a run on the default branch and handles no runs", () =>
    {
        const runs = [run({ head_branch: "feature", conclusion: "failure" }), run({ head_branch: "main" })];
        expect(ciSummary(runs, "main").state).toBe("passing");
        expect(ciSummary([], "main")).toBeNull();
        expect(ciSummary(undefined, "main")).toBeNull();
    });
});

describe("GitHub response shaping", () =>
{
    test("exposes only whitelisted, trimmed fields", () =>
    {
        const shaped = shapeRepoDetails({
            repo: { full_name: "o/r", html_url: "https://github.com/o/r", default_branch: "main", description: "d", private: true, open_issues_count: 3, token: "SECRET", owner: { email: "x@y.z" } },
            commits: [{ sha: "abcdef1234567", html_url: "cu", commit: { message: "Fix bug\n\nlong body", author: { name: "Ann", date: "d" } } }],
            pulls: [{ number: 7, title: "Add thing", user: { login: "bob" }, draft: true, html_url: "pu", updated_at: "d", body: "private text" }],
            runs: [{ name: "CI", status: "completed", conclusion: "success", head_branch: "main" }]
        });
        expect(shaped.repo.fullName).toBe("o/r");
        expect(shaped.repo.private).toBe(true);
        expect(shaped.commits[0].sha).toBe("abcdef1");
        expect(shaped.commits[0].message).toBe("Fix bug");
        expect(shaped.pulls[0].draft).toBe(true);
        expect(shaped.ci.state).toBe("passing");
        const json = JSON.stringify(shaped);
        expect(json).not.toContain("SECRET");
        expect(json).not.toContain("x@y.z");
        expect(json).not.toContain("private text");
    });

    test("caps list sizes and tolerates missing sections", () =>
    {
        const many = Array.from({ length: 30 }, (_, i) => ({ number: i, title: "t" }));
        expect(shapeRepoDetails({ repo: { default_branch: "main" }, commits: many, pulls: many, runs: [] }).pulls).toHaveLength(10);
        const empty = shapeRepoDetails({ repo: null, commits: undefined, pulls: null, runs: undefined });
        expect(empty.repo).toBeNull();
        expect(empty.commits).toHaveLength(0);
        expect(empty.ci).toBeNull();
    });
});

describe("GitHub error mapping", () =>
{
    test("gives distinct, safe messages", () =>
    {
        expect(githubError(401).status).toBe(401);
        expect(githubError(403, { "x-ratelimit-remaining": "0" }).status).toBe(429);
        expect(githubError(403, { "x-ratelimit-remaining": "42" }).status).toBe(403);
        expect(githubError(404).message).toMatch(/not found|no access/);
        expect(githubError(500).status).toBe(502);
    });
});
