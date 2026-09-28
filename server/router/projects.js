const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const User = require("../models/schema");
const authenticate = require("../middlewares/authenticate");
const { serverError } = require("./helpers");

/*
 * Project/infra tracker. Same scheme as the password vault (see
 * router/vault.js): every entry is one JSON document encrypted with this
 * account's own data key (see User.getDataKey()).
 */

const MAX_ITEMS = 2000;
const MAX_BATCH = 500;

const isFields = (value) => value && typeof value === "object" && !Array.isArray(value);

router.post("/projects/items", authenticate, async (req, res) =>
{
    const fields = req.body.data;
    if (!isFields(fields)) return res.status(400).json({ error: "Invalid item." });
    if ((req.rootUser.projects || []).length >= MAX_ITEMS) return res.status(400).json({ error: "Your project list is full." });

    try
    {
        const dataKey = await req.rootUser.getDataKey();
        const now = new Date();
        const item = { _id: new mongoose.Types.ObjectId(), enc: "udk", data: User.sealEntry(dataKey, fields), createdAt: now, updatedAt: now };
        await User.updateOne({ _id: req.rootUser._id }, { $push: { projects: item } });
        return res.status(201).json({ item: User.publicEntry(item, dataKey) });
    }
    catch (error)
    {
        return serverError(res, "projects/items", error);
    }
});

router.post("/projects/items/bulk", authenticate, async (req, res) =>
{
    const items = Array.isArray(req.body.items) ? req.body.items : null;
    if (!items || items.length === 0 || items.length > MAX_BATCH || !items.every((i) => i && isFields(i.data)))
    {
        return res.status(400).json({ error: `Send between 1 and ${MAX_BATCH} valid items.` });
    }
    if ((req.rootUser.projects || []).length + items.length > MAX_ITEMS)
    {
        return res.status(400).json({ error: "That would make your project list too large." });
    }

    try
    {
        const dataKey = await req.rootUser.getDataKey();
        const now = new Date();
        const docs = items.map((i) => ({ _id: new mongoose.Types.ObjectId(), enc: "udk", data: User.sealEntry(dataKey, i.data), createdAt: now, updatedAt: now }));
        await User.updateOne({ _id: req.rootUser._id }, { $push: { projects: { $each: docs } } });
        return res.status(201).json({ items: docs.map((d) => User.publicEntry(d, dataKey)) });
    }
    catch (error)
    {
        return serverError(res, "projects/items/bulk", error);
    }
});

router.put("/projects/items/:id", authenticate, async (req, res) =>
{
    const fields = req.body.data;
    if (!isFields(fields)) return res.status(400).json({ error: "Invalid item." });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Could not find that project." });

    try
    {
        const dataKey = await req.rootUser.getDataKey();
        const now = new Date();
        const data = User.sealEntry(dataKey, fields);
        const result = await User.updateOne(
            { _id: req.rootUser._id, "projects._id": req.params.id },
            { $set: { "projects.$.enc": "udk", "projects.$.data": data, "projects.$.updatedAt": now } }
        );
        if (result.matchedCount === 0) return res.status(404).json({ error: "Could not find that project." });
        return res.status(200).json({ item: { ...fields, _id: req.params.id, updatedAt: now } });
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
