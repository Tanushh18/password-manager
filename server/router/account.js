const express = require("express");
const router = express.Router();
const User = require("../models/schema");
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");
const totp = require("../utils/totp");
const { seal, unseal } = require("../models/EncDecManager");
const {
    COOKIE_OPTIONS, COOKIE_MAX_AGE, str, raw, isBlob, validKdf, wantsToken,
    checkPassword, checkSecondFactor, serverError
} = require("./helpers");

const sensitiveLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, message: "Too many attempts. Please wait a few minutes." });

/* Verifies the master password (and 2FA when on) for sensitive actions. */
const reauth = async (req, res, user) =>
{
    if (!(await checkPassword(user, req.body.password ?? req.body.currentPassword)))
    {
        res.status(400).json({ error: "Your master password is incorrect." });
        return false;
    }
    if (user.twoFactor && user.twoFactor.enabled && !checkSecondFactor(user, req.body.code))
    {
        await user.save();
        res.status(401).json({ error: "Enter a valid authenticator or recovery code.", twoFactorRequired: true });
        return false;
    }
    return true;
};

/* ════════════════ PROFILE ════════════════ */

router.post("/account/profile", authenticate, async (req, res) =>
{
    const name = str(req.body.name);
    if (name.length < 1 || name.length > 80) return res.status(400).json({ error: "Enter a name." });
    try
    {
        await User.updateOne({ _id: req.rootUser._id }, { $set: { name } });
        return res.status(200).json({ name });
    }
    catch (error)
    {
        return serverError(res, "account/profile", error);
    }
});

/* ════════════════ CHANGE MASTER PASSWORD ════════════════
   The client re-derives a new key and re-encrypts every item, then sends
   everything in one request so the change is all-or-nothing. */

router.post("/account/password", authenticate, sensitiveLimiter, async (req, res) =>
{
    const newPassword = raw(req.body.newPassword);
    const { kdf, keyCheck } = req.body;
    const items = Array.isArray(req.body.items) ? req.body.items : null;

    if (newPassword.length < 8) return res.status(400).json({ error: "Use at least 8 characters for your new master password." });
    if (!validKdf(kdf) || !isBlob(keyCheck) || !items || !items.every((i) => i && i.id && isBlob(i.data)))
    {
        return res.status(400).json({ error: "Invalid request." });
    }

    try
    {
        const user = await User.findById(req.rootUser._id);
        if (!(await reauth(req, res, user))) return undefined;

        // Every entry must be re-encrypted with the new key, no more, no less.
        const current = new Set(user.passwords.map((p) => String(p._id)));
        const sent = new Set(items.map((i) => String(i.id)));
        if (current.size !== sent.size || [...current].some((id) => !sent.has(id)))
        {
            return res.status(409).json({ error: "Your vault changed while updating. Please try again.", code: "VAULT_CHANGED" });
        }

        const now = new Date();
        items.forEach(({ id, data }) =>
        {
            const entry = user.passwords.id(id);
            entry.enc = "e2e";
            entry.data = data;
            entry.password = undefined;
            entry.iv = undefined;
            entry.tag = undefined;
            entry.platform = undefined;
            entry.platEmail = undefined;
            entry.updatedAt = entry.updatedAt || now;
        });
        user.kdf = { salt: kdf.salt, iterations: kdf.iterations };
        user.keyCheck = keyCheck;
        user.password = newPassword; // hashed by the pre-save hook
        user.cpassword = undefined;
        user.tokens = []; // sign out every other device

        await user.save();
        const client = wantsToken(req) ? "mobile" : "web";
        const token = await user.generateAuthToken(client);
        res.cookie("jwtoken", token, { ...COOKIE_OPTIONS, expires: new Date(Date.now() + COOKIE_MAX_AGE) });

        const body = { message: "Master password changed. Other devices were signed out.", vault: user.toPublic().vault };
        if (client === "mobile") body.token = token;
        return res.status(200).json(body);
    }
    catch (error)
    {
        return serverError(res, "account/password", error);
    }
});

/* ════════════════ SESSIONS ════════════════ */

router.post("/account/logout-all", authenticate, async (req, res) =>
{
    try
    {
        // Keep only the current session.
        await User.updateOne({ _id: req.rootUser._id }, { $pull: { tokens: { token: { $ne: req.token } } } });
        return res.status(200).json({ message: "Signed out of every other device." });
    }
    catch (error)
    {
        return serverError(res, "account/logout-all", error);
    }
});

/* ════════════════ DELETE ACCOUNT ════════════════ */

router.post("/account/delete", authenticate, sensitiveLimiter, async (req, res) =>
{
    try
    {
        const user = await User.findById(req.rootUser._id);
        if (!(await reauth(req, res, user))) return undefined;
        await User.deleteOne({ _id: user._id });
        res.clearCookie("jwtoken", COOKIE_OPTIONS);
        return res.status(200).json({ message: "Your account and vault were deleted." });
    }
    catch (error)
    {
        return serverError(res, "account/delete", error);
    }
});

/* ════════════════ TWO-FACTOR (TOTP) ════════════════ */

router.post("/2fa/setup", authenticate, sensitiveLimiter, async (req, res) =>
{
    try
    {
        const user = await User.findById(req.rootUser._id);
        if (user.twoFactor && user.twoFactor.enabled) return res.status(409).json({ error: "Two-factor login is already on." });
        if (!(await checkPassword(user, req.body.password))) return res.status(400).json({ error: "Your master password is incorrect." });

        const secret = totp.generateSecret();
        user.set("twoFactor.enabled", false);
        user.set("twoFactor.pendingSecret", seal(secret));
        await user.save();
        return res.status(200).json({ secret, otpauthUrl: totp.otpauthUrl(secret, user.email) });
    }
    catch (error)
    {
        return serverError(res, "2fa/setup", error);
    }
});

router.post("/2fa/enable", authenticate, sensitiveLimiter, async (req, res) =>
{
    try
    {
        const user = await User.findById(req.rootUser._id);
        if (!user.twoFactor || !user.twoFactor.pendingSecret) return res.status(400).json({ error: "Start two-factor setup first." });

        const secret = unseal(user.twoFactor.pendingSecret);
        const step = totp.verify(secret, req.body.code);
        if (step === null) return res.status(400).json({ error: "That code didn't match. Check your phone's clock and try the newest code." });

        const codes = totp.generateRecoveryCodes();
        user.twoFactor = {
            enabled: true,
            secret: seal(secret),
            pendingSecret: undefined,
            lastStep: step,
            recoveryCodes: codes.map(totp.hashRecoveryCode)
        };
        await user.save();
        return res.status(200).json({ message: "Two-factor login is on.", recoveryCodes: codes });
    }
    catch (error)
    {
        return serverError(res, "2fa/enable", error);
    }
});

router.post("/2fa/disable", authenticate, sensitiveLimiter, async (req, res) =>
{
    try
    {
        const user = await User.findById(req.rootUser._id);
        if (!user.twoFactor || !user.twoFactor.enabled) return res.status(400).json({ error: "Two-factor login is already off." });
        if (!(await reauth(req, res, user))) return undefined;
        user.twoFactor = { enabled: false, lastStep: -1, recoveryCodes: [] };
        await user.save();
        return res.status(200).json({ message: "Two-factor login is off." });
    }
    catch (error)
    {
        return serverError(res, "2fa/disable", error);
    }
});

router.post("/2fa/recovery-codes", authenticate, sensitiveLimiter, async (req, res) =>
{
    try
    {
        const user = await User.findById(req.rootUser._id);
        if (!user.twoFactor || !user.twoFactor.enabled) return res.status(400).json({ error: "Turn on two-factor login first." });
        if (!(await reauth(req, res, user))) return undefined;
        const codes = totp.generateRecoveryCodes();
        user.twoFactor.recoveryCodes = codes.map(totp.hashRecoveryCode);
        await user.save();
        return res.status(200).json({ recoveryCodes: codes });
    }
    catch (error)
    {
        return serverError(res, "2fa/recovery-codes", error);
    }
});

module.exports = router;
