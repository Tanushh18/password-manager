const mongoose = require("mongoose");

// A sector / area added from Stashr (or the Tasks app) on top of the built-in ones. Its photos live in
// the ShineOne Cloudinary folder named by `key`.
const shineSectorSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    label: { type: String, required: true },
    tag: { type: String, required: true },
    createdBy: { type: String },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.ShineSector || mongoose.model("ShineSector", shineSectorSchema);
