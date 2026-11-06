const mongoose = require("mongoose");

// Who is OFFERED a new app version. One row per app ("where" = Stashr Location, "hub", "tv", "android" = the main Stashr app).
// rules[versionCode] = { mode: "all" | "selected" | "hold", devices: [device ids] } says what to do with that exact release;
// a release with no rule follows defaultMode ("all" = as before, "hold" = nobody until you decide).
const appRolloutSchema = new mongoose.Schema({
    app: { type: String, required: true, unique: true, enum: ["where", "hub", "tv", "android"] },
    defaultMode: { type: String, enum: ["all", "hold"], default: "all" },
    rules: { type: mongoose.Schema.Types.Mixed, default: {} },
    updatedAt: { type: Date, default: Date.now }
}, { minimize: false });

module.exports = mongoose.models.AppRollout || mongoose.model("AppRollout", appRolloutSchema);
