/**
 * The database side of the room model: saving labelled samples, finding the room of a live scan, remembering the smoothing state, and
 * writing a "Papa: Hall -> Bedroom" line on the timeline when the room really changes. See utils/roomModel.js for how the guess is made.
 */
const HomeDevice = require("../models/homeDevice");
const HomeSettings = require("../models/homeSettings");
const HomeRoomSample = require("../models/homeRoomSample");
const model = require("./roomModel");

const MAX_PER_ROOM = 80;        // samples kept per room and phone; the oldest go first
const MAX_ROOMS = 12;
const MAX_IDS = 40;             // strongest networks / devices kept from one scan
const FRESH_MS = 20 * 60 * 1000;

const cvCache = new Map();      // phone id -> { at, report }: the honest accuracy is recomputed at most every 30 s (it compares every sample with the rest)
const cache = new Map();        // phone id -> { at, samples }: the model is rebuilt from the database at most every 60 s, and at once after a change
const forget = (phone) => { cache.delete(String(phone)); cvCache.delete(String(phone)); };

/** The strongest MAX_IDS entries, ids hashed for this household: { wifi: [{ b, r }], ble: [{ b, r }] }. */
function hashScan(owner, scan) {
    const cut = (list) => (Array.isArray(list) ? list : [])
        .filter((x) => x && typeof x.b === "string" && x.b && Number(x.r) <= -1 && Number(x.r) >= -127)
        .sort((a, b) => Number(b.r) - Number(a.r)).slice(0, MAX_IDS)
        .map((x) => ({ b: model.hashId(owner, x.b), r: Math.round(Number(x.r)) }));
    return { wifi: cut(scan && scan.wifi), ble: cut(scan && scan.ble) };
}

const clean = (name) => String(name || "").replace(/[\u0000-\u001f<>&"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 24);

/** The account's home settings record, created if it does not exist yet (an update on a missing record would silently save nothing). */
const ensureSettings = (owner) => HomeSettings.updateOne({ owner }, { $setOnInsert: { owner } }, { upsert: true });

async function roomsOf(owner) {
    const s = await HomeSettings.findOne({ owner }).select("map.rooms").lean();
    return Array.isArray(s && s.map && s.map.rooms) ? s.map.rooms : [];
}

async function samplesOf(owner, phone, now = Date.now()) {
    const hit = cache.get(String(phone));
    if (hit && now - hit.at < 60000) return hit.samples;
    const rows = await HomeRoomSample.find({ owner, phone }).sort({ at: -1 }).limit(2000).lean();
    const samples = rows.map((r) => ({ room: r.room, vec: model.vectorOf({ wifi: r.wifi, ble: r.ble }), at: new Date(r.at).getTime(), session: r.session }));
    cache.set(String(phone), { at: now, samples });
    return samples;
}

/** Saves the scans of one tap under a room. Returns how many samples that room now has. */
async function store(owner, phone, room, scans, { session = "", src = "train", now = Date.now() } = {}) {
    const rooms = await roomsOf(owner);
    if (!rooms.includes(room)) throw Object.assign(new Error("That room is not in the list."), { status: 400 });
    const docs = (Array.isArray(scans) ? scans : []).slice(0, 40).map((sc) => ({ owner, phone, room, session: String(session).slice(0, 40), src, at: new Date(now), ...hashScan(owner, sc) }))
        .filter((d) => d.wifi.length + d.ble.length >= 2);
    if (!docs.length) throw Object.assign(new Error("The scan heard almost nothing: switch Wi-Fi and Bluetooth on and try again."), { status: 400 });
    await HomeRoomSample.insertMany(docs);
    const keep = await HomeRoomSample.find({ owner, phone, room }).sort({ at: -1 }).skip(MAX_PER_ROOM).select("_id").lean();
    if (keep.length) await HomeRoomSample.deleteMany({ _id: { $in: keep.map((k) => k._id) } });
    forget(phone);
    return { added: docs.length, count: await HomeRoomSample.countDocuments({ owner, phone, room }) };
}

async function counts(owner, phone) {
    const rows = await HomeRoomSample.aggregate([{ $match: { owner, phone } }, { $group: { _id: "$room", n: { $sum: 1 } } }]);
    return Object.fromEntries(rows.map((r) => [r._id, r.n]));
}

/** A live scan from a phone with room location on: guess, smooth, remember in status.room, and note a real change. Never throws. */
async function update(device, scan, now = Date.now()) {
    try {
        if (!device.roomOn || !scan) return null;
        const samples = await samplesOf(device.owner, device._id, now);
        const hashed = hashScan(device.owner, scan);
        if (hashed.wifi.length + hashed.ble.length < 2) return null;
        const guess = model.classify(samples, model.vectorOf(hashed), now);
        const prev = (device.status && device.status.room) || {};
        const next = model.smooth({ room: prev.name || null, pending: prev.pending || null, count: prev.count || 0 }, guess.room);
        const room = {
            name: next.state.room, pending: next.state.pending, count: next.state.count, confidence: guess.confidence, sure: Boolean(guess.room), ranking: guess.ranking, why: guess.why, at: now,
            nearest: guess.nearest, heard: { wifi: hashed.wifi.length, ble: hashed.ble.length }, samples: samples.length
        };
        await HomeDevice.updateOne({ _id: device._id }, { $set: { "status.room": room } });
        if (next.changed && prev.name && next.state.room) {
            const { record } = require("./homeEvents");
            await record({ owner: device.owner, device: device._id, deviceName: device.name, person: device.person || device.name, kind: "room_change", text: `${device.person || device.name}: ${prev.name} → ${next.state.room}` });
        }
        return room;
    } catch (e) { return null; }
}

/** The honest accuracy of one phone's training (see roomModel.crossValidate), with a plain verdict. Cached for 30 seconds. */
async function reportOf(owner, phone, now = Date.now()) {
    const hit = cvCache.get(String(phone));
    if (hit && now - hit.at < 30000) return hit.report;
    const samples = await samplesOf(owner, phone, now);
    const cv = model.crossValidate(samples, now);
    const rooms = [...new Set(samples.map((s) => s.room))];
    let verdict = "Train at least two rooms (a few spots each) to see how well it works.";
    if (rooms.length >= 2 && cv.tested) verdict = cv.accuracy >= 85 ? "Good: rooms are told apart well." : cv.accuracy >= 65 ? "Fair: add more spots in the rooms that get mixed up." : "Weak: rooms sound too alike here. Add more spots, or put a Bluetooth beacon in each room.";
    const report = { ...cv, rooms, verdict };
    cvCache.set(String(phone), { at: now, report });
    return report;
}

/** How often the person said the room was right, from their own "Sahi hai" / "Galat hai" taps. null until there is at least one. */
function fieldOf(device) {
    const s = (device && device.roomStats) || {};
    const confirmed = Number(s.confirmed) || 0, wrong = Number(s.wrong) || 0, total = confirmed + wrong;
    return { confirmed, wrong, total, accuracy: total ? Math.round((100 * confirmed) / total) : null };
}

/**
 * EVERYTHING the model knows right now, in one shape, for the website and the tablet (so both always show the same numbers):
 * is it running, and for each phone: the room and how sure, every room's share, the distance to the nearest sample, how many networks it
 * heard, how many samples it has, the honest accuracy (hide-and-guess) and the real-life accuracy (the person's own taps).
 */
async function liveReport(owner, now = Date.now()) {
    const settings = await HomeSettings.findOne({ owner }).select("map.rooms map.model").lean();
    const map = (settings && settings.map) || {};
    const rooms = Array.isArray(map.rooms) ? map.rooms : [];
    const phones = (await HomeDevice.find({ owner, kind: "phone" }).lean()).filter((p) => (p.status || {}).agent === "stashr-where");
    const out = [];
    for (const p of phones) {
        const c = await counts(owner, p._id);
        const trainedRooms = Object.keys(c).filter((r) => c[r] > 0 && rooms.includes(r));
        const r = (p.status || {}).room || null;
        const rep = await reportOf(owner, p._id, now);
        out.push({
            id: String(p._id), person: p.person || p.name, on: Boolean(p.roomOn), trained: trainedRooms.length >= 2, trainedRooms: trainedRooms.length, counts: c, total: Object.values(c).reduce((a, b) => a + b, 0),
            current: r && r.name ? { name: r.name, confidence: r.confidence || 0, sure: r.sure !== false, ranking: r.ranking || [], nearest: r.nearest ?? null, heard: r.heard || { wifi: 0, ble: 0 }, samples: r.samples || 0, why: r.why || "", at: r.at, ageSec: Math.max(0, Math.round((now - Number(r.at)) / 1000)), fresh: now - Number(r.at) <= FRESH_MS } : null,
            cv: { accuracy: rep.accuracy, tested: rep.tested, unsure: rep.unsure, perRoom: rep.perRoom, thin: rep.thin, verdict: rep.verdict }, field: fieldOf(p), lastSeen: p.lastSeen || null
        });
    }
    const judged = out.filter((p) => p.cv.tested), fielded = out.filter((p) => p.field.total);
    return {
        running: Boolean(map.model && map.model.running), startedAt: (map.model && map.model.startedAt) || null, rooms, at: now, phones: out,
        summary: { phones: out.length, on: out.filter((p) => p.on).length, trained: out.filter((p) => p.trained).length, cvAccuracy: judged.length ? Math.round(judged.reduce((s, p) => s + p.cv.accuracy, 0) / judged.length) : null, fieldAccuracy: fielded.length ? Math.round(fielded.reduce((s, p) => s + p.field.accuracy * p.field.total, 0) / fielded.reduce((s, p) => s + p.field.total, 0)) : null }
    };
}

/**
 * Start or stop the model for the whole home. Starting turns room location on for every phone that has trained at least two rooms
 * (the others are listed with why not) and asks them to report at once; stopping turns it off everywhere.
 */
async function setModel(owner, on, now = Date.now()) {
    const phones = (await HomeDevice.find({ owner, kind: "phone" }).lean()).filter((p) => (p.status || {}).agent === "stashr-where");
    const rooms = await roomsOf(owner);
    const started = [], blocked = [];
    for (const p of phones) {
        const c = await counts(owner, p._id);
        const trained = Object.keys(c).filter((r) => c[r] > 0 && rooms.includes(r)).length >= 2;
        if (on && !trained) { blocked.push({ person: p.person || p.name, why: "Is phone par kam se kam 2 kamre train karo (Stashr Location → Room Lab)." }); await HomeDevice.updateOne({ _id: p._id }, { $set: { roomOn: false } }); continue; }
        await HomeDevice.updateOne({ _id: p._id }, { $set: { roomOn: on } });
        if (on) started.push(p.person || p.name);
        forget(p._id);
    }
    await HomeSettings.updateOne({ owner }, { $set: { "map.model": { running: on && started.length > 0, startedAt: on && started.length ? now : null } } }, { upsert: false });
    if (on && started.length) void require("./phonePush").nudgeOwner(owner, now).catch(() => {});      // ask them to report now, so the first room shows at once
    return { running: on && started.length > 0, started, blocked };
}

/** The room of a phone as the page and Telegram say it: only when it is recent. */
function currentOf(device, now = Date.now()) {
    const r = device.status && device.status.room;
    if (!r || !r.name || now - Number(r.at) > FRESH_MS) return null;
    return r;
}

module.exports = { hashScan, clean, ensureSettings, roomsOf, samplesOf, store, counts, update, currentOf, forget, reportOf, fieldOf, liveReport, setModel, MAX_ROOMS };
