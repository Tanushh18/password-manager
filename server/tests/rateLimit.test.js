const test = require("node:test");
const expect = require("./expect");
const rateLimit = require("../middlewares/rateLimit");

const run = (limiter, status) => new Promise((resolve) => {
  const handlers = {};
  const res = { statusCode: status, set() {}, on: (e, f) => { handlers[e] = f; }, status(c) { this.statusCode = c; return this; }, json: () => resolve("blocked") };
  limiter({ ip: "1.1.1.1" }, res, () => { handlers.finish?.(); resolve("passed"); });
});

test("skipSuccessful: successful logins never use up the limit, failures do", async () => {
  const ok = rateLimit({ max: 2, skipSuccessful: true });
  for (let i = 0; i < 5; i++) expect(await run(ok, 200)).toBe("passed");
  const bad = rateLimit({ max: 2, skipSuccessful: true });
  expect(await run(bad, 400)).toBe("passed");
  expect(await run(bad, 400)).toBe("passed");
  expect(await run(bad, 400)).toBe("blocked");
});
