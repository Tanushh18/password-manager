const test = require("node:test");
const expect = require("./expect");
const { isPublicHttps, normalizePings } = require("../utils/renderOps");

test("ping URLs: any public https host is allowed, local and private addresses are not", () => {
  for (const ok of ["https://api-x.onrender.com", "https://api.example.com", "https://stashr.tanush.qd.je/"]) expect(isPublicHttps(new URL(ok))).toBe(true);
  for (const bad of ["http://api.example.com", "https://localhost", "https://127.0.0.1", "https://10.0.0.5", "https://192.168.1.2", "https://169.254.169.254", "https://u:p@api.example.com", "https://db.internal", "https://[::1]", "https://intranet"])
    expect(isPublicHttps(new URL(bad))).toBe(false);
  const jobs = normalizePings([{ serviceKey: "a:b", url: "https://my.domain.com/x", path: "/up" }, { serviceKey: "a:c", url: "https://10.1.1.1" }]);
  expect(jobs.map((j) => j.url)).toEqual(["https://my.domain.com"]);
});
