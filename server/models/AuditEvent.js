const mongoose = require("mongoose");

/* Security-relevant account events (sign-in, password change, session revoked...). Kept 180 days, then removed by MongoDB. */
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  at: { type: Date, default: Date.now, index: { expireAfterSeconds: 180 * 24 * 3600 } },
  action: { type: String, required: true, maxlength: 60 },
  ip: { type: String, maxlength: 64 },
  device: { type: String, maxlength: 160 },
  detail: { type: String, maxlength: 200 }
}, { versionKey: false, collection: "audit_events" });

module.exports = mongoose.models.AuditEvent || mongoose.model("AuditEvent", schema);
