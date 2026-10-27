const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const User = require("../models/schema");
const authenticate = require("../middlewares/authenticate");
const hub = require("../utils/syncHub");
const { serverError } = require("./helpers");
const { pickPrimary, mergeProjects } = require("../utils/projectMerge");
const { syncProjectServers, pickSlug } = require("../utils/projectServers");
const { loadRenderServices } = require("../utils/projectStatus");

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
        hub.notify(req.rootUser._id, "projects");
        return res.status(200).json({ message: "Deleted." });
    }
    catch (error)
    {
        return serverError(res, "projects/items/:id delete", error);
    }
});

/* Merges duplicate projects (e.g. one repo deployed several times) into one. Nothing is lost: the kept
   project's values win, the others fill in gaps, and every linked Render service stays linked. */
router.post("/projects/merge", authenticate, async (req, res) =>
{
    const ids = Array.isArray(req.body.ids) ? [...new Set(req.body.ids.map(String))] : [];
    if (ids.length < 2 || ids.length > 20 || !ids.every((id) => mongoose.isValidObjectId(id))) return res.status(400).json({ error: "Choose at least two projects to merge." });
    const keepId = req.body.keepId ? String(req.body.keepId) : "";
    if (keepId && !ids.includes(keepId)) return res.status(400).json({ error: "The project to keep must be one of the merged projects." });

    try
    {
        const dataKey = await req.rootUser.getDataKey();
        const entries = ids.map((id) => (req.rootUser.projects || []).find((e) => String(e._id) === id));
        if (entries.some((e) => !e)) return res.status(404).json({ error: "Could not find one of those projects." });
        const projects = entries.map((e) => User.publicEntry(e, dataKey));
        if (projects.some((p) => p.broken || p.enc === "e2e")) return res.status(422).json({ error: "One of those projects could not be decrypted." });

        const primary = keepId ? projects.find((p) => String(p._id) === keepId) : pickPrimary(projects);
        const others = projects.filter((p) => p !== primary);
        const { fields, conflicts } = mergeProjects(primary, others);
        const now = new Date();
        const result = await User.updateOne(
            { _id: req.rootUser._id, "projects._id": primary._id },
            { $set: { "projects.$.enc": "udk", "projects.$.data": User.sealEntry(dataKey, fields), "projects.$.updatedAt": now } }
        );
        if (result.matchedCount === 0) return res.status(404).json({ error: "Could not find that project." });
        await User.updateOne({ _id: req.rootUser._id }, { $pull: { projects: { _id: { $in: others.map((p) => p._id) } } } });
        return res.status(200).json({ item: { ...fields, _id: String(primary._id), updatedAt: now }, removed: others.map((p) => String(p._id)), conflicts });
    }
    catch (error)
    {
        return serverError(res, "projects/merge", error);
    }
});

/* Publishes a project's servers: picks its public registry name once, pulls in every server of the repo, and saves the list. */
router.post("/projects/items/:id/servers/sync", authenticate, async (req, res) =>
{
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Could not find that project." });
    try
    {
        const dataKey = await req.rootUser.getDataKey();
        const entry = (req.rootUser.projects || []).find((e) => String(e._id) === req.params.id);
        if (!entry) return res.status(404).json({ error: "Could not find that project." });
        const fields = User.publicEntry(entry, dataKey);
        if (fields.broken || fields.enc === "e2e") return res.status(422).json({ error: "This project could not be decrypted." });
        const registryApp = fields.registryApp || (req.body && req.body.publish === false ? "" : await pickSlug(req.rootUser, fields.name));
        let services = [];
        if ((req.rootUser.renderAccounts || []).length) services = (await loadRenderServices(req.rootUser, dataKey, { refresh: true })).services;
        const result = await syncProjectServers(req.rootUser, dataKey, entry, services, { registryApp });
        res.set("Cache-Control", "no-store");
        return res.json({ registryApp: result.registryApp || "", serverUrls: result.serverUrls || fields.serverUrls || [], changed: result.changed, published: result.published });
    }
    catch (error)
    {
        return serverError(res, "projects/items/:id/servers/sync", error);
    }
});

module.exports = router;
