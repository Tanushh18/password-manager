const crypto = require("crypto");

/*
 * Sealed hand-offs between this server and its photo worker servers. A payload (Drive token, file id, ...) is
 * encrypted and authenticated with AES-256-GCM using the shared PHOTO_WORKER_SECRET and expires quickly,
 * so tokens never appear in a URL in the clear and a copied link stops working.
 */
const keyOf = (secret) => crypto.createHash("sha256").update(String(secret)).digest();

function seal(payload, secret, ttlSeconds = 600) {
  if (!secret) throw new Error("PHOTO_WORKER_SECRET is not set.");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyOf(secret), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify({ ...payload, exp: Date.now() + ttlSeconds * 1000 }), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** Returns the payload, or null when the blob is forged, damaged, expired or sealed with another secret. */
function open(blob, secret) {
  try {
    if (!secret) return null;
    const raw = Buffer.from(String(blob), "base64url");
    if (raw.length < 29) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", keyOf(secret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const payload = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8"));
    return payload.exp > Date.now() ? payload : null;
  } catch { return null; }
}

module.exports = { seal, open };
