const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const User = require("../models/schema");
const authenticate = require("../middlewares/authenticate");
const { isBlob, serverError } = require("./helpers");

/*
 * End-to-end encrypted project tracker.
 * Same scheme as the password vault (see router/vault.js): every entry is an
 * opaque AES-256-GCM blob produced on the device with the same vault key.
 * The server stores and returns blobs; it cannot read project names, hosting
 * accounts, database details, env var names or notes.
 */

const MAX_ITEMS = 2000;
const MAX_BATCH = 500;

const requireVault = (req, res, next) =>
{
    if (!req.rootUser.kdf || !req.rootUser.kdf.salt)
    {
        return res.status(409).json({ error: "Set up your vault key first.", code: "VAULT_NOT_SET_UP" });
    }
    next();
};

router.post("/projects/items", authenticate, requireVault, async (req, res) =>
{
    const { data } = req.body;
    if (!isBlob(data)) return res.status(400).json({ error: "Invalid item." });
    if ((req.rootUser.projects || []).length >= MAX_ITEMS) return res.status(400).json({ error: "Your project list is full." });

    try
    {
        const now = new Date();
        const item = { _id: new mongoose.Types.ObjectId(), enc: "e2e", data, createdAt: now, updatedAt: now };
        await User.updateOne({ _id: req.rootUser._id }, { $push: { projects: item } });
        return res.status(201).json({ item: User.publicEntry(item) });
    }
    catch (error)
    {
        return serverError(res, "projects/items", error);
    }
});

router.post("/projects/items/bulk", authenticate, requireVault, async (req, res) =>
{
    const items = Array.isArray(req.body.items) ? req.body.items : null;
    if (!items || items.length === 0 || items.length > MAX_BATCH || !items.every((i) => i && isBlob(i.data)))
    {
        return res.status(400).json({ error: `Send between 1 and ${MAX_BATCH} valid items.` });
    }
    if ((req.rootUser.projects || []).length + items.length > MAX_ITEMS)
    {
        return res.status(400).json({ error: "That would make your project list too large." });
    }

    try
    {
        const now = new Date();
        const docs = items.map((i) => ({ _id: new mongoose.Types.ObjectId(), enc: "e2e", data: i.data, createdAt: now, updatedAt: now }));
        await User.updateOne({ _id: req.rootUser._id }, { $push: { projects: { $each: docs } } });
        return res.status(201).json({ items: docs.map(User.publicEntry) });
    }
    catch (error)
    {
        return serverError(res, "projects/items/bulk", error);
    }
});

router.put("/projects/items/:id", authenticate, requireVault, async (req, res) =>
{
    const { data } = req.body;
    if (!isBlob(data)) return res.status(400).json({ error: "Invalid item." });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Could not find that project." });

    try
    {
        const now = new Date();
        const result = await User.updateOne(
            { _id: req.rootUser._id, "projects._id": req.params.id },
            { $set: { "projects.$.enc": "e2e", "projects.$.data": data, "projects.$.updatedAt": now } }
        );
        if (result.matchedCount === 0) return res.status(404).json({ error: "Could not find that project." });
        return res.status(200).json({ item: { _id: req.params.id, enc: "e2e", data, updatedAt: now } });
    }
    catch (error)
    {
        return serverError(res, "projects/items/:id", error);
    }
});

router.delete("/projects/items/:id", authenticate, async (req, res) =>
{
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Could not find that project." });
    try
    {
        const result = await User.updateOne(
            { _id: req.rootUser._id, "projects._id": req.params.id },
            { $pull: { projects: { _id: req.params.id } } }
        );
        if (result.matchedCount === 0) return res.status(404).json({ error: "Could not find that project." });
        return res.status(200).json({ message: "Deleted." });
    }
    catch (error)
    {
        return serverError(res, "projects/items/:id delete", error);
    }
});

module.exports = router;
