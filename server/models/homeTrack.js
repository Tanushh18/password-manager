const mongoose = require("mongoose");

// A location fix kept for the family insights (places, trips, commute) when the owner turned "Keep location history" on.
// Only shown on the Stashr website and on the home tablet's own screen; deleted after 60 days, or at once from the website.
const homeTrackSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, required: true },
    phone: { type: mongoose.Schema.Types.ObjectId, required: true },
    person: { type: String, default: "" },
    at: { type: Date, required: true },
    lat: { type: Number, required: true },
    lon: { type: Number, required: true },
    acc: { type: Number, default: 0 },
    speed: { type: Number }
});
homeTrackSchema.index({ owner: 1, phone: 1, at: -1 });
homeTrackSchema.index({ at: 1 }, { expireAfterSeconds: 60 * 24 * 3600 });

module.exports = mongoose.models.HomeTrack || mongoose.model("HomeTrack", homeTrackSchema);
