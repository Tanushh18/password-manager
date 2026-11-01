const mongoose = require("mongoose");

// What happened at home: the TV came online, a movie was added, a device joined the Wi-Fi.
const homeEventSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    device: { type: mongoose.Schema.Types.ObjectId, index: true },
    deviceName: { type: String, default: "" },
    kind: { type: String, required: true },
    text: { type: String, required: true, maxlength: 300 },
    at: { type: Date, default: Date.now }
});
homeEventSchema.index({ at: 1 }, { expireAfterSeconds: 60 * 24 * 3600 }); // keep 60 days

module.exports = mongoose.models.HomeEvent || mongoose.model("HomeEvent", homeEventSchema);
