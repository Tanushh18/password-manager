const mongoose = require("mongoose");

/* One counter per rate-limit key. MongoDB removes a document by itself once `expireAt` has passed. */
const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  count: { type: Number, default: 0 },
  expireAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } }
}, { versionKey: false, collection: "rate_hits" });

module.exports = mongoose.models.RateHit || mongoose.model("RateHit", schema);
