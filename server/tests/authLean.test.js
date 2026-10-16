const { describe, test, before: beforeAll, after: afterAll } = require("node:test");
const expect = require("./expect");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");

process.env.SECRET_KEY = "test-secret";
process.env.CRYPTO_SECRET_KEY = "test-crypto-secret";

const User = require("../models/schema");
const authenticate = require("../middlewares/authenticate");

let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

const run = (token, originalUrl, method = "GET") => new Promise((resolve) => {
  const req = { originalUrl, method, headers: { authorization: "Bearer " + token }, cookies: {} };
  authenticate(req, { status() { return this; }, json: () => resolve(null), set() {} }, () => resolve(req.rootUser));
});

describe("authenticate loads only the monitoring histories a route reads", () => {
  test("lean by default, full where needed", async () => {
    const user = await new User({ name: "A", email: "a@b.co", password: "master-pass" }).save();
    const token = await user.generateAuthToken("web");
    const entry = { enc: "udk", data: "x", createdAt: new Date(), updatedAt: new Date() };
    await User.updateOne({ _id: user._id }, { $set: { renderIncidents: [entry], renderMetricHistory: [entry], renderAudit: [entry], usageHistory: [entry], passwords: [entry] } });

    const lean = await run(token, "/authenticate");
    expect(lean.passwords).toHaveLength(1);
    expect(lean.renderIncidents).toBeUndefined();
    expect(lean.renderMetricHistory).toBeUndefined();

    const accounts = await run(token, "/render/accounts/abc/services?x=1");
    expect(accounts.renderMetricHistory).toBeUndefined();

    const history = await run(token, "/render/ops/history?limit=5");
    expect(history.renderMetricHistory).toHaveLength(1);
    expect(history.renderIncidents).toBeUndefined();

    // Unlisted render routes and non-GET ops routes keep the full document.
    const full = await run(token, "/render/ops/incidents/resolve", "POST");
    expect(full.renderIncidents).toHaveLength(1);
    expect(full.renderAudit).toHaveLength(1);
    const post = await run(token, "/render/ops/config", "PUT");
    expect(post.renderIncidents).toHaveLength(1);
  });
});
