/*
 * Where a statement check stands. Uploading a statement answers at once ("received"); reading it, matching it with the stored entries and
 * saving the changes then run in the background, and this small in-memory register is what the website polls for progress.
 *
 * It lives in the server process: if the server restarts in the middle of a check the job is gone ("not found"), and uploading the same
 * statement again is safe (matching is repeatable, nothing is added twice). Only the numbers of the result are kept, never the file.
 */
const crypto = require("crypto");

const KEEP_MS = 60 * 60 * 1000;          // a finished job can be looked at for an hour
const STALE_MS = 10 * 60 * 1000;         // a check that has not finished in ten minutes is given up on
const jobs = new Map();                  // id -> job
const latestOf = new Map();              // owner -> id of the newest job

function clean(now = Date.now()) {
    for (const [id, j] of jobs) {
        if (j.finishedAt && now - j.finishedAt > KEEP_MS) { jobs.delete(id); if (latestOf.get(j.owner) === id) latestOf.delete(j.owner); }
        else if (!j.finishedAt && now - j.startedAt > STALE_MS) { j.status = "failed"; j.error = "The check took too long and was stopped. Upload the statement again."; j.finishedAt = now; }
    }
}

function create(owner, info = {}, now = Date.now()) {
    clean(now);
    const id = crypto.randomBytes(8).toString("hex");
    const job = { id, owner: String(owner), status: "queued", stage: "uploaded", text: "Received. Starting…", pct: 3, startedAt: now, finishedAt: 0, report: null, error: "", ...info };
    jobs.set(id, job);
    latestOf.set(job.owner, id);
    return job;
}

/** p = { stage, text, pct }. The bar only moves forward and never shows 100 until the job is finished. */
function progress(id, p) {
    const j = jobs.get(id);
    if (!j || j.finishedAt) return;
    j.status = "running";
    if (p.stage) j.stage = p.stage;
    if (p.text) j.text = p.text;
    if (Number.isFinite(p.pct)) j.pct = Math.max(j.pct, Math.min(99, Math.round(p.pct)));
}

function finish(id, report, now = Date.now()) {
    const j = jobs.get(id);
    if (!j || j.finishedAt) return;
    Object.assign(j, { status: "done", stage: "done", text: "Done", pct: 100, report, finishedAt: now });
}

function fail(id, message, now = Date.now()) {
    const j = jobs.get(id);
    if (!j || j.finishedAt) return;
    Object.assign(j, { status: "failed", stage: "failed", error: String(message || "Could not check the statement."), finishedAt: now });
}

/** A job of this owner (by id), or their newest one when no id is given. */
function get(owner, id = "", now = Date.now()) {
    clean(now);
    const j = jobs.get(id || latestOf.get(String(owner)));
    return j && j.owner === String(owner) ? j : null;
}

/** The unfinished job of this owner, if any (one check at a time). */
function running(owner, now = Date.now()) {
    clean(now);
    const j = jobs.get(latestOf.get(String(owner)));
    return j && !j.finishedAt ? j : null;
}

/** What the website may see: no owner id. */
const view = (j) => ({ id: j.id, status: j.status, stage: j.stage, text: j.text, pct: j.pct, startedAt: j.startedAt, finishedAt: j.finishedAt, filename: j.filename || "", report: j.report, error: j.error });

const _reset = () => { jobs.clear(); latestOf.clear(); };

module.exports = { create, progress, finish, fail, get, running, view, _reset };
