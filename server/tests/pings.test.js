const test = require("node:test");
const expect = require("./expect");
const { defaultJobs } = require("../utils/pings");

test("every running web service gets a 10-minute /health ping unless it has its own job", () => {
  const services = [
    { id: "s1", name: "api", accountId: "a", url: "https://api.onrender.com/", type: "web_service" },
    { id: "s2", name: "old", accountId: "a", url: "https://old.onrender.com", suspended: true, type: "web_service" },
    { id: "s3", name: "job", accountId: "a", url: "", type: "cron_job" },
    { id: "s4", name: "paused", accountId: "a", url: "https://paused.onrender.com", type: "web_service" },
    { id: "s5", name: "site", accountId: "b", url: "https://site.onrender.com", type: "static_site" }
  ];
  const jobs = defaultJobs(services, [{ serviceKey: "a:s4", enabled: false }]);
  expect(jobs.map((j) => [j.serviceKey, j.url, j.path, j.everyMinutes, j.auto])).toEqual([
    ["a:s1", "https://api.onrender.com", "/health", 10, true]
  ]); // the static site is a client: it never sleeps and is not pinged
});

test("health details keep safe primitives and drop secret-looking keys", () => {
  const { safeDetails } = require("../utils/pings");
  const out = safeDetails(JSON.stringify({ status: "ok", uptime: 12, dbPassword: "x", db: { connected: true, uri: "mongodb://u:p@h" }, list: [1] }));
  expect(out).toEqual({ status: "ok", uptime: 12, "db.connected": true });
  expect(safeDetails("<html>")).toBe(null);
});
