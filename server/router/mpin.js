/**
 * Sign in with a 4-digit MPIN, on a device you have already signed in on with your email and password.
 *
 *   POST   /mpin               (signed in)  set an MPIN for this device; returns { deviceId, deviceSecret } once
 *   PUT    /mpin/:deviceId     (signed in)  change that device's MPIN
 *   GET    /mpin               (signed in)  the devices that have an MPIN
 *   DELETE /mpin/:deviceId     (signed in)  turn it off for a device
 *   POST   /mpin-login         (public)     { deviceId, deviceSecret, pin }  ->  a normal session
 *
 * Why this is safe enough for a vault: someone who only knows or guesses the MPIN cannot get in, because the
 * device secret is also needed; and someone who holds the device gets five tries at the MPIN, then the device is
 * forgotten and the email and password are needed again. Changing or resetting the password forgets every device.
 */
const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const router = express.Router();
const User = require("../models/schema");
const MpinDevice = require("../models/mpinDevice");
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");
const audit = require("../utils/audit");
const { COOKIE_OPTIONS, LEGACY_COOKIE_OPTIONS, COOKIE_MAX_AGE, wantsToken, serverError } = require("./helpers");

const MAX_DEVICES = 5, MAX_FAILS = 5;
const PIN_RE = /^\d{4}$/;
const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: "Too many changes. Slow down." });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, message: "Too many attempts. Wait a few minutes." });

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/** Too easy to guess: 1111, 0000, 1234, 4321 and the like. */
const weak = (pin) => /^(\d)\1{3}$/.test(pin) || ["0123", "1234", "2345", "3456", "4567", "5678", "6789", "9876", "8765", "7654", "6543", "5432", "4321", "3210"].includes(pin);

const publicDevice = (d) => ({ deviceId: d.deviceId, label: d.label, createdAt: d.createdAt, lastUsedAt: d.lastUsedAt || null });

router.post("/mpin", authenticate, writeLimiter, async (req, res) => {
    try {
        const pin = String((req.body && req.body.pin) || "");
        if (!PIN_RE.test(pin)) return res.status(400).json({ error: "The MPIN must be 4 digits." });
        if (weak(pin)) return res.status(400).json({ error: "That MPIN is too easy to guess. Avoid 1234 and repeated digits." });
        // The oldest device makes room when there are already five.
        const have = await MpinDevice.find({ user: req.rootUser._id }).sort({ createdAt: 1 }).lean();
        if (have.length >= MAX_DEVICES) await MpinDevice.deleteMany({ _id: { $in: have.slice(0, have.length - MAX_DEVICES + 1).map((d) => d._id) } });
        const deviceId = crypto.randomBytes(12).toString("hex"), deviceSecret = crypto.randomBytes(24).toString("hex");
        await MpinDevice.create({
            user: req.rootUser._id, deviceId, secretHash: sha(deviceSecret), pinHash: await bcrypt.hash(pin, 10),
            label: audit.deviceLabel(req.headers["user-agent"]) || ""
        });
        audit.record(req, req.rootUser._id, "mpin_set", "");
        return res.status(201).json({ deviceId, deviceSecret });
    } catch (e) { return serverError(res, "mpin set", e); }
});

router.put("/mpin/:deviceId", authenticate, writeLimiter, async (req, res) => {
    try {
        const pin = String((req.body && req.body.pin) || "");
        if (!PIN_RE.test(pin)) return res.status(400).json({ error: "The MPIN must be 4 digits." });
        if (weak(pin)) return res.status(400).json({ error: "That MPIN is too easy to guess. Avoid 1234 and repeated digits." });
        const r = await MpinDevice.updateOne({ user: req.rootUser._id, deviceId: String(req.params.deviceId) }, { $set: { pinHash: await bcrypt.hash(pin, 10), fails: 0 } });
        if (!r.matchedCount) return res.status(404).json({ error: "That device is not set up for MPIN." });
        audit.record(req, req.rootUser._id, "mpin_change", "");
        return res.json({ ok: true });
    } catch (e) { return serverError(res, "mpin change", e); }
});

router.get("/mpin", authenticate, async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        const list = await MpinDevice.find({ user: req.rootUser._id }).sort({ createdAt: 1 }).lean();
        return res.json({ devices: list.map(publicDevice) });
    } catch (e) { return serverError(res, "mpin list", e); }
});

router.delete("/mpin/:deviceId", authenticate, writeLimiter, async (req, res) => {
    try {
        const r = await MpinDevice.deleteOne({ user: req.rootUser._id, deviceId: String(req.params.deviceId) });
        if (!r.deletedCount) return res.status(404).json({ error: "That device is not set up for MPIN." });
        audit.record(req, req.rootUser._id, "mpin_off", "");
        return res.json({ ok: true });
    } catch (e) { return serverError(res, "mpin off", e); }
});

router.post("/mpin-login", loginLimiter, async (req, res) => {
    try {
        const b = req.body || {};
        const deviceId = String(b.deviceId || ""), secret = String(b.deviceSecret || ""), pin = String(b.pin || "");
        if (!/^[a-f0-9]{24}$/.test(deviceId) || !secret || !PIN_RE.test(pin)) return res.status(400).json({ error: "Enter your 4-digit MPIN." });
        const device = await MpinDevice.findOne({ deviceId });
        // The same answer whether the device is unknown or its secret is wrong: nothing to learn here.
        if (!device || !same(sha(secret), device.secretHash)) return res.status(401).json({ error: "MPIN sign-in is not set up on this device. Use your email and password.", mpinGone: true });

        if (!(await bcrypt.compare(pin, device.pinHash))) {
            const fails = device.fails + 1;
            if (fails >= MAX_FAILS) {
                await MpinDevice.deleteOne({ _id: device._id });
                audit.record(req, device.user, "mpin_locked", "");
                return res.status(401).json({ error: "Too many wrong MPINs. MPIN is switched off on this device. Sign in with your email and password.", mpinGone: true });
            }
            await MpinDevice.updateOne({ _id: device._id }, { $set: { fails } });
            return res.status(401).json({ error: `Wrong MPIN. ${MAX_FAILS - fails} ${MAX_FAILS - fails === 1 ? "try" : "tries"} left.`, triesLeft: MAX_FAILS - fails });
        }

        const user = await User.findById(device.user);
        if (!user) { await MpinDevice.deleteOne({ _id: device._id }); return res.status(401).json({ error: "Use your email and password.", mpinGone: true }); }
        await MpinDevice.updateOne({ _id: device._id }, { $set: { fails: 0, lastUsedAt: new Date() } });

        const client = wantsToken(req) ? "mobile" : "web";
        const token = await user.generateAuthToken(client);
        void User.updateOne({ _id: user._id, "tokens.token": token }, { $set: { "tokens.$.device": audit.deviceLabel(req.headers["user-agent"]), "tokens.$.ip": audit.clientIp(req) } }).catch(() => {});
        audit.record(req, user._id, "sign_in", "mpin");
        res.cookie("jwtoken", token, { ...COOKIE_OPTIONS, expires: new Date(Date.now() + COOKIE_MAX_AGE) });
        res.clearCookie("jwtoken", LEGACY_COOKIE_OPTIONS);
        const body = { message: "User login successfully.", name: user.name, email: user.email, twoFactorEnabled: Boolean(user.twoFactor && user.twoFactor.enabled) };
        if (client === "mobile" || b.returnToken === true) body.token = token;
        return res.status(200).json(body);
    } catch (e) { return serverError(res, "mpin login", e); }
});

module.exports = router;
