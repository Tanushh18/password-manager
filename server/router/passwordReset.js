const express = require("express");
const router = express.Router();
const User = require("../models/schema");
const rateLimit = require("../middlewares/rateLimit");
const { str, raw, findByEmail, checkSecondFactor, EMAIL_RE, serverError } = require("./helpers");
const { sendMail, mailConfigured } = require("../utils/mailer");
const reset = require("../utils/resetCode");

/*
 * Forgot password: a 6-digit code by email (Brevo), valid 10 minutes, 5 tries. The vault is encrypted with the
 * account's data key (wrapped by the server key), not with the password, so nothing is lost on a reset. When
 * two-factor login is on, the authenticator (or a recovery code) is still required. Responses never reveal
 * whether an email has an account.
 */
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: "Too many attempts. Please wait a few minutes." });
const GENERIC = "If that email has a Stashr account, a 6-digit code is on its way. It is valid for 10 minutes.";

router.post("/forgot-password", limiter, async (req, res) => {
  const email = str(req.body.email).toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (!mailConfigured()) return res.status(503).json({ error: "Password reset by email is not set up on this server yet." });
  try {
    const user = await findByEmail(email);
    if (user) {
      const allowed = reset.canSend(user.passwordReset);
      if (allowed.ok) {
        const { code, state } = reset.issue(Date.now(), allowed);
        user.passwordReset = state;
        await user.save();
        const sent = await sendMail({
          to: user.email, subject: "Your Stashr code: " + code,
          text: "Your Stashr password reset code is " + code + ". It is valid for 10 minutes. If you did not ask for it, ignore this email.",
          html: "<div style=\"font-family:system-ui,sans-serif;max-width:420px\"><h2 style=\"margin:0 0 8px\">Reset your Stashr password</h2><p>Your code:</p><p style=\"font-size:32px;font-weight:700;letter-spacing:6px;margin:8px 0\">" + code + "</p><p style=\"color:#666\">Valid for 10 minutes. If you did not ask for this, you can ignore this email — your password stays the same.</p></div>"
        });
        if (!sent.ok) console.error("forgot-password: mail not sent (" + sent.error + ")");
      }
    }
    return res.status(200).json({ message: GENERIC });
  } catch (error) { return serverError(res, "forgot-password", error); }
});

router.post("/reset-password", limiter, async (req, res) => {
  const email = str(req.body.email).toLowerCase();
  const code = str(req.body.code).replace(/\s+/g, "");
  const newPassword = raw(req.body.newPassword);
  if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) return res.status(400).json({ error: "Enter your email and the 6-digit code." });
  if (newPassword.length < 8) return res.status(400).json({ error: "Use at least 8 characters for your new password." });
  try {
    const user = await findByEmail(email);
    const result = user ? reset.verify(user.passwordReset, code) : { ok: false, reason: "none" };
    if (!result.ok) {
      if (user && result.attempts) { user.passwordReset.attempts = result.attempts; user.markModified("passwordReset"); await user.save(); }
      const msg = result.reason === "expired" ? "That code has expired. Ask for a new one." : result.reason === "locked" ? "Too many wrong codes. Ask for a new one." : "That code is not right.";
      return res.status(400).json({ error: msg });
    }
    if (user.twoFactor && user.twoFactor.enabled) {
      if (!req.body.twoFactorCode) return res.status(401).json({ error: "Two-factor login is on: also enter the code from your authenticator app (or a recovery code).", twoFactorRequired: true });
      if (!checkSecondFactor(user, req.body.twoFactorCode)) { await user.save(); return res.status(401).json({ error: "That authenticator code didn't work.", twoFactorRequired: true }); }
    }
    user.password = newPassword; // hashed by the pre-save hook
    user.cpassword = undefined;
    user.passwordReset = undefined;
    user.tokens = []; // sign out everywhere
    await user.save();
    return res.status(200).json({ message: "Password changed. Sign in with your new password." });
  } catch (error) { return serverError(res, "reset-password", error); }
});

module.exports = router;
