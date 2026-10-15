const test = require("node:test");
const expect = require("./expect");
const T = require("../utils/telegramText");

test("commands are parsed, bot mentions stripped", () => {
  expect(T.parseCommand("/pass Gmail 1234")).toEqual({ cmd: "pass", args: ["Gmail", "1234"] });
  expect(T.parseCommand("/status@StashrBot")).toEqual({ cmd: "status", args: [] });
  expect(T.parseCommand("hello")).toEqual({ cmd: "", args: ["hello"] });
});

test("the digest is one short message: all OK, or the problems first", () => {
  const services = [{ key: "a:1", name: "api" }, { key: "a:2", name: "web" }, { key: "a:3", name: "old", suspended: true }];
  const ok = T.summarize({ services, health: new Map([["a:1", { state: "healthy" }], ["a:2", { state: "healthy" }]]) });
  expect(ok.problems.length).toBe(0);
  const okText = T.digestText(ok, { projects: 5, at: "2026-10-15T05:00:00Z" });
  expect(okText.startsWith("🟢 <b>Stashr · all OK</b>")).toBe(true);
  expect(okText.includes("Servers 2 running · 1 suspended · healthy 2/2")).toBe(true);
  const bad = T.summarize({ services, health: new Map([["a:1", { state: "unhealthy", status: 503 }]]), pings: { "a:2": { ok: false, status: 502 } }, incidents: [{ serviceName: "api", message: "x" }] });
  expect(bad.problems.map((p) => p.name + ":" + p.text)).toEqual(["api:down (HTTP 503)", "web:ping failed (HTTP 502)"]);
  expect(T.digestText(bad, {}).startsWith("🔴 <b>Stashr · 2 problems</b>")).toBe(true);
});

test("text is escaped and names are matched sensibly", () => {
  expect(T.esc("<b>&")).toBe("&lt;b&gt;&amp;");
  const items = [{ name: "Gmail" }, { name: "Gmail Work" }, { name: "GitHub", url: "https://github.com" }];
  expect(T.findByName(items, "gmail").map((i) => i.name)).toEqual(["Gmail"]);
  expect(T.findByName(items, "gm").map((i) => i.name)).toEqual(["Gmail", "Gmail Work"]);
  expect(T.findByName(items, "hub").map((i) => i.name)).toEqual(["GitHub"]);
  expect(T.projectText({ name: "A<b>", envVars: [{ name: "K", value: "SECRET" }] }).includes("SECRET")).toBe(false);
});
