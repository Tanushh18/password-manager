const { describe, test, before, after } = require("node:test");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const expect = require("./expect");
const { PhotoImportBatch: Batch, PhotoImportItem: Item } = require("../models/photoImport");
const { control } = require("../utils/photoImport");

describe("resuming a paused import", () => {
  let mongo;
  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
  });
  after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  test("a batch paused while choosing goes back to picking, not to an empty running batch", async () => {
    const userId = new mongoose.Types.ObjectId();
    const batch = await Batch.create({ userId, label: "Test", sourceConnectionId: "src", sessionId: "s1", status: "paused", pauseReason: "Google Photos permission was denied." });
    const after = await control(userId, String(batch._id), "resume");
    expect(after.status).not.toBe("running");
    expect(after.status).not.toBe("completed");
    expect(after.pauseReason).toBe("");
  });

  test("a paused batch that already has items resumes to running", async () => {
    const userId = new mongoose.Types.ObjectId();
    const batch = await Batch.create({ userId, label: "Test2", sourceConnectionId: "src", sessionId: "s2", status: "paused", pauseReason: "Paused by you." });
    await Item.create({ userId, batchId: batch._id, pickedId: "p1", seq: 0, status: "pending", data: "x" });
    const after = await control(userId, String(batch._id), "resume");
    expect(after.status).toBe("running");
  });
});
