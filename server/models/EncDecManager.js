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
    const secret = process.env.CRYPTO_SECRET_KEY;
    if (!secret) throw new Error("CRYPTO_SECRET_KEY is not set");
    return crypto.createHash("sha256").update(secret).digest();
};

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

module.exports = { encrypt, decrypt, seal, unseal };
