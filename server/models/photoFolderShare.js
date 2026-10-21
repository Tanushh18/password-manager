const mongoose = require("mongoose");

/* A folder shared read-only with another person, found by their email address (no email is sent). */
const schema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  ownerName: { type: String, default: "" },
  folderId: { type: String, required: true },
  folderName: { type: String, default: "" },
  recipientEmail: { type: String, required: true, lowercase: true, trim: true, index: true },
  allowDownload: { type: Boolean, default: false },
  revokedAt: { type: Date, default: null },
}, { timestamps: true, collection: "photo_folder_shares" });
schema.index({ ownerId: 1, folderId: 1, recipientEmail: 1 }, { unique: true });

module.exports = mongoose.models.PhotoFolderShare || mongoose.model("PhotoFolderShare", schema);
