const mongoose = require("mongoose");

// One per account: where the money sheet is and how things are sorted. NO transactions are kept here — they live only in the
// owner's Google Sheet. What is stored: the sheet id, the owner's own category rules, and when the last SMS batch arrived.
const expenseSettingsSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
    sheetId: { type: String, default: "" },
    sheetUrl: { type: String, default: "" },
    tab: { type: String, default: "Transactions" },
    rules: { type: [mongoose.Schema.Types.Mixed], default: [] },       // [{ match: "swiggy", category: "Food" }]
    categories: { type: [String], default: [] },                      // extra categories the owner added
    startDate: { type: String, default: "" },                       // chosen once: SMS older than this are never read
    knownAccounts: { type: [String], default: [] },                  // account endings (X9229) seen on genuine messages
    lastArchiveDay: { type: String, default: "" },
    retentionMonths: { type: Number, default: 4 },
    lastSmsAt: { type: Number, default: 0 },                          // newest SMS time already handled (ms)
    lastSyncAt: { type: Date },
    lastStatement: { type: mongoose.Schema.Types.Mixed, default: null } // summary numbers of the last reconcile (no rows)
}, { minimize: false });

module.exports = mongoose.models.ExpenseSettings || mongoose.model("ExpenseSettings", expenseSettingsSchema);
