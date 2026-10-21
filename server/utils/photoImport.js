const os = require("os");
const crypto = require("crypto");
const User = require("../models/schema");
const { without } = require("./projection");
const { PhotoImportBatch: Batch, PhotoImportItem: Item } = require("../models/photoImport");
const { decode, pushEntry, updateEntry, refreshGoogleToken } = require("./photoStore");
const { pickDestination } = require("./photoRouting");
const { ensureFolder } = require("./photoFolders");
const { MAX_ATTEMPTS, backoffMs, chunker, contentRange, committedFrom } = require("./importPlan");

/*
 * Google Photos -> Drive import, one file after another per batch:
 *   pick (Google's Picker, up to 2,000 per session) -> download from Google -> stream to Drive in 8 MiB pieces
 *   -> verify size and checksum -> file it in a Stashr folder.
 * Nothing is written to disk and at most one 8 MiB piece is held in memory. State lives in MongoDB, so any server
 * running this worker can pick up where another stopped (items are claimed with a short lease).
 */
const PICKER = "https://photospicker.googleapis.com/v1";
const DRIVE = "https://www.googleapis.com";
const OWNER = `${os.hostname()}:${process.pid}`;
const LEASE_MS = 5 * 60 * 1000;
const URL_TTL_MS = 45 * 60 * 1000; // Google's links last 60 minutes; refresh before that
const ACTIVE = ["downloading", "uploading", "verifying"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

const urlCache = new Map(); // batchId -> { at, urls: Map(pickedId -> baseUrl) }

async function event(batchId, level, message) {
  await Batch.updateOne({ _id: batchId }, { $push: { events: { $each: [{ at: new Date(), level, message: String(message).slice(0, 300) }], $slice: -200 } } }).catch(() => {});
}

async function loadUser(userId) {
  const user = await User.findById(userId, without("passwords", "projects", "renderMetricHistory", "renderIncidents", "renderAudit", "usageHistory"));
  if (!user) throw fail(404, "Account not found.");
  return { user, key: await user.getDataKey() };
}
const connectionOf = (user, key, id) => decode(user.photoConnections, key).find((c) => c.id === id);

async function freshToken(user, key, connection) {
  if (connection.expiresAt && connection.expiresAt - Date.now() < 120000 && await refreshGoogleToken(connection) && connection._eid) await updateEntry(user, "photoConnections", connection, key);
  return connection.accessToken;
}

/** fetch with the account's token; one automatic refresh on 401. */
async function authed(user, key, connection, url, options = {}) {
  const send = () => fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${connection.accessToken}` } });
  let response = await send();
  if (response.status === 401 && await refreshGoogleToken(connection)) {
    if (connection._eid) await updateEntry(user, "photoConnections", connection, key);
    response = await send();
  }
  return response;
}

/* ───────────────────────── batches ───────────────────────── */

async function stashrFolder(user, key, name, parentId) {
  const all = decode(user.photoFolders, key);
  const found = all.find((f) => (f.parentId || null) === (parentId || null) && f.name.toLowerCase() === name.toLowerCase());
  if (found) return found;
  const folder = { id: crypto.randomUUID(), name, parentId: parentId || null, createdAt: new Date().toISOString(), driveIds: {} };
  folder._eid = await pushEntry(user, "photoFolders", folder, key);
  return folder;
}

async function createBatch(userId, { label, sourceConnectionId, destinationIds = [], concurrency = 1 }) {
  const { user, key } = await loadUser(userId);
  const source = connectionOf(user, key, sourceConnectionId);
  if (!source || source.status !== "connected" || !source.accessToken) throw fail(400, "Pick a connected Google account as the source.");
  const connected = decode(user.photoConnections, key).filter((c) => c.status === "connected" && c.accessToken).map((c) => c.id);
  const chosen = destinationIds.length ? destinationIds.filter((id) => connected.includes(id)) : connected;
  if (!chosen.length) throw fail(400, "Choose at least one connected Google account to import into.");
  await freshToken(user, key, source);
  const response = await authed(user, key, source, `${PICKER}/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pickingConfig: { maxItemCount: "2000" } }) });
  if (response.status === 403 || response.status === 401) throw fail(400, "Google denied the Photos Picker permission. Reconnect the same Google account and approve both Photos Picker and Drive access.");
  if (!response.ok) { const detail = await response.text().catch(() => ""); throw fail(502, "Google Photos could not open a picking session (" + response.status + ")" + (detail ? ": " + detail.slice(0, 180) : ".")); }
  const session = await response.json();
  const root = await stashrFolder(user, key, "Google Photos", null);
  const folder = await stashrFolder(user, key, label, root.id);
  const batch = await Batch.create({
    userId, label, sourceConnectionId, destinationIds: chosen, folderId: folder.id, concurrency: Math.max(1, Math.min(4, Number(concurrency) || 1)),
    sessionId: session.id, pickerUri: session.pickerUri, sessionExpires: session.expireTime ? new Date(session.expireTime) : undefined,
    events: [{ at: new Date(), level: "info", message: "Waiting for you to choose photos in Google Photos." }]
  });
  return batch;
}

async function listPicked(user, key, connection, sessionId) {
  const out = [];
  let pageToken = "";
  for (let page = 0; page < 40; page += 1) { // 40 x 100 covers the 2,000 limit with room to spare
    const response = await authed(user, key, connection, `${PICKER}/mediaItems?` + new URLSearchParams({ sessionId, pageSize: "100", ...(pageToken ? { pageToken } : {}) }));
    if (!response.ok) { const detail = await response.text().catch(() => ""); throw fail(response.status, "Google Photos could not list selected media (" + response.status + ")" + (detail ? ": " + detail.slice(0, 180) : ".")); }
    const body = await response.json();
    out.push(...(body.mediaItems || []));
    pageToken = body.nextPageToken || "";
    if (!pageToken) break;
  }
  return out;
}

/** Checks whether the person has finished choosing; if so, records the items and starts the run. */
async function pollBatch(batchId) {
  const claimed = await Batch.findOneAndUpdate({ _id: batchId, status: "picking" }, { $set: { status: "listing", lastPolled: new Date() } }, { returnDocument: "after" });
  if (!claimed) return null;
  try {
    const { user, key } = await loadUser(claimed.userId);
    const source = connectionOf(user, key, claimed.sourceConnectionId);
    if (!source) throw fail(409, "The source Google account is no longer connected.");
    await freshToken(user, key, source);
    const response = await authed(user, key, source, `${PICKER}/sessions/${encodeURIComponent(claimed.sessionId)}`);
    if (response.status === 404) {
      await Batch.updateOne({ _id: batchId }, { $set: { status: "expired", finishedAt: new Date() } });
      await event(batchId, "error", "The Google Photos session expired before anything was chosen. Start a new import.");
      return null;
    }
    if (response.status === 401 || response.status === 403) {
      await Batch.updateOne({ _id: batchId }, { $set: { status: "paused", pauseReason: "Google Photos permission was denied. Reconnect the Google account, then resume this import." } });
      await event(batchId, "error", "Google rejected the Photos Picker permission. Reconnect this account and resume.");
      return null;
    }
    if (!response.ok) throw fail(response.status, "Could not check the picking session.");
    const session = await response.json();
    if (!session.mediaItemsSet) {
      const expired = claimed.sessionExpires && claimed.sessionExpires < new Date();
      await Batch.updateOne({ _id: batchId }, { $set: { status: expired ? "expired" : "picking", ...(expired ? { finishedAt: new Date() } : {}) } });
      if (expired) await event(batchId, "error", "The picking session expired. Start a new import.");
      return null;
    }
    const picked = await listPicked(user, key, source, claimed.sessionId);
    const urls = new Map();
    const docs = picked.map((m, i) => {
      urls.set(m.id, m.mediaFile?.baseUrl);
      return {
        userId: claimed.userId, batchId, pickedId: m.id, seq: i,
        data: User.sealEntry(key, { filename: m.mediaFile?.filename || `${m.id}.jpg`, mimeType: m.mediaFile?.mimeType || "image/jpeg", type: m.type || "PHOTO", createTime: m.createTime || "", width: m.mediaFile?.mediaFileMetadata?.width || null, height: m.mediaFile?.mediaFileMetadata?.height || null })
      };
    });
    if (docs.length) await Item.insertMany(docs, { ordered: false }).catch((e) => { if (e.code !== 11000 && !e.writeErrors) throw e; });
    urlCache.set(String(batchId), { at: Date.now(), urls });
    if (docs.length) measureItems(batchId, user, key, source, urls).catch(() => {});
    const total = await Item.countDocuments({ batchId });
    await Batch.updateOne({ _id: batchId }, { $set: { status: total ? "running" : "completed", startedAt: new Date(), "counts.total": total, ...(total ? {} : { finishedAt: new Date() }) } });
    await event(batchId, "info", total ? `${total} items chosen. Importing one after another.` : "Nothing was chosen.");
    return total;
  } catch (error) {
    await Batch.updateOne({ _id: batchId, status: "listing" }, { $set: { status: "picking" } }).catch(() => {});
    await event(batchId, "warn", error.message);
    return null;
  }
}

/* Google's picker does not report file sizes, so ask each download link for its length: the storage need shows before any copy. */
async function measureItems(batchId, user, key, connection, urls) {
  const queue = [...urls.entries()];
  const worker = async () => {
    while (queue.length) {
      const [pickedId, base] = queue.shift();
      if (!base) continue;
      const response = await authed(user, key, connection, base + "=d", { method: "HEAD" }).catch(() => null);
      const bytes = Number(response?.headers.get("content-length"));
      if (response?.ok && bytes > 0) await Item.updateOne({ batchId, pickedId }, { $set: { bytes } });
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}

async function refreshUrls(batch, user, key, connection) {
  await freshToken(user, key, connection);
  const picked = await listPicked(user, key, connection, batch.sessionId);
  const urls = new Map(picked.map((m) => [m.id, m.mediaFile?.baseUrl]));
  urlCache.set(String(batch._id), { at: Date.now(), urls });
  return urls;
}

/* ───────────────────────── one item ───────────────────────── */

/** Streams `reader` into a Drive resumable session in pieces; returns { file, bytes, md5 }. Retries a piece after asking Drive what it holds. */
async function putStream(sessionUri, reader, knownTotal, onBytes) {
  const hash = crypto.createHash("md5");
  let offset = 0, file = null;
  for await (const { buf, last } of chunker(reader)) {
    hash.update(buf);
    const end = offset + buf.length;
    const total = last ? end : knownTotal;
    let from = 0;
    for (let attempt = 0; ; attempt += 1) {
      try {
        const part = buf.subarray(from);
        const r = await fetch(sessionUri, { method: "PUT", headers: { "Content-Range": contentRange(offset + from, part.length, total) }, body: part, signal: AbortSignal.timeout(180000) });
        if (r.status === 200 || r.status === 201) { file = await r.json(); break; }
        if (r.status === 308) { const c = committedFrom(r.headers.get("range")); if (c >= end && !last) break; from = Math.min(buf.length, Math.max(0, c - offset)); if (last && attempt >= 4) throw fail(502, "Drive did not accept the final piece."); continue; }
        const text = await r.text().catch(() => "");
        if (r.status === 429 || r.status >= 500) throw fail(r.status, "Drive had a temporary problem.", { retryable: true });
        throw fail(r.status, `Drive answered ${r.status}.`, { quota: /quota/i.test(text), permanent: r.status === 403 || r.status === 404 });
      } catch (e) {
        if (e.permanent || (!e.retryable && e.status && e.status < 500) || attempt >= 4) throw e;
        await sleep(2000 * 2 ** attempt);
        const q = await fetch(sessionUri, { method: "PUT", headers: { "Content-Range": `bytes */${total ?? "*"}` }, signal: AbortSignal.timeout(60000) }).catch(() => null);
        if (q && (q.status === 200 || q.status === 201)) { file = await q.json(); break; }
        if (q && q.status === 308) from = Math.min(buf.length, Math.max(0, committedFrom(q.headers.get("range")) - offset));
      }
    }
    offset = end;
    onBytes(offset);
    if (last) break;
  }
  return { file, bytes: offset, md5: hash.digest("hex") };
}

const unsealItem = (item, key) => { try { return User.publicEntry({ enc: "udk", data: item.data }, key); } catch { return {}; } };

async function release(item, penalty = 0) {
  await Item.updateOne({ _id: item._id }, { $set: { status: "pending", leaseUntil: null, owner: "", bytesDone: 0 }, $inc: { attempts: -penalty } });
}

async function finishItem(item, status, fields = {}, counts = {}) {
  await Item.updateOne({ _id: item._id }, { $set: { status, leaseUntil: null, owner: "", finishedAt: new Date(), ...fields } });
  if (Object.keys(counts).length) await Batch.updateOne({ _id: item.batchId }, { $inc: counts });
}

async function failItem(item, batch, error) {
  const message = String(error.message || "Something went wrong.").slice(0, 200);
  const giveUp = error.permanent || item.attempts >= MAX_ATTEMPTS;
  if (giveUp) { await finishItem(item, "failed", { error: message }, { "counts.failed": 1 }); await event(batch._id, "error", `Gave up on an item: ${message}`); }
  else await Item.updateOne({ _id: item._id }, { $set: { status: "pending", leaseUntil: null, owner: "", error: message, bytesDone: 0, notBefore: new Date(Date.now() + backoffMs(item.attempts)) } });
}

async function pauseBatch(batchId, reason) {
  await Batch.updateOne({ _id: batchId, status: "running" }, { $set: { status: "paused", pauseReason: reason } });
  await event(batchId, "warn", `Paused: ${reason}`);
}

async function processItem(item) {
  const batch = await Batch.findById(item.batchId);
  if (!batch || batch.status !== "running") return release(item, 1);
  let user, key;
  try { ({ user, key } = await loadUser(batch.userId)); } catch (e) { return failItem(item, batch, e); }
  const source = connectionOf(user, key, batch.sourceConnectionId);
  if (!source || source.status !== "connected") { await release(item, 1); return pauseBatch(batch._id, "The source Google account is not connected. Reconnect it, then resume."); }
  const meta = unsealItem(item, key);
  try {
    // 1. a fresh link from Google for this item
    let cached = urlCache.get(String(batch._id));
    if (!cached || Date.now() - cached.at > URL_TTL_MS || !cached.urls.get(item.pickedId)) cached = { urls: await refreshUrls(batch, user, key, source) };
    let base = cached.urls.get(item.pickedId);
    if (!base) throw fail(410, "Google no longer offers this item (the picking session may have expired).", { permanent: true });
    const suffix = meta.type === "VIDEO" ? "=dv" : "=d";
    let download = await authed(user, key, source, base + suffix);
    if ([403, 404, 410].includes(download.status)) { // the link expired early: get new ones once
      base = (await refreshUrls(batch, user, key, source)).get(item.pickedId);
      if (base) download = await authed(user, key, source, base + suffix);
    }
    if (!download.ok || !download.body) throw fail(download.status, `Google Photos answered ${download.status}.`, { permanent: download.status === 404 || download.status === 410 });
    const lengthHeader = Number(download.headers.get("content-length"));
    const size = Number.isFinite(lengthHeader) && lengthHeader > 0 ? lengthHeader : null;
    await Item.updateOne({ _id: item._id }, { $set: { status: "uploading", stageAt: new Date(), bytes: size || 0, leaseUntil: new Date(Date.now() + LEASE_MS) } });

    // 2. where it goes
    const allowed = batch.destinationIds?.length ? new Set(batch.destinationIds) : null;
    const connections = decode(user.photoConnections, key).filter((c) => !allowed || allowed.has(c.id));
    const settings = { safetyBufferGb: 2, defaultConnectionId: "", ...(decode(user.photoSettings, key)[0] || {}) };
    const folders = decode(user.photoFolders, key);
    const folder = folders.find((f) => f.id === batch.folderId) || null;
    const mimeType = download.headers.get("content-type")?.split(";")[0] || meta.mimeType || "application/octet-stream";
    const filename = meta.type === "VIDEO" && !/\.mp4$/i.test(meta.filename) ? meta.filename.replace(/\.[^.]+$/, "") + ".mp4" : meta.filename;
    const excluded = [];
    let target = null, sessionUri = "", refused = null;
    for (let tries = 0; tries < connections.length && !sessionUri; tries += 1) {
      target = pickDestination(connections, size || 0, { bufferGb: Number(settings.safetyBufferGb ?? 2), defaultId: settings.defaultConnectionId, excludeIds: excluded });
      if (!target) break;
      await freshToken(user, key, target);
      const parent = await ensureFolder(user, key, target, folder, folders);
      const r = await authed(user, key, target, `${DRIVE}/upload/drive/v3/files?uploadType=resumable&fields=id`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mimeType, ...(size ? { "X-Upload-Content-Length": String(size) } : {}) },
        body: JSON.stringify({ name: filename, mimeType, ...(parent ? { parents: [parent] } : {}), appProperties: { stashrImport: item.pickedId }, ...(meta.createTime ? { createdTime: meta.createTime } : {}) })
      });
      sessionUri = r.headers.get("location") || "";
      if (!sessionUri) {
        excluded.push(target.id);
        // Drive answers 403 for a full account too; only a permission refusal means the account must be reconnected.
        if (!refused && (r.status === 401 || r.status === 403) && !/quota/i.test(await r.text().catch(() => ""))) refused = target;
      }
    }
    if (!sessionUri) {
      await download.body.cancel().catch(() => {});
      await release(item, 1);
      if (refused) return pauseBatch(batch._id, `Google Drive refused uploads to ${refused.email || refused.label}. Reconnect that Google account, then resume.`);
      return pauseBatch(batch._id, "No connected Drive account has room for the next file. Free space or connect another account, then resume.");
    }

    // 3. stream it across
    let lastWrite = 0;
    const onBytes = (n) => {
      const now = Date.now();
      if (now - lastWrite < 3000) return;
      lastWrite = now;
      Item.updateOne({ _id: item._id }, { $set: { bytesDone: n, leaseUntil: new Date(now + LEASE_MS) } }).catch(() => {});
      Batch.exists({ _id: batch._id, status: "running" }).then((alive) => { if (!alive) download.body.cancel().catch(() => {}); }).catch(() => {});
    };
    let sent;
    try { sent = await putStream(sessionUri, download.body.getReader(), size, onBytes); }
    catch (e) { if (e.quota) { target.eligible = false; } throw e; }
    const trashSent = () => authed(user, key, target, `${DRIVE}/drive/v3/files/${encodeURIComponent(sent.file?.id || "")}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) }).catch(() => {});
    // Cancelled or paused mid-transfer: the download was cut short, so the Drive copy is partial. Remove it and put the item back.
    if ((await Batch.exists({ _id: batch._id, status: "running" })) === null) { if (sent.file?.id) await trashSent(); return release(item, 1); }
    // A stream that ended early must never be accepted as the whole file.
    if (size && sent.bytes !== size) { if (sent.file?.id) await trashSent(); throw fail(502, "The download from Google Photos ended early."); }

    // 4. verify
    await Item.updateOne({ _id: item._id }, { $set: { status: "verifying", stageAt: new Date(), bytes: sent.bytes, bytesDone: sent.bytes } });
    const check = await authed(user, key, target, `${DRIVE}/drive/v3/files/${encodeURIComponent(sent.file?.id || "")}?fields=id,name,mimeType,size,md5Checksum,createdTime,modifiedTime,thumbnailLink,webViewLink,imageMediaMetadata(width,height)`);
    const drive = check.ok ? await check.json() : null;
    const trash = trashSent;
    if (!drive) throw fail(502, "Drive could not confirm the uploaded file.");
    if (Number(drive.size) !== sent.bytes) { await trash(); throw fail(502, "The uploaded size does not match what was downloaded."); }
    if (drive.md5Checksum && drive.md5Checksum.toLowerCase() !== sent.md5) { await trash(); throw fail(502, "The uploaded checksum does not match what was downloaded."); }

    // 5. already in the library? (the same photo picked twice) keep one copy
    const fresh = await User.findById(user._id, "photoMedia");
    const media = decode(fresh?.photoMedia, key);
    if (drive.md5Checksum && media.some((m) => m.checksum === drive.md5Checksum && m.availabilityState === "available")) {
      await trash();
      return finishItem(item, "skipped", { error: "Already in your library.", bytes: sent.bytes }, { "counts.skipped": 1 });
    }
    const record = { id: `${target.id}:${drive.id}`, filename: drive.name, type: meta.type === "VIDEO" ? "video" : /screenshot/i.test(drive.name) ? "screenshot" : "photo", mimeType: drive.mimeType, size: Number(drive.size) / (1024 ** 3), takenAt: meta.createTime || drive.createdTime, modifiedAt: drive.modifiedTime, width: drive.imageMediaMetadata?.width || meta.width || null, height: drive.imageMediaMetadata?.height || meta.height || null, sourceConnectionId: target.id, providerFileId: drive.id, hasThumbnail: Boolean(drive.thumbnailLink), thumbnailUrl: drive.thumbnailLink || null, webViewUrl: drive.webViewLink || null, checksum: drive.md5Checksum || null, availabilityState: "available", account: target.email, tag: "Google Photos", favorite: false, archived: false, localId: `gphotos:${item.pickedId}`, folderId: batch.folderId || null, imported: true };
    await pushEntry(user, "photoMedia", record, key);
    target.usedGb = Number(target.usedGb || 0) + record.size;
    if (target._eid) await updateEntry(user, "photoConnections", target, key);
    await finishItem(item, "done", { bytes: sent.bytes, bytesDone: sent.bytes, driveFileId: drive.id, destinationConnectionId: target.id, mediaId: record.id, error: "" }, { "counts.done": 1, "counts.bytesDone": sent.bytes });
  } catch (error) {
    await failItem(item, batch, error);
  }
}

/* ───────────────────────── the worker loop ───────────────────────── */

let running = false;
let inFlight = 0;
const parallel = () => Math.max(1, Math.min(4, Number(process.env.PHOTO_IMPORT_PARALLEL) || 1));

async function finishBatches() {
  const batches = await Batch.find({ status: "running" }, "_id sessionId userId sourceConnectionId counts").limit(50);
  for (const b of batches) {
    const open = await Item.exists({ batchId: b._id, status: { $in: ["pending", ...ACTIVE] } });
    if (open) continue;
    const c = await Batch.findOneAndUpdate({ _id: b._id, status: "running" }, { $set: { status: "completed", finishedAt: new Date() } }, { returnDocument: "after" });
    if (!c) continue;
    urlCache.delete(String(b._id));
    await event(b._id, "info", `Finished: ${c.counts.done} imported, ${c.counts.skipped} already in the library, ${c.counts.failed} failed.`);
    try { // Google asks apps to delete a session when done
      const { user, key } = await loadUser(c.userId);
      const source = connectionOf(user, key, c.sourceConnectionId);
      if (source) await authed(user, key, source, `${PICKER}/sessions/${encodeURIComponent(c.sessionId)}`, { method: "DELETE" });
    } catch { /* best effort */ }
  }
}

async function claimNext() {
  const now = new Date();
  const batches = await Batch.find({ status: "running" }, "_id concurrency").sort({ updatedAt: 1 }).limit(20);
  for (const b of batches) {
    const busy = await Item.countDocuments({ batchId: b._id, status: { $in: ACTIVE }, leaseUntil: { $gt: now } });
    if (busy >= b.concurrency) continue;
    const item = await Item.findOneAndUpdate(
      { batchId: b._id, status: "pending", $or: [{ notBefore: null }, { notBefore: { $lte: now } }] },
      { $set: { status: "downloading", owner: OWNER, leaseUntil: new Date(Date.now() + LEASE_MS), stageAt: now, startedAt: now, error: "" }, $inc: { attempts: 1 } },
      { sort: { seq: 1 }, returnDocument: "after" }
    );
    if (item) { await Batch.updateOne({ _id: b._id }, { $set: { updatedAt: new Date() } }); return item; }
  }
  return null;
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    await Item.updateMany({ status: { $in: ACTIVE }, leaseUntil: { $lt: now } }, { $set: { status: "pending", leaseUntil: null, owner: "" } }); // a server stopped mid-item
    const waiting = await Batch.find({ status: "picking", $or: [{ lastPolled: null }, { lastPolled: { $lt: new Date(Date.now() - 5000) } }] }, "_id").limit(20);
    for (const b of waiting) await pollBatch(b._id);
    await finishBatches();
    while (inFlight < parallel()) {
      const item = await claimNext();
      if (!item) break;
      inFlight += 1;
      processItem(item).catch((e) => console.error("[photo-import] item error", e.message)).finally(() => { inFlight -= 1; setImmediate(tick); });
    }
  } catch (error) { console.error("[photo-import] tick failed", error.message); }
  finally { running = false; }
}

let timer = null;
function startImportWorker() {
  if (timer || String(process.env.PHOTO_IMPORT_WORKER).toLowerCase() === "false") return;
  timer = setInterval(tick, 4000);
  timer.unref?.();
  setTimeout(tick, 2000);
  console.info(`[photo-import] worker on (${OWNER}, ${parallel()} at a time)`);
}

/* ───────────────────────── controls and reporting ───────────────────────── */

async function control(userId, batchId, action) {
  const batch = await Batch.findOne({ _id: batchId, userId });
  if (!batch) throw fail(404, "Import not found.");
  const set = (status, extra = {}) => Batch.updateOne({ _id: batch._id }, { $set: { status, pauseReason: "", ...extra } });
  if (action === "pause" && batch.status === "running") { await set("paused", { pauseReason: "Paused by you." }); await event(batch._id, "info", "Paused by you."); }
  else if (action === "resume" && batch.status === "paused") {
    // Paused while still choosing (no items yet): go back to the picker. Marking it "running" would finish it with nothing.
    if (await Item.exists({ batchId: batch._id })) { await set("running"); await event(batch._id, "info", "Resumed."); }
    else { await set("picking"); await event(batch._id, "info", "Resumed. Checking your Google Photos selection…"); await pollBatch(batch._id); }
  }
  else if (action === "cancel" && ["picking", "running", "paused"].includes(batch.status)) { await set("cancelled", { finishedAt: new Date() }); await event(batch._id, "info", "Cancelled. Files already imported stay in Drive."); }
  else if (action === "retry-failed") {
    const r = await Item.updateMany({ batchId: batch._id, status: "failed" }, { $set: { status: "pending", attempts: 0, error: "", notBefore: null, leaseUntil: null } });
    if (r.modifiedCount) { await Batch.updateOne({ _id: batch._id }, { $inc: { "counts.failed": -r.modifiedCount }, $set: { status: "running", pauseReason: "", finishedAt: null } }); await event(batch._id, "info", `Retrying ${r.modifiedCount} failed item(s).`); }
  } else if (action === "check") await pollBatch(batch._id);
  else throw fail(409, "That action does not apply to this import right now.");
  return Batch.findById(batch._id);
}

async function removeBatch(userId, batchId) {
  const batch = await Batch.findOne({ _id: batchId, userId });
  if (!batch) throw fail(404, "Import not found.");
  if (["running", "listing"].includes(batch.status)) throw fail(409, "Pause or cancel the import before deleting it.");
  await Item.deleteMany({ batchId: batch._id });
  await Batch.deleteOne({ _id: batch._id });
  urlCache.delete(String(batch._id));
}

module.exports = { createBatch, pollBatch, control, removeBatch, startImportWorker, unsealItem, tick };
