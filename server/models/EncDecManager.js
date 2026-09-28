const crypto = require("crypto");

/**
 * Server-side encryption, used only for
 *   - legacy vault entries written by old clients (before end-to-end encryption), and
 *   - the 2FA secret (the server must read it to check codes).
 *
 * New writes use AES-256-GCM (authenticated). Old AES-256-CBC entries stay readable.
 */
const serverKey = () =>
{
    const secret = process.env.CRYPTO_SECRET_KEY || process.env.HASH_KEY;
    if (!secret) throw new Error("CRYPTO_SECRET_KEY (or HASH_KEY) is not set");
    return crypto.createHash("sha256").update(secret).digest();
};

/** Encrypts a JS value (via JSON) into the compact "gcm:iv:tag:ct" form. */
const sealJSON = (value) => seal(JSON.stringify(value));
const unsealJSON = (sealed) => JSON.parse(unseal(sealed));

// Returns { iv, encryptedPassword, tag } — tag is present for GCM.
const encrypt = (plain) =>
{
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", serverKey(), iv);
    let encrypted = cipher.update(String(plain), "utf8", "base64");
    encrypted += cipher.final("base64");
    return {
        iv: iv.toString("hex"),
        encryptedPassword: encrypted,
        tag: cipher.getAuthTag().toString("hex")
    };
};

const decrypt = (encrypted, ivHex, tagHex) =>
{
    const iv = Buffer.from(ivHex, "hex");

    if (tagHex)
    {
        const decipher = crypto.createDecipheriv("aes-256-gcm", serverKey(), iv);
        decipher.setAuthTag(Buffer.from(tagHex, "hex"));
        return decipher.update(encrypted, "base64", "utf8") + decipher.final("utf8");
    }

    // Legacy AES-256-CBC (16 byte IV, no tag)
    const decipher = crypto.createDecipheriv("aes-256-cbc", serverKey(), iv);
    return decipher.update(encrypted, "base64", "utf8") + decipher.final("utf8");
};

/* Compact string form for small secrets (2FA): "gcm:iv:tag:ct" */
const seal = (plain) =>
{
    const { iv, tag, encryptedPassword } = encrypt(plain);
    return `gcm:${iv}:${tag}:${encryptedPassword}`;
};

const unseal = (sealed) =>
{
    const [kind, iv, tag, ct] = String(sealed || "").split(":");
    if (kind !== "gcm") throw new Error("Unknown sealed format");
    return decrypt(ct, iv, tag);
};

/*
 * Envelope encryption for the vault: each user gets one random 256-bit data
 * key. Items are sealed with that key, not with CRYPTO_SECRET_KEY directly.
 * The data key itself is wrapped (encrypted) with CRYPTO_SECRET_KEY and
 * stored on the user document — CRYPTO_SECRET_KEY never touches item
 * ciphertext directly, so rotating a leaked user data key only means
 * re-wrapping one 32-byte value, not re-encrypting the whole vault.
 */
const generateDataKey = () => crypto.randomBytes(32);

/** Wraps a raw data key (Buffer) with the server key for storage. */
const wrapDataKey = (rawKey) => seal(rawKey.toString("base64"));

/** Unwraps a stored data key back into raw bytes. */
const unwrapDataKey = (wrapped) => Buffer.from(unseal(wrapped), "base64");

// Same "gcm:iv:tag:ct" scheme as encrypt/decrypt, but keyed by an explicit
// key (the unwrapped per-user data key) instead of always using serverKey().
const encryptWithKey = (keyBytes, plain) =>
{
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", keyBytes, iv);
    let encrypted = cipher.update(String(plain), "utf8", "base64");
    encrypted += cipher.final("base64");
    return `gcm:${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted}`;
};

const decryptWithKey = (keyBytes, sealed) =>
{
    const [kind, ivHex, tagHex, ct] = String(sealed || "").split(":");
    if (kind !== "gcm") throw new Error("Unknown sealed format");
    const decipher = crypto.createDecipheriv("aes-256-gcm", keyBytes, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return decipher.update(ct, "base64", "utf8") + decipher.final("utf8");
};

const sealJSONWithKey = (keyBytes, value) => encryptWithKey(keyBytes, JSON.stringify(value));
const unsealJSONWithKey = (keyBytes, sealed) => JSON.parse(decryptWithKey(keyBytes, sealed));

module.exports = {
    encrypt, decrypt, seal, unseal, sealJSON, unsealJSON,
    generateDataKey, wrapDataKey, unwrapDataKey,
    encryptWithKey, decryptWithKey, sealJSONWithKey, unsealJSONWithKey
};
