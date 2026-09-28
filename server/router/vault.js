const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const User = require("../models/schema");
const authenticate = require("../middlewares/authenticate");
const { serverError } = require("./helpers");

/*
 * Password vault. Every item is stored as one JSON document, encrypted with
 * this account's own data key (see User.getDataKey() / models/EncDecManager.js).
 * That key is itself wrapped with the server's key and never leaves the
 * server — there is no user-typed master password — but a leaked global key
 * alone no longer decrypts every account's items in one step.
 */

const MAX_ITEMS = 5000;
const MAX_BATCH = 1000;

const isFields = (value) => value && typeof value === "object" && !Array.isArray(value);

router.post("/vault/items", authenticate, async (req, res) =>
{
    const fields = req.body.data;
    if (!isFields(fields)) return res.status(400).json({ error: "Invalid item." });
    if ((req.rootUser.passwords || []).length >= MAX_ITEMS) return res.status(400).json({ error: "Your vault is full." });

    try
    {
        const dataKey = await req.rootUser.getDataKey();
        const now = new Date();
        const item = { _id: new mongoose.Types.ObjectId(), enc: "udk", data: User.sealEntry(dataKey, fields), createdAt: now, updatedAt: now };
        await User.updateOne({ _id: req.rootUser._id }, { $push: { passwords: item } });
        return res.status(201).json({ item: User.publicEntry(item, dataKey) });
    }
    catch (error)
    {
        return serverError(res, "vault/items", error);
    }
});

router.post("/vault/items/bulk", authenticate, async (req, res) =>
{
    const items = Array.isArray(req.body.items) ? req.body.items : null;
    if (!items || items.length === 0 || items.length > MAX_BATCH || !items.every((i) => i && isFields(i.data)))
    {
        return res.status(400).json({ error: `Send between 1 and ${MAX_BATCH} valid items.` });
    }
    if ((req.rootUser.passwords || []).length + items.length > MAX_ITEMS)
    {
        return res.status(400).json({ error: "That would make your vault too large." });
    }

    try
    {
        const dataKey = await req.rootUser.getDataKey();
        const now = new Date();
        const docs = items.map((i) => ({ _id: new mongoose.Types.ObjectId(), enc: "udk", data: User.sealEntry(dataKey, i.data), createdAt: now, updatedAt: now }));
        await User.updateOne({ _id: req.rootUser._id }, { $push: { passwords: { $each: docs } } });
        return res.status(201).json({ items: docs.map((d) => User.publicEntry(d, dataKey)) });
    }
    catch (error)
    {
        return serverError(res, "vault/items/bulk", error);
    }
});

router.put("/vault/items/:id", authenticate, async (req, res) =>
{
    const fields = req.body.data;
    if (!isFields(fields)) return res.status(400).json({ error: "Invalid item." });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Could not find that item." });

    try
    {
        const dataKey = await req.rootUser.getDataKey();
        const now = new Date();
        const data = User.sealEntry(dataKey, fields);
        // Also converts a legacy entry in place (drops the old server-readable fields).
        const result = await User.updateOne(
            { _id: req.rootUser._id, "passwords._id": req.params.id },
            {
                $set: { "passwords.$.enc": "udk", "passwords.$.data": data, "passwords.$.updatedAt": now },
                $unset: { "passwords.$.password": "", "passwords.$.iv": "", "passwords.$.tag": "", "passwords.$.platform": "", "passwords.$.platEmail": "" }
            }
        );
        if (result.matchedCount === 0) return res.status(404).json({ error: "Could not find that item." });
        return res.status(200).json({ item: { ...fields, _id: req.params.id, updatedAt: now } });
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

module.exports = router;
