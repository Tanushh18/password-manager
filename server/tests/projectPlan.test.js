const test = require("node:test");
const expect = require("./expect");
const { planAutoProjects } = require("../utils/projectPlan");
const { shape } = require("../utils/githubRepos");

const gh = (name, o = {}) => ({ key: "tanushh18/" + name.toLowerCase(), owner: "Tanushh18", name, url: "https://github.com/Tanushh18/" + name, description: "", language: "", archived: false, ...o });
const svc = (id, repoName, o = {}) => ({ id, name: id, repo: "https://github.com/Tanushh18/" + repoName, suspended: false, accountId: "acc1", ...o });

test("every GitHub repo becomes one project; repos you already track (by repo or by name) are skipped", () => {
  const plan = planAutoProjects({
    projects: [{ _id: "1", name: "Deal-Radar", repoUrl: "https://github.com/tanushh18/deal_radar.git" }, { _id: "2", name: "My Tasks" }],
    repos: [gh("Deal_Radar"), gh("Tasks"), gh("StreamHub", { description: "video", language: "JS" }), gh("OldRepo", { archived: true })]
  });
  expect(plan.create.map((p) => p.name)).toEqual(["Tasks", "StreamHub", "OldRepo"]); // "My Tasks" has no repo URL and a different name
});

test("a hand-made project with the same name (no repo URL) also counts as tracked", () => {
  const plan = planAutoProjects({ projects: [{ _id: "2", name: "stream-hub" }], repos: [gh("StreamHub")] });
  expect(plan.create.length).toBe(0);
});

test("new projects carry GitHub details, archived repos are archived, Render links and deployments are added", () => {
  const plan = planAutoProjects({
    repos: [gh("StreamHub", { description: "video", language: "JS" }), gh("Gone", { archived: true }), gh("Deal_Radar")],
    services: [svc("s1", "Deal_Radar"), svc("s2", "Deal_Radar", { suspended: true }), svc("s3", "Deal_Radar", { accountId: "acc2" })],
    accountName: (id) => "Account " + id
  });
  const by = Object.fromEntries(plan.create.map((p) => [p.name, p]));
  expect(by.StreamHub.description).toBe("video");
  expect(by.StreamHub.techStack).toBe("JS");
  expect(by.StreamHub.autoSource).toBe("github");
  expect(by.StreamHub.status).toBe("in_progress");
  expect(by.Gone.status).toBe("archived");
  expect(by.Deal_Radar.status).toBe("deployed");
  expect(by.Deal_Radar.renderServiceId).toBe("s1");
  expect(by.Deal_Radar.renderServices.map((s) => s.serviceId)).toEqual(["s1", "s2", "s3"]);
});

test("a repo that only runs on Render (no token sees it) still gets a project; suspended-only ones do not", () => {
  const plan = planAutoProjects({ repos: [], services: [svc("s1", "Other"), svc("s2", "Dead", { suspended: true })] });
  expect(plan.create.map((p) => p.name)).toEqual(["Other"]);
  expect(plan.create[0].autoSource).toBe("render");
});

test("only projects Stashr created are archived when their repo is gone, and only when every read was complete", () => {
  const projects = [
    { _id: "a", name: "A", repoUrl: "https://github.com/Tanushh18/A", autoSource: "github", status: "in_progress" },
    { _id: "b", name: "B", repoUrl: "https://github.com/Tanushh18/B", status: "in_progress" },
    { _id: "c", name: "C", repoUrl: "https://github.com/Tanushh18/C", autoSource: "github", status: "archived", autoStale: "yes" }
  ];
  const plan = planAutoProjects({ projects, repos: [gh("C")] });
  expect(plan.archive).toEqual(["a"]);
  expect(plan.revive).toEqual([{ id: "c", status: "in_progress" }]);
  expect(planAutoProjects({ projects, repos: [], complete: { github: false, render: true } }).archive).toEqual([]);
  expect(planAutoProjects({ projects, repos: [], complete: { github: true, render: false } }).archive).toEqual([]);
});

test("blank description / tech stack of an auto project is filled from GitHub, never overwritten", () => {
  const plan = planAutoProjects({
    projects: [{ _id: "a", name: "A", repoUrl: "https://github.com/Tanushh18/A", autoSource: "github", description: "mine" }],
    repos: [gh("A", { description: "from github", language: "Go" })]
  });
  expect(plan.fill).toEqual([{ id: "a", patch: { techStack: "Go" } }]);
});

test("GitHub repo payloads are reduced to the fields Stashr needs", () => {
  const r = shape({ full_name: "Tanushh18/Tasks", owner: { login: "Tanushh18" }, name: "Tasks", html_url: "https://github.com/Tanushh18/Tasks", description: null, language: "JS", archived: false, fork: true, private: true, pushed_at: "2026-10-01", token: "x" });
  expect(r.key).toBe("tanushh18/tasks");
  expect(r.description).toBe("");
  expect(r.private).toBe(true);
  expect(r.token).toBe(undefined);
});
