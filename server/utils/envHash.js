const crypto = require("crypto");

/** One-way fingerprint of a value, so Stashr can tell whether Render's value changed without storing a second copy. */
const hashValue = (value) => crypto.createHash("sha256").update(String(value ?? "")).digest("hex");

module.exports = { hashValue };
