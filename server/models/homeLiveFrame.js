const mongoose = require("mongoose");

// The newest frame of the tablet camera's live view, one per tablet. Kept in the database (not memory) because the
// tablet and the web page may talk to different Stashr servers. Frames older than a few minutes are dropped.
const homeLiveFrameSchema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId },   // the tablet's device id
    owner: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    at: { type: Date, default: Date.now },
    data: { type: Buffer, required: true }
});
homeLiveFrameSchema.index({ at: 1 }, { expireAfterSeconds: 10 * 60 });

module.exports = mongoose.models.HomeLiveFrame || mongoose.model("HomeLiveFrame", homeLiveFrameSchema);
