const mongoose = require("mongoose");

// The last 24 hours of a family phone's position, kept only for the phones that have a place (Office...) with an automation, so the
// Automations page can show how far the phone was and why a "Leaving office" message did or did not go.
// Deleted by the database 24 hours after each point; nothing older is ever kept. (The optional "Keep location history" is separate.)
const homePlaceFixSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, required: true },
    phone: { type: mongoose.Schema.Types.ObjectId, required: true },
    at: { type: Date, required: true },
    lat: { type: Number, required: true },
    lon: { type: Number, required: true },
    acc: { type: Number, default: 0 },
    same: { type: Boolean, default: false }       // a "still here" check-in: the phone did not send new coordinates
});
homePlaceFixSchema.index({ owner: 1, phone: 1, at: -1 });
homePlaceFixSchema.index({ at: 1 }, { expireAfterSeconds: 24 * 3600 });

module.exports = mongoose.models.HomePlaceFix || mongoose.model("HomePlaceFix", homePlaceFixSchema);
