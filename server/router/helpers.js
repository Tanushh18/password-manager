const bcrypt = require("bcrypt");
const User = require("../models/schema");
const totp = require("../utils/totp");
const { unseal } = require("../models/EncDecManager");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const BLOB_RE = /^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/;
const MAX_BLOB = 64 * 1024;

const COOKIE_OPTIONS = {
    httpOnly: true,
    secure: true,
    sameSite: "None",
    path: "/"
};
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const str = (value) => (typeof value === "string" ? value.trim() : "");
const raw = (value) => (typeof value === "string" ? value : "");

// Exact match first; older accounts may have been stored with mixed case.
const findByEmail = async (email) =>
    (await User.findOne({ email })) ||
    (await User.findOne({ email: new RegExp(`^${escapeRegex(email)}$`, "i") }));

const isBlob = (value) => typeof value === "string" && value.length <= MAX_BLOB && BLOB_RE.test(value);

const validKdf = (kdf) =>
    kdf && typeof kdf.salt === "string" && B64_RE.test(kdf.salt) && kdf.salt.length >= 16 && kdf.salt.length <= 64 &&
    Number.isInteger(kdf.iterations) && kdf.iterations >= 100000 && kdf.iterations <= 5000000;

const wantsToken = (req) =>
    req.body.client === "mobile" || String(req.headers["x-client"] || "").toLowerCase() === "mobile";

const checkPassword = (user, password) => bcrypt.compare(raw(password), user.password || "");

/**
 * Verifies a 2FA code or a one-time recovery code. Mutates the user (marks the
 * step / consumes the recovery code) — caller must save.
 */
const checkSecondFactor = (user, code) =>
{
    if (!user.twoFactor || !user.twoFactor.enabled) return true;
    const clean = str(code);
    if (!clean) return false;

    if (/^\d{6}$/.test(clean.replace(/\s/g, "")))
    {
        const step = totp.verify(unseal(user.twoFactor.secret), clean, user.twoFactor.lastStep ?? -1);
        if (step === null) return false;
        user.twoFactor.lastStep = step;
        return true;
    }

    const hash = totp.hashRecoveryCode(clean);
    const list = user.twoFactor.recoveryCodes || [];
    const index = list.indexOf(hash);
    if (index === -1) return false;
    list.splice(index, 1);
    user.twoFactor.recoveryCodes = list;
    return true;
};

const serverError = (res, where, error) =>
{
    console.error(`${where} failed:`, error.message);
    return res.status(500).json({ error: "There was an internal error. Sorry for the inconvenience." });
};

module.exports = {
    EMAIL_RE, COOKIE_OPTIONS, COOKIE_MAX_AGE, str, raw, findByEmail, isBlob, validKdf,
    wantsToken, checkPassword, checkSecondFactor, serverError
};
