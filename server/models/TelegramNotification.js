const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  category: { type: String, required: true, index: true },
  title: { type: String, default: "", maxlength: 120 },
  body: { type: String, required: true, maxlength: 4000 },
  dedupeKey: { type: String, default: undefined, maxlength: 160 },
  status: { type: String, enum: ["pending","sent","failed"], default: "pending", index: true },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  lastError: { type: String, default: "", maxlength: 120 },
  sentAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now, expires: 30 * 24 * 3600 }
}, { versionKey: false, collection: "telegram_notifications" });
schema.index({ owner: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } });
schema.index({ owner: 1, status: 1, nextAttemptAt: 1, createdAt: 1 });
module.exports = mongoose.models.TelegramNotification || mongoose.model("TelegramNotification", schema);
