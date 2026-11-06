const mongoose = require("mongoose");

// One short-lived row per "approve this on my phone" request: a TV or laptop asks, a signed-in phone answers.
// Nothing here is a session: the asker only receives one after the phone approves, and only once.
const linkChallengeSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, index: true },   // public, goes in the QR code
    secretHash: { type: String, required: true },                      // SHA-256 of the asker's poll secret
    codeHash: { type: String, required: true },                        // SHA-256 of the QR code half (proves the phone saw the screen)
    purpose: { type: String, enum: ["login", "wall"], required: true },
    mode: { type: String, enum: ["qr", "push"], required: true },
    user: { type: mongoose.Schema.Types.ObjectId, index: true },       // set at start for "push", on approval for "qr"
    number: { type: String, default: "" },                             // two digits shown on the asker; the phone must pick the same
    label: { type: String, default: "" },
    ip: { type: String, default: "" },
    status: { type: String, enum: ["pending", "approved", "denied", "claimed"], default: "pending" },
    tries: { type: Number, default: 0 },
    expires: { type: Date, required: true }
});
linkChallengeSchema.index({ expires: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.LinkChallenge || mongoose.model("LinkChallenge", linkChallengeSchema);
