const mongoose = require("mongoose");

// One row per (app, day, visitor): who asked the Stashr registry for an app's server list. Visitors are stored as a salted
// hash only (never the IP or device), and rows expire after 90 days.
const registryVisitSchema = new mongoose.Schema({
    app: { type: String, required: true },
    day: { type: String, required: true }, // YYYY-MM-DD (UTC)
    visitor: { type: String, required: true },
    hits: { type: Number, default: 1 },
    firstAt: { type: Date, default: Date.now },
    lastAt: { type: Date, default: Date.now, index: { expireAfterSeconds: 90 * 24 * 60 * 60 } }
});
registryVisitSchema.index({ app: 1, day: 1, visitor: 1 }, { unique: true });

module.exports = mongoose.models.RegistryVisit || mongoose.model("RegistryVisit", registryVisitSchema);
