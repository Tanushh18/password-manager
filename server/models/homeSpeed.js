const mongoose = require("mongoose");

// One internet speed test run by the tablet. Kept 90 days, so you can show your provider a slow week.
const homeSpeedSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    device: { type: mongoose.Schema.Types.ObjectId },
    at: { type: Date, default: Date.now },
    down: { type: Number, default: 0 },   // Mbit/s
    up: { type: Number, default: 0 },     // Mbit/s
    ping: { type: Number, default: 0 },   // ms
    server: { type: String, default: "" }
});
homeSpeedSchema.index({ at: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

module.exports = mongoose.models.HomeSpeed || mongoose.model("HomeSpeed", homeSpeedSchema);
