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

const hitStore = require("../utils/hitStore");

test("hitStore counts within a window and starts over after it (memory fallback, no database)", async () => {
  const key = "t:" + Math.random();
  expect((await hitStore.hit(key, 1000, 1000)).count).toBe(1);
  expect((await hitStore.hit(key, 1000, 1500)).count).toBe(2);
  expect(await hitStore.peek(key, 1600)).toBe(2);
  expect((await hitStore.hit(key, 1000, 2500)).count).toBe(1); // window ended
  await hitStore.unhit(key);
  expect(await hitStore.peek(key, 2600)).toBe(0);
  await hitStore.hit(key, 1000, 3000);
  await hitStore.reset(key);
  expect(await hitStore.peek(key, 3001)).toBe(0);
});

test("persistent limiter blocks after max and sets Retry-After", async () => {
  const limiter = rateLimit({ max: 2, persistent: "unit" + Math.random() });
  const call = () => new Promise((resolve) => {
    const res = { headers: {}, set(k, v) { this.headers[k] = v; }, on() {}, status() { return this; }, json: () => resolve({ blocked: true, headers: res.headers }) };
    limiter({ ip: "9.9.9.9" }, res, () => resolve({ blocked: false }));
  });
  expect((await call()).blocked).toBe(false);
  expect((await call()).blocked).toBe(false);
  const third = await call();
  expect(third.blocked).toBe(true);
  expect(Number(third.headers["Retry-After"]) > 0).toBe(true);
});
