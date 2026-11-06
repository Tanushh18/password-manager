const mongoose = require("mongoose");

// A read-only key for a wall display (a TV). It can read the status board and nothing else, and can be revoked.
const wallTokenSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    label: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date },
    expires: { type: Date, required: true }
});
wallTokenSchema.index({ expires: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.WallToken || mongoose.model("WallToken", wallTokenSchema);
