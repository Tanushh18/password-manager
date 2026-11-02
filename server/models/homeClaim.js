const mongoose = require("mongoose");

// Several Stashr servers share one database and each runs the Home sweep. A job for one minute (a TV schedule, the
// morning brief) is claimed by inserting its id here; only the server whose insert wins runs it.
const homeClaimSchema = new mongoose.Schema({ _id: { type: String }, at: { type: Date, default: Date.now } });
homeClaimSchema.index({ at: 1 }, { expireAfterSeconds: 3 * 24 * 3600 });

module.exports = mongoose.models.HomeClaim || mongoose.model("HomeClaim", homeClaimSchema);
