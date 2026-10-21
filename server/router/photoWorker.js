const express = require("express");
const { Readable } = require("stream");
const { open } = require("../utils/workerSeal");
const { listDriveMedia } = require("../utils/driveIndex");

/*
 * Worker endpoints. Any copy of this server can act as a photo worker: it needs only PHOTO_WORKER_SECRET.
 * Every request carries a sealed, short-lived payload from the main server; nothing here touches the database.
 */
const router = express.Router();
const secret = () => process.env.PHOTO_WORKER_SECRET || "";
const DRIVE = "https://www.googleapis.com/drive/v3/files/";

router.get("/worker/health", (req, res) => (secret() ? res.json({ ok: true }) : res.status(503).json({ ok: false })));

router.post("/worker/index", express.json({ limit: "20kb" }), async (req, res) => {
    const job = open(req.body?.blob, secret());
    if (!job || typeof job.accessToken !== "string") return res.status(403).json({ error: "Not allowed." });
    try { return res.json(await listDriveMedia(job.accessToken, { maxPages: Math.min(20, Number(job.maxPages) || 10) })); }
    catch { return res.status(502).json({ error: "Could not read Google Drive." }); }
});

router.get("/worker/media", async (req, res) => {
    const job = open(req.query.d, secret());
    if (!job || typeof job.accessToken !== "string" || !/^[\w-]{5,200}$/.test(String(job.fileId || ""))) return res.status(403).json({ error: "This link is invalid or has expired." });
    try {
        const headers = { Authorization: `Bearer ${job.accessToken}` };
        if (job.size === "full" && req.headers.range) headers.Range = req.headers.range;
        let upstream;
        if (job.size === "full") upstream = await fetch(`${DRIVE}${encodeURIComponent(job.fileId)}?alt=media`, { headers });
        else {
            const px = job.size === "large" ? 1600 : 640;
            const sized = (link) => link.replace(/=s\d+(-c)?$/, "") + "=s" + px;
            upstream = job.thumbLink ? await fetch(sized(job.thumbLink), { headers }) : null;
            if (!upstream || !upstream.ok) {
                const meta = await fetch(`${DRIVE}${encodeURIComponent(job.fileId)}?fields=thumbnailLink`, { headers });
                const link = meta.ok ? (await meta.json()).thumbnailLink : "";
                if (!link) return res.status(404).json({ error: "No preview is available." });
                upstream = await fetch(sized(link), { headers });
            }
        }
        if (!upstream.ok && upstream.status !== 206) return res.status(upstream.status === 404 ? 404 : 502).json({ error: "Google Drive could not return this file." });
        res.status(upstream.status);
        for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) if (upstream.headers.get(name)) res.set(name, upstream.headers.get(name));
        res.set({ "Cache-Control": "private, max-age=86400", "Access-Control-Allow-Origin": "*" }); // the sealed link is the only credential
        if (job.download && job.filename) res.set("Content-Disposition", `attachment; filename="${String(job.filename).replace(/[^\w. -]/g, "_")}"`);
        if (!upstream.body) return res.end();
        const stream = Readable.fromWeb(upstream.body);
        stream.on("error", () => res.destroy());
        return stream.pipe(res);
    } catch { return res.status(502).json({ error: "Could not stream this file." }); }
});

module.exports = router;
