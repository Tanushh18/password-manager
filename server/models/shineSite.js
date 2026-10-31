const mongoose = require("mongoose");

// One document ("shine") holding the ShineOne Estate website's project status.
const projectSchema = new mongoose.Schema({
    key: String, name: String, status: String, area: String, progress: Number, stage: String, eta: String
}, { _id: false });

const shineSiteSchema = new mongoose.Schema({
    _id: { type: String, default: "shine" },
    projects: { type: [projectSchema], default: [] },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.ShineSite || mongoose.model("ShineSite", shineSiteSchema);
