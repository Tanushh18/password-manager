const { Readable } = require("stream");
const { driveFetch, updateEntry, refreshGoogleToken } = require("./photoStore");
const workers = require("./photoWorkers");

/* Streams one stored photo (preview or original) from its Drive account to an HTTP response, or hands off to a worker server. */
const DRIVE = "https://www.googleapis.com";
const PX = { thumb: 640, large: 1600 };

const freshToken = async (user, key, connection) => {
    if (connection.expiresAt && connection.expiresAt - Date.now() < 120000 && await refreshGoogleToken(connection) && connection._eid) await updateEntry(user, "photoConnections", connection, key);
    return connection.accessToken;
};

/** size: "thumb" (640 px), "large" (1600 px) or "full" (the original; callers decide whether that is allowed). */
async function streamMedia({ req, res, user, key, connection, item, size = "thumb", download = false }) {
    const kind = size === "full" ? "full" : size === "large" ? "large" : "thumb";
    const link = workers.mediaLink({ accessToken: await freshToken(user, key, connection), fileId: item.providerFileId, thumbLink: item.thumbnailUrl || "", size: kind, filename: item.filename, download });
    if (link) {
        res.set("Cache-Control", "private, max-age=300");
        // Browsers cannot follow a cross-site redirect with their login attached, so the website asks for the link instead.
        return req.query.format === "link" ? res.json({ url: link }) : res.redirect(302, link);
    }

    const pipe = async (upstream, extra = {}) => {
        if (!upstream.ok && upstream.status !== 206) return res.status(upstream.status === 404 ? 404 : 502).json({ error: "Google Drive could not return this file." });
        res.status(upstream.status);
        for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) if (upstream.headers.get(name)) res.set(name, upstream.headers.get(name));
        res.set({ "Cache-Control": "private, max-age=86400", ...extra });
        if (!upstream.body) return res.end();
        const stream = Readable.fromWeb(upstream.body);
        stream.on("error", () => res.destroy());
        return stream.pipe(res);
    };
    if (kind === "full") {
        const headers = req.headers.range ? { Range: req.headers.range } : {};
        const upstream = await driveFetch(user, key, connection, `${DRIVE}/drive/v3/files/${encodeURIComponent(item.providerFileId)}?alt=media`, { headers });
        return pipe(upstream, download ? { "Content-Disposition": `attachment; filename="${String(item.filename).replace(/[^\w. -]/g, "_")}"` } : {});
    }
    const sized = (l) => l.replace(/=s\d+(-c)?$/, "") + "=s" + PX[kind];
    let upstream = item.thumbnailUrl ? await driveFetch(user, key, connection, sized(item.thumbnailUrl)) : null;
    if (!upstream || !upstream.ok) {
        const meta = await driveFetch(user, key, connection, `${DRIVE}/drive/v3/files/${encodeURIComponent(item.providerFileId)}?fields=thumbnailLink`);
        const l = meta.ok ? (await meta.json()).thumbnailLink : "";
        if (!l) return res.status(404).json({ error: "No preview is available for this file." });
        upstream = await driveFetch(user, key, connection, sized(l));
    }
    return pipe(upstream);
}

module.exports = { streamMedia };
