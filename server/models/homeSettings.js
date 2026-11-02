const mongoose = require("mongoose");

// One per account: the Smart home automations (alerts, TV schedules and limits, scenes, briefs, camera, slideshow).
const homeSettingsSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
    timezone: { type: String, default: "Asia/Kolkata" },
    alerts: {
        newDevice: { type: Boolean, default: true },     // a device the Wi-Fi has never seen
        night: { type: Boolean, default: true },         // a device joins during the night window
        nightFrom: { type: String, default: "00:00" },
        nightTo: { type: String, default: "05:00" },
        emptyHomeTv: { type: Boolean, default: true },   // nobody is home and the TV is on
        camera: { type: Boolean, default: true },        // the tablet camera saw movement
        presence: { type: Boolean, default: false }      // someone came home or left
    },
    weather: { city: { type: String, default: "" }, lat: Number, lon: Number },
    brief: { enabled: { type: Boolean, default: false }, time: { type: String, default: "08:00" }, lastSent: { type: String, default: "" } },
    weekly: { enabled: { type: Boolean, default: false }, lastSent: { type: String, default: "" } },
    tvLimit: {
        minutes: { type: Number, default: 0 },           // 0: no limit
        action: { type: String, enum: ["notify", "pause", "home"], default: "home" },
        lastEnforced: { type: String, default: "" },
        lateNight: { type: Boolean, default: true },     // tell you when the TV is still on late at night
        lateNightNotified: { type: String, default: "" }
    },
    // TV minutes per day, by app: { "2026-11-02": { minutes: 95, apps: { Netflix: 60, YouTube: 35 } } }. 35 days kept.
    usage: { type: mongoose.Schema.Types.Mixed, default: {} },
    schedules: { type: [mongoose.Schema.Types.Mixed], default: [] },
    scenes: { type: [mongoose.Schema.Types.Mixed], default: [] },
    slideshowFolder: { type: String, default: "" },
    camera: { sensitivity: { type: Number, default: 5 }, video: { type: Boolean, default: true }, auto: { type: Boolean, default: false }, autoState: { type: mongoose.Schema.Types.Mixed, default: {} } },
    // Places: a family phone arrives at / leaves a spot, and the tablet sends a WhatsApp message to a group.
    places: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // Where home is, for "Papa is 10 minutes away" (the phones' location shared with Stashr Hub).
    homeSpot: { lat: Number, lon: Number, radius: { type: Number, default: 200 } },
    eta: { enabled: { type: Boolean, default: true }, maxKm: { type: Number, default: 40 }, notifyMinutes: { type: Number, default: 15 }, toTablet: { type: Boolean, default: true }, toTv: { type: Boolean, default: true }, toPhones: { type: Boolean, default: true } },
    locationCode: { type: String, default: "", index: true },
    etaState: { type: mongoose.Schema.Types.Mixed, default: {} },
    emptyHomeNotifiedAt: { type: Date },
    presenceState: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { minimize: false });

module.exports = mongoose.models.HomeSettings || mongoose.model("HomeSettings", homeSettingsSchema);
