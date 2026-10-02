const mongoose = require("mongoose");

// One row per app: the ordered list of backend URLs that app should use.
const registrySchema = new mongoose.Schema({
    app: { type: String, required: true, unique: true, index: true },
    urls: [{ type: String }],
    updatedAt: { type: Date, default: Date.now },
    updatedBy: { type: String }
});

module.exports = mongoose.models.Registry || mongoose.model("Registry", registrySchema);
