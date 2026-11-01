const mongoose = require("mongoose");

// A device that reports to Stashr Home: the TV launcher ("tv") or the always-on tablet ("hub").
// The device token is shown once when the device is added; only its SHA-256 is stored.
const commandSchema = new mongoose.Schema({
    id: { type: String, required: true },
    type: { type: String, required: true },
    args: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ["pending", "sent", "done", "failed"], default: "pending" },
    result: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
    doneAt: { type: Date }
}, { _id: false });

const homeDeviceSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    kind: { type: String, enum: ["tv", "hub"], required: true },
    // A device with its own token (the tablet). A TV that reports through the tablet has no token of its own.
    tokenHash: { type: String, unique: true, sparse: true },
    // Set on a device that reports through another one (the TV through the tablet).
    parent: { type: mongoose.Schema.Types.ObjectId, index: true },
    childKey: { type: String },
    tokenHint: { type: String, default: "" },
    status: { type: mongoose.Schema.Types.Mixed, default: {} },
    lastSeen: { type: Date },
    online: { type: Boolean, default: false },
    onlineSince: { type: Date },
    // Hub only: every device the tablet has seen on the Wi-Fi, keyed by address, with first/last seen.
    lanBook: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Hub only: names and rooms you gave to devices, keyed the same way.
    lanLabels: { type: mongoose.Schema.Types.Mixed, default: {} },
    commands: { type: [commandSchema], default: [] },
    createdAt: { type: Date, default: Date.now }
}, { minimize: false });

module.exports = mongoose.models.HomeDevice || mongoose.model("HomeDevice", homeDeviceSchema);
