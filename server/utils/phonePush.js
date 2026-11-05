/**
 * Wakes family phones by Firebase push when their location has gone quiet, so "Location not updating" fixes itself.
 *  - nudgeStale(): the minute sweep. A phone whose last report is older than STALE_MS is asked to report (type "locate": the app
 *    answers the cheap way when it has not moved). At most one ask per 15 minutes per phone, backing off to 1 h and 3 h while the
 *    phone keeps not answering (switched off, no signal, app force-stopped), so a dead phone costs nothing.
 *  - nudgeOwner(): the "Refresh location" button / "/locate" in Telegram: every phone with a push address is asked for a real fix now
 *    (type "now").
 * Several server copies share one database, so each ask is claimed with one atomic write first: only the copy that wins sends it.
 */
const HomeDevice = require("../models/homeDevice");
const HomeSettings = require("../models/homeSettings");
const fcm = require("./fcm");

const STALE_MS = 20 * 60 * 1000;
const EVERY_MS = 15 * 60 * 1000;
const NOW_EVERY_MS = 20 * 1000;

/** How long to leave a phone alone after it ignored `misses` asks in a row. */
const backoff = (misses) => (misses >= 8 ? 3 * 3600_000 : misses >= 3 ? 3600_000 : EVERY_MS);

const fixAt = (p) => Number(p.status && p.status.location && p.status.location.at) || 0;

/** Claims the right to ask this phone now. Returns true for exactly one caller. */
async function claim(p, now, every, misses) {
    const cut = new Date(now - every);
    const res = await HomeDevice.updateOne(
        { _id: p._id, $or: [{ fcmPushedAt: { $exists: false } }, { fcmPushedAt: null }, { fcmPushedAt: { $lte: cut } }] },
        { $set: { fcmPushedAt: new Date(now), fcmFixAt: fixAt(p), fcmMisses: misses } }
    );
    return res.modifiedCount === 1;
}

async function ask(p, type) {
    const r = await fcm.sendLocate(p.fcmToken, type);
    if (r.dead) await HomeDevice.updateOne({ _id: p._id }, { $set: { fcmToken: "" } }).catch(() => {});
    return r.ok;
}

const withToken = (q) => HomeDevice.find(q).select("+fcmToken").lean();

async function nudgeStale(now = Date.now()) {
    if (!fcm.enabled()) return 0;
    const owners = await HomeSettings.find({ "homeSpot.lat": { $type: "number" } }).distinct("owner");
    if (!owners.length) return 0;
    const phones = await withToken({ owner: { $in: owners }, kind: "phone", "status.agent": "stashr-where", fcmToken: { $nin: ["", null] } });
    let sent = 0;
    for (const p of phones) {
        const at = fixAt(p), seen = p.lastSeen ? new Date(p.lastSeen).getTime() : 0;
        if (Math.max(at, seen) > now - STALE_MS) continue;        // reported recently: leave it alone
        // The last ask got no answer when the phone's fix time has not moved since.
        const misses = p.fcmFixAt !== undefined && p.fcmFixAt !== null && at <= p.fcmFixAt && p.fcmPushedAt ? (p.fcmMisses || 0) + 1 : 0;
        if (!(await claim(p, now, backoff(p.fcmMisses || 0), misses))) continue;
        if (await ask(p, "locate")) sent++;
    }
    return sent;
}

/** Ask every phone of this account (that has a push address) for a real fix now. Returns how many were asked. */
async function nudgeOwner(owner, now = Date.now()) {
    if (!fcm.enabled()) return 0;
    const phones = await withToken({ owner, kind: "phone", "status.agent": "stashr-where", fcmToken: { $nin: ["", null] } });
    let sent = 0;
    for (const p of phones) {
        if (!(await claim(p, now, NOW_EVERY_MS, p.fcmMisses || 0))) continue;
        if (await ask(p, "now")) sent++;
    }
    return sent;
}

module.exports = { nudgeStale, nudgeOwner, backoff, STALE_MS, EVERY_MS };
