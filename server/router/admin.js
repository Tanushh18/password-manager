const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const User = require("../models/schema");
const authenticate = require("../middlewares/authenticate");
const { CATALOG, BY_KEY, resolveFeatures, isAdminEmail } = require("../utils/features");
const { serverError } = require("./helpers");

/* Admin panel API: who has an account, and which features each person sees. Administrators only. */
const adminOnly = (req, res, next) => (isAdminEmail(req.rootUser?.email) ? next() : res.status(403).json({ error: "Not allowed." }));

const shape = (u) => ({
    id: String(u._id), email: u.email, name: u.name || "", createdAt: u.createdAt || null,
    isAdmin: isAdminEmail(u.email), overrides: u.featureOverrides || {}, features: resolveFeatures(u.email, u.featureOverrides)
});

router.get("/admin/features", authenticate, adminOnly, (req, res) => res.json({ features: CATALOG }));

router.get("/admin/users", authenticate, adminOnly, async (req, res) => {
    try {
        const q = String(req.query.q || "").trim().toLowerCase().slice(0, 80);
        const filter = q ? { email: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") } } : {};
        const limit = Math.max(1, Math.min(500, Number.parseInt(req.query.limit, 10) || 200));
        const [users, total] = await Promise.all([
            User.find(filter, "email name createdAt featureOverrides").sort({ createdAt: -1 }).limit(limit).lean(),
            User.countDocuments(filter)
        ]);
        res.set("Cache-Control", "no-store");
        return res.json({ users: users.map(shape), total, features: CATALOG });
    } catch (error) { return serverError(res, "admin/users", error); }
});

/* Set one switch for one person: enabled true/false, or null to go back to the default for that feature. */
router.put("/admin/users/:id/features", authenticate, adminOnly, async (req, res) => {
    const { key, enabled } = req.body || {};
    const feature = BY_KEY.get(key);
    if (!feature) return res.status(400).json({ error: "Unknown feature." });
    if (feature.locked) return res.status(400).json({ error: "This feature follows the account type and cannot be changed per person." });
    if (enabled !== null && typeof enabled !== "boolean") return res.status(400).json({ error: "enabled must be true, false or null." });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "User not found." });
    try {
        const update = enabled === null ? { $unset: { [`featureOverrides.${key}`]: "" } } : { $set: { [`featureOverrides.${key}`]: enabled } };
        const user = await User.findOneAndUpdate({ _id: req.params.id }, update, { returnDocument: "after", projection: "email name createdAt featureOverrides" }).lean();
        if (!user) return res.status(404).json({ error: "User not found." });
        console.info(`[admin] ${req.rootUser.email} set ${key}=${enabled} for user=${user._id}`);
        return res.json({ user: shape(user) });
    } catch (error) { return serverError(res, "admin/users/features", error); }
});

module.exports = router;
