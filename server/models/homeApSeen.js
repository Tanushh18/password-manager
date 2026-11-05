const mongoose = require("mongoose");

// Which Wi-Fi access point (BSSID) a family phone or the tablet was connected to, and when: how Stashr learns the zones of the house.
// One row per device and access point; the counters are bumped at most every 10 minutes. Gone 45 days after the last sighting.
const homeApSeenSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, required: true },
    device: { type: mongoose.Schema.Types.ObjectId, required: true },
    bssid: { type: String, required: true },
    ap: { type: String, required: true },          // the physical access point (a dual-band router has two BSSIDs): see utils/homeMap.apOf
    count: { type: Number, default: 0 },
    h: { type: mongoose.Schema.Types.Mixed, default: {} },   // sightings by UTC hour: { "0": n … "23": n }
    firstSeen: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now }
});
homeApSeenSchema.index({ owner: 1, device: 1, bssid: 1 }, { unique: true });
homeApSeenSchema.index({ lastSeen: 1 }, { expireAfterSeconds: 45 * 24 * 3600 });

// How often people walk from one zone to the next: the zones that are next to each other.
const homeApEdgeSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, required: true },
    a: { type: String, required: true },
    b: { type: String, required: true },
    count: { type: Number, default: 0 },
    lastSeen: { type: Date, default: Date.now }
});
homeApEdgeSchema.index({ owner: 1, a: 1, b: 1 }, { unique: true });
homeApEdgeSchema.index({ lastSeen: 1 }, { expireAfterSeconds: 45 * 24 * 3600 });

module.exports = {
    HomeApSeen: mongoose.models.HomeApSeen || mongoose.model("HomeApSeen", homeApSeenSchema),
    HomeApEdge: mongoose.models.HomeApEdge || mongoose.model("HomeApEdge", homeApEdgeSchema)
};
