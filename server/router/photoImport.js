const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const authenticate = require("../middlewares/authenticate");
const { requireFeature } = require("../utils/features");
const { PhotoImportBatch: Batch, PhotoImportItem: Item } = require("../models/photoImport");
const { createBatch, control, removeBatch, renameBatch, unsealItem } = require("../utils/photoImport");
const { estimate } = require("../utils/importPlan");
const { decode } = require("../utils/photoStore");
const { serverError } = require("./helpers");

/* Google Photos import pipeline: website + admin-granted accounts only (feature "photoImport"). */
const gate = [authenticate, requireFeature("photoImport")];
const ACTIVE = ["downloading", "uploading", "verifying"];
const oid = (v) => (mongoose.isValidObjectId(v) ? v : null);
const fail = (res, error) => (Number.isInteger(error.status) && error.status < 500 ? res.status(error.status).json({ error: error.message }) : serverError(res, "photo-import", error));

const publicBatch = (b) => ({
    id: String(b._id), label: b.label, status: b.status, pauseReason: b.pauseReason || "", concurrency: b.concurrency,
    pickerUri: b.status === "picking" && b.pickerUri ? `${b.pickerUri}/autoclose` : "", sessionExpires: b.sessionExpires || null,
    counts: b.counts, createdAt: b.createdAt, startedAt: b.startedAt || null, finishedAt: b.finishedAt || null
});

router.get("/photo-import/batches", ...gate, async (req, res) => {
    try {
        const list = await Batch.find({ userId: req.rootUser._id }).sort({ createdAt: -1 }).limit(100);
        res.set("Cache-Control", "no-store");
        return res.json({ batches: list.map(publicBatch) });
    } catch (error) { return serverError(res, "photo-import/list", error); }
});

router.post("/photo-import/batches", ...gate, async (req, res) => {
    // The name is optional now: it can be set once the import has run (PATCH below).
    const label = String(req.body?.label || "").trim().slice(0, 60).replace(/[\\/]/g, "-") || `Import ${new Date().toISOString().slice(0, 10)}`;
    try {
        const destinationIds = Array.isArray(req.body?.destinationIds) ? req.body.destinationIds.map(String).slice(0, 20) : [];
        const batch = await createBatch(req.rootUser._id, { label, sourceConnectionId: String(req.body?.sourceConnectionId || ""), destinationIds, concurrency: req.body?.concurrency });
        return res.status(201).json({ batch: publicBatch(batch) });
    } catch (error) { return fail(res, error); }
});

/* Everything the pipeline view needs in one call. */
router.get("/photo-import/batches/:id", ...gate, async (req, res) => {
    if (!oid(req.params.id)) return res.status(404).json({ error: "Import not found." });
    try {
        const batch = await Batch.findOne({ _id: req.params.id, userId: req.rootUser._id });
        if (!batch) return res.status(404).json({ error: "Import not found." });
        const key = await req.rootUser.getDataKey();
        const accounts = new Map(decode(req.rootUser.photoConnections, key).map((c) => [c.id, c.label || c.email]));
        const stages = Object.fromEntries((await Item.aggregate([{ $match: { batchId: batch._id } }, { $group: { _id: "$status", n: { $sum: 1 } } }])).map((r) => [r._id, r.n]));
        const name = (item) => unsealItem(item, key).filename || "Unnamed";
        const [active, recent, failed, retrying, finishedRows] = await Promise.all([
            Item.find({ batchId: batch._id, status: { $in: ACTIVE } }).sort({ stageAt: 1 }).limit(8),
            Item.find({ batchId: batch._id, status: { $in: ["done", "skipped"] } }).sort({ finishedAt: -1 }).limit(15),
            Item.find({ batchId: batch._id, status: "failed" }).sort({ finishedAt: -1 }).limit(50),
            Item.find({ batchId: batch._id, status: "pending", attempts: { $gt: 0 } }).sort({ notBefore: 1 }).limit(20),
            Item.find({ batchId: batch._id, status: "done", finishedAt: { $gte: new Date(Date.now() - 10 * 60000) } }, "bytes startedAt finishedAt")
        ]);
        const remainingItems = (stages.pending || 0) + ACTIVE.reduce((n, s) => n + (stages[s] || 0), 0);
        const speed = estimate(finishedRows.map((r) => ({ bytes: r.bytes, startedAt: r.startedAt, finishedAt: r.finishedAt })), { items: remainingItems });
        const [sizes] = await Item.aggregate([{ $match: { batchId: batch._id } }, { $group: { _id: null, bytes: { $sum: "$bytes" }, measured: { $sum: { $cond: [{ $gt: ["$bytes", 0] }, 1, 0] } } } }]);
        const destinations = decode(req.rootUser.photoConnections, key)
            .filter((c) => (batch.destinationIds?.length ? batch.destinationIds.includes(c.id) : c.status === "connected"))
            .map((c) => ({ id: c.id, label: c.label || c.email, status: c.status, freeGb: c.limitGb == null ? null : Math.max(0, Number(c.limitGb) - Number(c.usedGb || 0)) }));
        res.set("Cache-Control", "no-store");
        return res.json({
            batch: publicBatch(batch),
            stages: { pending: stages.pending || 0, downloading: stages.downloading || 0, uploading: stages.uploading || 0, verifying: stages.verifying || 0, done: stages.done || 0, skipped: stages.skipped || 0, failed: stages.failed || 0 },
            speed: { ...speed, remainingItems },
            active: active.map((i) => ({ id: String(i._id), filename: name(i), stage: i.status, bytes: i.bytes, bytesDone: i.bytesDone, attempt: i.attempts, since: i.stageAt, server: i.owner, destination: accounts.get(i.destinationConnectionId) || "" })),
            recent: recent.map((i) => ({ id: String(i._id), filename: name(i), status: i.status, bytes: i.bytes, note: i.error, finishedAt: i.finishedAt, destination: accounts.get(i.destinationConnectionId) || "", seconds: i.startedAt && i.finishedAt ? Math.round((i.finishedAt - i.startedAt) / 1000) : null })),
            failed: failed.map((i) => ({ id: String(i._id), filename: name(i), error: i.error, attempts: i.attempts, finishedAt: i.finishedAt })),
            retrying: retrying.map((i) => ({ id: String(i._id), filename: name(i), attempts: i.attempts, error: i.error, retryAt: i.notBefore })),
            storage: { bytes: sizes?.bytes || 0, measured: sizes?.measured || 0 },
            destinations,
            events: [...(batch.events || [])].reverse().slice(0, 60)
        });
    } catch (error) { return serverError(res, "photo-import/detail", error); }
});

const ACTIONS = new Set(["pause", "resume", "cancel", "retry-failed", "check"]);
router.post("/photo-import/batches/:id/:action", ...gate, async (req, res) => {
    if (!oid(req.params.id) || !ACTIONS.has(req.params.action)) return res.status(404).json({ error: "Import not found." });
    try { return res.json({ batch: publicBatch(await control(req.rootUser._id, req.params.id, req.params.action)) }); }
    catch (error) { return fail(res, error); }
});

router.patch("/photo-import/batches/:id", ...gate, async (req, res) => {
    if (!oid(req.params.id)) return res.status(404).json({ error: "Import not found." });
    const label = String(req.body?.label || "").trim().slice(0, 60).replace(/[\\/]/g, "-");
    if (!label) return res.status(400).json({ error: "Give the folder a name." });
    try { return res.json({ batch: publicBatch(await renameBatch(req.rootUser._id, req.params.id, label)) }); }
    catch (error) { return fail(res, error); }
});

router.delete("/photo-import/batches/:id", ...gate, async (req, res) => {
    if (!oid(req.params.id)) return res.status(404).json({ error: "Import not found." });
    try { await removeBatch(req.rootUser._id, req.params.id); return res.json({ message: "Import removed. Files already in Drive were not touched." }); }
    catch (error) { return fail(res, error); }
});

module.exports = router;
