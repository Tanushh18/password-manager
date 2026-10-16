const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

process.env.SECRET_KEY = "scheduler-status-test-secret";
process.env.CRYPTO_SECRET_KEY = "scheduler-status-test-crypto";
process.env.RATE_LIMIT_MAX = "1000";

const app = require("../app");
const User = require("../models/schema");
const SystemJobRun = require("../models/SystemJobRun");

let mongo;
before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test("authenticated scheduler status returns recent persisted runs without sensitive fields", async () => {
  const user = new User({ name: "Scheduler Test", email: "scheduler@example.com", password: "test-password" });
  await user.save();
  const login = await request(app).post("/login").send({ email: "scheduler@example.com", password: "test-password", client: "mobile" });
  assert.equal(login.status, 200);
  const token = login.body.token;
  await SystemJobRun.create({
    source: "internal",
    status: "partial",
    startedAt: new Date("2026-10-16T05:00:00.000Z"),
    completedAt: new Date("2026-10-16T05:00:02.000Z"),
    durationMs: 2000,
    steps: [
      { name: "pings", status: "success", durationMs: 300, counts: { ran: 2, errors: 0 } },
      { name: "monitoring", status: "partial", durationMs: 1700, counts: { usersChecked: 2, groupsChecked: 3, incidentsOpened: 0, errors: 1 } }
    ]
  });

  const response = await request(app).get("/render/ops/status").set({ Authorization: "Bearer " + token });
  assert.equal(response.status, 200);
  assert.equal(response.body.lastTick.status, "partial");
  assert.equal(response.body.recentRuns.length, 1);
  assert.equal(response.body.lastTick.steps[1].status, "partial");
  assert.equal(response.body.lastTick.steps[1].counts.errors, 1);
  assert.equal(response.body.schedulerIntervalMinutes >= 1, true);
  assert.equal(JSON.stringify(response.body).includes("test-secret"), false);
  assert.equal(JSON.stringify(response.body).includes("test-password"), false);
});
