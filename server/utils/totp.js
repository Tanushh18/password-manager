const crypto = require("crypto");

/** RFC 6238 TOTP (SHA-1, 6 digits, 30s) for account two-factor login. */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const base32Encode = (buf) =>
{
    let bits = 0;
    let value = 0;
    let out = "";
    for (const byte of buf)
    {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5)
        {
            out += B32[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += B32[(value << (5 - bits)) & 31];
    return out;
};

const base32Decode = (text) =>
{
    const clean = String(text).toUpperCase().replace(/[^A-Z2-7]/g, "");
    let bits = 0;
    let value = 0;
    const out = [];
    for (const ch of clean)
    {
        value = (value << 5) | B32.indexOf(ch);
        bits += 5;
        if (bits >= 8)
        {
            out.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(out);
};

const generateSecret = () => base32Encode(crypto.randomBytes(20));

const codeAt = (secret, step) =>
{
    const msg = Buffer.alloc(8);
    msg.writeBigUInt64BE(BigInt(step));
    const h = crypto.createHmac("sha1", base32Decode(secret)).update(msg).digest();
    const o = h[h.length - 1] & 15;
    const bin = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
    return String(bin % 1e6).padStart(6, "0");
};

const currentStep = (now = Date.now()) => Math.floor(now / 30000);

/**
 * Checks a code with ±1 step of clock drift. Returns the matched step, or null.
 * Pass lastStep to reject a code that was already used (replay protection).
 */
const verify = (secret, code, lastStep = -1, now = Date.now()) =>
{
    const clean = String(code || "").replace(/\s/g, "");
    if (!/^\d{6}$/.test(clean)) return null;
    const step = currentStep(now);
    for (const s of [step - 1, step, step + 1])
    {
        if (s <= lastStep) continue;
        const expected = codeAt(secret, s);
        if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return s;
    }
    return null;
};

const otpauthUrl = (secret, account, issuer = "Aurelia") =>
    `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

const generateRecoveryCodes = (n = 10) =>
    Array.from({ length: n }, () =>
    {
        const raw = crypto.randomBytes(5).toString("hex"); // 10 hex chars
        return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });

const hashRecoveryCode = (code) =>
    crypto.createHash("sha256").update(String(code).trim().toLowerCase()).digest("hex");

module.exports = { generateSecret, verify, codeAt, currentStep, otpauthUrl, generateRecoveryCodes, hashRecoveryCode, base32Encode, base32Decode };
