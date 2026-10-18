const mongoose = require("mongoose");

/*
 * Google Photos -> Drive import. Items live in their own collection (a batch can hold 2,000 and a library 50,000,
 * far too many for the user document). Filenames and other personal details are sealed in `data` with the
 * account's data key; everything the pipeline filters or counts on is plain.
 */
const eventSchema = new mongoose.Schema({ at: { type: Date, default: Date.now }, level: { type: String, default: "info" }, message: String }, { _id: false });

const batchSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  label: { type: String, required: true },
  sourceConnectionId: { type: String, required: true },   // Google account that owns the photos
  folderId: { type: String, default: "" },                // Stashr folder the photos are filed into
  concurrency: { type: Number, default: 1 },              // items in flight for this batch (1 = strictly one after another)
  status: { type: String, default: "picking", index: true }, // picking | ready | running | paused | completed | cancelled | expired | failed
  pauseReason: { type: String, default: "" },
  sessionId: { type: String, default: "" },
  pickerUri: { type: String, default: "" },
  sessionExpires: { type: Date },
  lastPolled: { type: Date },
  counts: { total: { type: Number, default: 0 }, done: { type: Number, default: 0 }, failed: { type: Number, default: 0 }, skipped: { type: Number, default: 0 }, bytesDone: { type: Number, default: 0 }, bytesTotal: { type: Number, default: 0 } },
  events: { type: [eventSchema], default: [] },
  startedAt: Date,
  finishedAt: Date,
}, { timestamps: true, collection: "photo_import_batches" });

const itemSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  batchId: { type: mongoose.Schema.Types.ObjectId, required: true },
  pickedId: { type: String, required: true },
  seq: { type: Number, required: true },
  status: { type: String, default: "pending" },            // pending | downloading | uploading | verifying | done | failed | skipped
  attempts: { type: Number, default: 0 },
  notBefore: { type: Date, default: null },
  leaseUntil: { type: Date, default: null },
  owner: { type: String, default: "" },
  data: { type: String },                                  // sealed: filename, mimeType, type, createTime, width, height
  bytes: { type: Number, default: 0 },
  bytesDone: { type: Number, default: 0 },
  error: { type: String, default: "" },
  driveFileId: { type: String, default: "" },
  destinationConnectionId: { type: String, default: "" },
  mediaId: { type: String, default: "" },
  startedAt: Date,
  finishedAt: Date,
  stageAt: Date,
}, { timestamps: true, collection: "photo_import_items" });
itemSchema.index({ batchId: 1, status: 1, seq: 1 });
itemSchema.index({ batchId: 1, pickedId: 1 }, { unique: true });
itemSchema.index({ status: 1, leaseUntil: 1 });

module.exports = {
  PhotoImportBatch: mongoose.models.PhotoImportBatch || mongoose.model("PhotoImportBatch", batchSchema),
  PhotoImportItem: mongoose.models.PhotoImportItem || mongoose.model("PhotoImportItem", itemSchema),
};
