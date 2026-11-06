const mongoose = require("mongoose");

// One row per device that may sign in with a 4-digit MPIN. The MPIN alone is worth nothing: the device also holds a
// long random secret, given to it once when the MPIN was set up. Both are checked, and five wrong MPINs delete the row.
const mpinDeviceSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    deviceId: { type: String, required: true, unique: true, index: true },
    secretHash: { type: String, required: true },   // SHA-256 of the device secret (the secret is long and random)
    pinHash: { type: String, required: true },      // bcrypt of the MPIN
    label: { type: String, default: "" },
    fails: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date }
});

module.exports = mongoose.models.MpinDevice || mongoose.model("MpinDevice", mpinDeviceSchema);
