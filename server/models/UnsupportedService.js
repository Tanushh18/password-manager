const mongoose = require("mongoose");

/*
 * Services that users have (found automatically or mapped by hand) but whose usage Stashr cannot read yet because
 * no reader exists. One small document per service for the whole app, so the admin can see what to build next
 * without anyone scanning other people's servers. Holds the service name, variable NAMES and package names, and
 * one-way hashes of user ids (to count users). Never values, secrets, emails or service names.
 */
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  label: { type: String, default: "" },
  category: { type: String, default: "Other" },
  userHashes: { type: [String], default: [] },
  vars: { type: [String], default: [] },
  packages: { type: [String], default: [] },
  firstSeenAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now }
}, { versionKey: false });

module.exports = mongoose.model("unsupported-service", schema);
