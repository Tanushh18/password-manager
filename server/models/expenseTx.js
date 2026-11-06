const mongoose = require("mongoose");

// One transaction in "Stashr storage" mode (the default). Everything that says what was bought, from whom, or how much is inside `enc`,
// sealed with the account's own data key (the same envelope encryption as the vault). Only what the list needs to find rows stays
// readable: the month, the date, the status, and a keyed hash of the reference (to skip duplicates without storing the number).
// Entries are deleted by the database 120 days after their date (the 4-month rule): `expireAt` with a TTL index.
const expenseTxSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, required: true },
    month: { type: String, required: true },          // YYYY-MM
    date: { type: String, required: true },           // YYYY-MM-DD
    status: { type: String, default: "Unverified" },
    refHash: { type: String, required: true },        // HMAC-SHA256 under the account's data key
    enc: { type: String, required: true },            // "gcm:iv:tag:ciphertext" of the rest of the fields
    expireAt: { type: Date, required: true }
});
expenseTxSchema.index({ owner: 1, refHash: 1 }, { unique: true });
expenseTxSchema.index({ owner: 1, month: 1 });
expenseTxSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.ExpenseTx || mongoose.model("ExpenseTx", expenseTxSchema);
