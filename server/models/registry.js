const mongoose = require("mongoose");

// One row per app: the ordered list of backend URLs that app should use.
const registrySchema = new mongoose.Schema({
    app: { type: String, required: true, unique: true, index: true },
    urls: [{ type: String }],
    updatedAt: { type: Date, default: Date.now },
    updatedBy: { type: String },
    // Per-project lists (any slug that is not one of the built-in apps) belong to the account that created them.
    owner: { type: mongoose.Schema.Types.ObjectId, index: true },
    // Render sync (Servers tab): suspended Render URLs are dropped automatically while this is on.
    autoSync: { type: Boolean, default: true },
    syncLog: [{ at: Date, action: String, url: String, reason: String, _id: false }]
});

module.exports = mongoose.models.Registry || mongoose.model("Registry", registrySchema);
