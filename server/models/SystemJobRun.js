const mongoose = require("mongoose");

const stepSchema = new mongoose.Schema({
  name: { type: String, required: true, maxlength: 40 },
  status: { type: String, enum: ["success", "partial", "failed"], required: true },
  durationMs: { type: Number, min: 0, default: 0 },
  counts: {
    usersChecked: { type: Number, min: 0 },
    groupsChecked: { type: Number, min: 0 },
    incidentsOpened: { type: Number, min: 0 },
    ran: { type: Number, min: 0 },
    errors: { type: Number, min: 0 }
  }
}, { _id: false });

const schema = new mongoose.Schema({
  source: { type: String, enum: ["internal", "external"], required: true, index: true },
  status: { type: String, enum: ["success", "partial", "failed"], required: true, index: true },
  startedAt: { type: Date, required: true, index: true },
  completedAt: { type: Date, required: true },
  durationMs: { type: Number, min: 0, required: true },
  steps: { type: [stepSchema], default: [] }
}, { versionKey: false });

schema.index({ startedAt: -1 });

module.exports = mongoose.models.SystemJobRun || mongoose.model("SystemJobRun", schema);
