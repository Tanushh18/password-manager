const { describe, test } = require("node:test");
const expect = require("./expect");
const { matchService, linkPatch } = require("../utils/projectLink");
const { projectHealth, openIncidentCount } = require("../utils/projectHealth");
const { planRegistrySync, applyRemovals } = require("../utils/registrySync");
const { shapeCompare } = require("../utils/github");

const svc = (id, name, repo, over = {}) => ({ id, name, repo, accountId: "a1", suspended: false, ...over });
const REPO = "https://github.com/Tanushh18/Deal_Radar";

describe("auto-linking a project to its Render service", () =>
{
    test("links when exactly one service uses the project's repo (any URL form)", () =>
    {
        const r = matchService({ repoUrl: "git@github.com:tanushh18/deal_radar.git", name: "x" }, [svc("s1", "api", REPO), svc("s2", "other", "https://github.com/o/r")]);
        expect(r.service.id).toBe("s1");
    });

    test("with several services on one repo, the hosting service name then project name decides", () =>
    {
        const services = [svc("s1", "dealradar-user", REPO), svc("s2", "dealradar-validator", REPO), svc("s3", "dealradar", REPO)];
        expect(matchService({ repoUrl: REPO, hostingServiceName: "dealradar-validator", name: "Deal Radar" }, services).service.id).toBe("s2");
        expect(matchService({ repoUrl: REPO, name: "DealRadar" }, services).service.id).toBe("s3");
    });

    test("never guesses: ambiguous or unmatched repos are not linked", () =>
    {
        const services = [svc("s1", "a", REPO), svc("s2", "b", REPO)];
        expect(matchService({ repoUrl: REPO, name: "zzz" }, services).ambiguous).toBe(2);
        expect(matchService({ repoUrl: "https://github.com/o/other", name: "a" }, services).none).toBe(true);
        expect(matchService({ name: "a" }, services).service.id).toBe("s1");
        expect(matchService({ name: "" }, services).none).toBe(true);
        expect(matchService({ name: "dup" }, [svc("s1", "dup", ""), svc("s2", "Dup", "")]).ambiguous).toBe(2);
    });

    test("hosting fields are filled only where the project has nothing and the link enables auto-sync", () =>
    {
        const service = svc("s1", "api", REPO, { region: "singapore", plan: "starter", branch: "main", url: "https://api.onrender.com" });
        const patch = linkPatch({ name: "P", hostingRegion: "mumbai", liveUrl: "" }, service, "Production");
        expect(patch.renderServiceId).toBe("s1");
        expect(patch.renderAutoSync).toBe("on");
        expect(patch.renderAutoLinked).toBe("yes");
        expect(patch.hostingRegion).toBeUndefined();
        expect(patch.hostingPlan).toBe("starter");
        expect(patch.liveUrl).toBe("https://api.onrender.com");
        expect(patch.repoUrl).toBe(REPO);
        expect(patch.hostingProvider).toBe("Render");
        expect(patch.hostingAccountLabel).toBe("Production");
    });
});

describe("project health score", () =>
{
    test("healthy when every known signal is fine, unknown when nothing is connected", () =>
    {
        const ok = projectHealth({ suspended: false, deployStatus: "live", ciState: "passing", driftStatus: "identical", behindBy: 0, openIncidents: 0 });
        expect(ok.level).toBe("green");
        expect(ok.score).toBe(100);
        expect(projectHealth({}).level).toBe("unknown");
        expect(projectHealth({}).score).toBeNull();
    });

    test("each problem lowers the score with a readable reason, worst first", () =>
    {
        const h = projectHealth({ suspended: false, deployStatus: "build_failed", ciState: "failing", ciBranch: "main", driftStatus: "ahead", behindBy: 3, branch: "main", openIncidents: 1 });
        expect(h.level).toBe("red");
        expect(h.reasons[0].severity).toBe("critical");
        expect(h.reasons.map((r) => r.text).join("|")).toContain("3 commits not deployed yet (main)");
        expect(h.reasons.map((r) => r.text).join("|")).toContain("CI is failing on main");
    });

    test("a single warning leaves the project amber-or-green, never red", () =>
    {
        expect(projectHealth({ suspended: true, deployStatus: "live" }).level).toBe("amber");
        expect(projectHealth({ driftStatus: "ahead", behindBy: 2, branch: "main" }).level).toBe("green");
        expect(projectHealth({ deployStatus: "update_failed" }).level).toBe("amber");
    });

    test("unavailable signals are skipped rather than guessed; CI running costs nothing", () =>
    {
        expect(projectHealth({ ciState: "running" }).score).toBe(100);
        expect(projectHealth({ autoSync: "on", envSyncAgeHours: 100 }).score).toBe(95);
        expect(projectHealth({ autoSync: "", envSyncAgeHours: 100 }).level).toBe("unknown");
    });

    test("counts only incidents whose latest event is still open", () =>
    {
        const list = [
            { groupId: "g", serviceKey: "a:1", type: "cpu", state: "open", at: "2026-01-01T00:00:00Z" },
            { groupId: "g", serviceKey: "a:1", type: "cpu", state: "resolved", at: "2026-01-01T01:00:00Z" },
            { groupId: "g", serviceKey: "a:1", type: "memory", state: "open", at: "2026-01-01T02:00:00Z" },
            { groupId: "g", serviceKey: "a:2", type: "memory", state: "open", at: "2026-01-01T02:00:00Z" }
        ];
        expect(openIncidentCount(list, "a:1")).toBe(1);
        expect(openIncidentCount(list, "a:9")).toBe(0);
        expect(openIncidentCount(undefined, "a:1")).toBe(0);
    });
});

describe("GitHub compare shaping (deploy drift)", () =>
{
    test("behindBy is the number of undeployed commits on the branch", () =>
    {
        const shaped = shapeCompare({ status: "ahead", ahead_by: 3, behind_by: 0, commits: [
            { sha: "1111111aaa", commit: { message: "one\nbody", author: { date: "d1" } }, html_url: "u1" },
            { sha: "2222222bbb", commit: { message: "two", author: { date: "d2" } } },
            { sha: "3333333ccc", commit: { message: "three", author: { date: "d3" } } }
        ] }, "main");
        expect(shaped.behindBy).toBe(3);
        expect(shaped.status).toBe("ahead");
        expect(shaped.commits[0].sha).toBe("3333333");
        expect(shaped.commits[2].message).toBe("one");
    });

    test("tolerates missing or odd payloads", () =>
    {
        expect(shapeCompare(null, "main")).toBeNull();
        expect(shapeCompare({ status: "weird" }, "main").status).toBe("unknown");
        expect(shapeCompare({ status: "identical", ahead_by: 0 }, "main").behindBy).toBe(0);
        expect(shapeCompare({ status: "ahead", ahead_by: -4 }, "main").behindBy).toBe(0);
    });
});

describe("Servers tab sync planning", () =>
{
    const live = (id, name, host, over = {}) => ({ id, name, repo: REPO, suspended: false, url: "https://" + host, accountName: "Prod", ...over });
    const services = [live("s1", "api-a", "api-a.onrender.com"), live("s2", "api-b", "api-b.onrender.com", { suspended: true }), live("s3", "api-c", "api-c.onrender.com")];

    test("matches Render URLs by host and leaves custom domains alone", () =>
    {
        const plan = planRegistrySync(["https://api-a.onrender.com", "https://dealradar.ggnhome.com", "https://ghost.onrender.com"], services);
        expect(plan.items.map((i) => i.kind).join(",")).toBe("render,external,unmatched");
        expect(plan.items[0].service.id).toBe("s1");
        expect(plan.remove).toHaveLength(0);
    });

    test("removes suspended Render URLs only while a working URL remains", () =>
    {
        expect(planRegistrySync(["https://api-a.onrender.com", "https://api-b.onrender.com"], services).remove.join(",")).toBe("https://api-b.onrender.com");
        expect(planRegistrySync(["https://api-b.onrender.com"], services).remove).toHaveLength(0);
        expect(planRegistrySync(["https://api-b.onrender.com", "https://custom.example.com"], services).remove.join(",")).toBe("https://api-b.onrender.com");
        expect(applyRemovals(["https://x", "https://y"], ["https://x", "https://y"]).join(",")).toBe("https://x,https://y");
        expect(applyRemovals(["https://x", "https://y"], ["https://x"]).join(",")).toBe("https://y");
    });

    test("suggests live sibling services of the same repo, keeping the app's path suffix, never automatically", () =>
    {
        const plan = planRegistrySync(["https://api-a.onrender.com/api"], services);
        expect(plan.add.map((a) => a.url).join(",")).toBe("https://api-c.onrender.com/api");
        expect(planRegistrySync(["https://api-a.onrender.com", "https://api-c.onrender.com"], services).add).toHaveLength(0);
        expect(planRegistrySync(["https://dealradar.ggnhome.com"], services).add).toHaveLength(0);
    });
});
