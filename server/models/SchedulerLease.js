const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  owner: { type: String, required: true },
  leaseUntil: { type: Date, required: true },
  updatedAt: { type: Date, default: Date.now }
}, { versionKey: false, collection: "scheduler_leases" });

module.exports = mongoose.models.SchedulerLease || mongoose.model("SchedulerLease", schema);
