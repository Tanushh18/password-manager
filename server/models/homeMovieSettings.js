const mongoose = require("mongoose");

// Which Google Drive folder feeds the TV's USB drive, through which of the account's Google connections.
const homeMovieSettingsSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
    connectionId: { type: String, default: "" },
    folderId: { type: String, default: "" },
    // Remove a movie from Drive once the TV has it on the USB drive. Off until you turn it on, because it deletes.
    deleteAfterSync: { type: Boolean, default: false },
    lastDelete: { at: Date, name: String, error: String }
});

module.exports = mongoose.models.HomeMovieSettings || mongoose.model("HomeMovieSettings", homeMovieSettingsSchema);
