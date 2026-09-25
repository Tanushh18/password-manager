const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const User = require("../models/schema");
const authenticate = require("../middlewares/authenticate");
const { isBlob, validKdf, serverError } = require("./helpers");

/*
 * End-to-end encrypted vault.
 * Every item is an opaque AES-256-GCM blob produced on the device with a key
 * derived from the master password. The server stores and returns blobs; it
 * cannot read names, usernames, passwords, notes or 2FA secrets.
 */

const MAX_ITEMS = 5000;
const MAX_BATCH = 1000;

const requireVault = (req, res, next) =>
{
    if (!req.rootUser.kdf || !req.rootUser.kdf.salt)
    {
        return res.status(409).json({ error: "Set up your vault key first.", code: "VAULT_NOT_SET_UP" });
    }
    next();
};

/** One-time setup for accounts created before end-to-end encryption. */
router.post("/vault/setup", authenticate, async (req, res) =>
{
    const { kdf, keyCheck } = req.body;
    if (!validKdf(kdf) || !isBlob(keyCheck))
    {
        return res.status(400).json({ error: "Invalid vault settings." });
    }
    if (req.rootUser.kdf && req.rootUser.kdf.salt)
    {
        return res.status(409).json({ error: "Your vault is already set up." });
    }

    try
    {
        // Atomic: only succeeds if nobody set it up in the meantime.
        const result = await User.updateOne(
            { _id: req.rootUser._id, $or: [{ "kdf.salt": { $exists: false } }, { "kdf.salt": null }] },
            { $set: { kdf: { salt: kdf.salt, iterations: kdf.iterations }, keyCheck } }
        );
        if (result.modifiedCount === 0) return res.status(409).json({ error: "Your vault is already set up." });
        return res.status(200).json({ message: "Vault ready.", vault: { kdf, keyCheck } });
    }
    catch (error)
    {
        return serverError(res, "vault/setup", error);
    }
});

router.post("/vault/items", authenticate, requireVault, async (req, res) =>
{
    const { data } = req.body;
    if (!isBlob(data)) return res.status(400).json({ error: "Invalid item." });
    if ((req.rootUser.passwords || []).length >= MAX_ITEMS) return res.status(400).json({ error: "Your vault is full." });

    try
    {
        const now = new Date();
        const item = { _id: new mongoose.Types.ObjectId(), enc: "e2e", data, createdAt: now, updatedAt: now };
        await User.updateOne({ _id: req.rootUser._id }, { $push: { passwords: item } });
        return res.status(201).json({ item: User.publicEntry(item) });
    }
    catch (error)
    {
        return serverError(res, "vault/items", error);
    }
});

router.post("/vault/items/bulk", authenticate, requireVault, async (req, res) =>
{
    const items = Array.isArray(req.body.items) ? req.body.items : null;
    if (!items || items.length === 0 || items.length > MAX_BATCH || !items.every((i) => i && isBlob(i.data)))
    {
        return res.status(400).json({ error: `Send between 1 and ${MAX_BATCH} valid items.` });
    }
    if ((req.rootUser.passwords || []).length + items.length > MAX_ITEMS)
    {
        return res.status(400).json({ error: "That would make your vault too large." });
    }

    try
    {
        const now = new Date();
        const docs = items.map((i) => ({ _id: new mongoose.Types.ObjectId(), enc: "e2e", data: i.data, createdAt: now, updatedAt: now }));
        await User.updateOne({ _id: req.rootUser._id }, { $push: { passwords: { $each: docs } } });
        return res.status(201).json({ items: docs.map(User.publicEntry) });
    }
    catch (error)
    {
        return serverError(res, "vault/items/bulk", error);
    }
});

router.put("/vault/items/:id", authenticate, requireVault, async (req, res) =>
{
    const { data } = req.body;
    if (!isBlob(data)) return res.status(400).json({ error: "Invalid item." });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Could not find that item." });

    try
    {
        const now = new Date();
        // Also converts a legacy entry in place (drops the server-readable fields).
        const result = await User.updateOne(
            { _id: req.rootUser._id, "passwords._id": req.params.id },
            {
                $set: { "passwords.$.enc": "e2e", "passwords.$.data": data, "passwords.$.updatedAt": now },
                $unset: { "passwords.$.password": "", "passwords.$.iv": "", "passwords.$.tag": "", "passwords.$.platform": "", "passwords.$.platEmail": "" }
            }
        );
        if (result.matchedCount === 0) return res.status(404).json({ error: "Could not find that item." });
        return res.status(200).json({ item: { _id: req.params.id, enc: "e2e", data, updatedAt: now } });
    }
    catch (error)
    {
        return serverError(res, "vault/items/:id", error);
    }
});

router.delete("/vault/items/:id", authenticate, async (req, res) =>
{
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Could not find that item." });
    try
    {
        const result = await User.updateOne(
            { _id: req.rootUser._id, "passwords._id": req.params.id },
            { $pull: { passwords: { _id: req.params.id } } }
        );
        if (result.matchedCount === 0) return res.status(404).json({ error: "Could not find that item." });
        return res.status(200).json({ message: "Deleted." });
    }
    catch (error)
    {
        return serverError(res, "vault/items/:id delete", error);
    }
});

/**
 * Converts legacy server-encrypted entries to end-to-end blobs in one go.
 * The client decrypted them via /decrypt and re-encrypted locally.
 */
router.post("/vault/migrate", authenticate, requireVault, async (req, res) =>
{
    const items = Array.isArray(req.body.items) ? req.body.items : null;
    if (!items || items.length === 0 || items.length > MAX_ITEMS || !items.every((i) => i && i.id && isBlob(i.data)))
    {
        return res.status(400).json({ error: "Invalid migration." });
    }

    try
    {
        const user = await User.findById(req.rootUser._id);
        let migrated = 0;
        items.forEach(({ id, data }) =>
        {
            const entry = user.passwords.id(id);
            if (!entry || entry.enc === "e2e") return;
            entry.enc = "e2e";
            entry.data = data;
            entry.password = undefined;
            entry.iv = undefined;
            entry.tag = undefined;
            entry.platform = undefined;
            entry.platEmail = undefined;
            migrated += 1;
        });
        await user.save();
        return res.status(200).json({ migrated, passwords: user.toPublic().passwords });
    }
    catch (error)
    {
        return serverError(res, "vault/migrate", error);
    }
});

module.exports = router;
