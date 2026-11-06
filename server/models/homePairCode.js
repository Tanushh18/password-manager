const mongoose = require("mongoose");

// A short code shown once on the Smart home page; a tablet or a family phone types it to join without your password.
const homePairCodeSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    codeHash: { type: String, required: true, unique: true },
    kind: { type: String, enum: ["hub", "phone"], required: true },
    name: { type: String, default: "" },
    tries: { type: Number, default: 0 },
    expires: { type: Date, required: true }
});
homePairCodeSchema.index({ expires: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.HomePairCode || mongoose.model("HomePairCode", homePairCodeSchema);
