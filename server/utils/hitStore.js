/*
 * Counters for rate limiting and account lockout. They live in MongoDB so a restart (or a second instance) does not
 * reset them; when the database is not connected or a call fails they fall back to this process's memory, so a
 * database problem never locks everybody out.
 */
const mongoose = require("mongoose");
const RateHit = require("../models/RateHit");

const memory = new Map(); // key -> { count, reset }
const dbReady = () => mongoose.connection && mongoose.connection.readyState === 1;

function memHit(key, windowMs, now) {
  let entry = memory.get(key);
  if (!entry || entry.reset <= now) { entry = { count: 0, reset: now + windowMs }; memory.set(key, entry); }
  entry.count += 1;
  return { count: entry.count, resetAt: entry.reset };
}

/** Adds one to the counter for `key` (starting a new window when the old one ended). Returns { count, resetAt }. */
async function hit(key, windowMs, now = Date.now()) {
  if (dbReady()) {
    try {
      const doc = await RateHit.findOneAndUpdate(
        { _id: key },
        [{
          $set: {
            count: { $cond: [{ $lte: ["$expireAt", new Date(now)] }, 1, { $add: [{ $ifNull: ["$count", 0] }, 1] }] },
            expireAt: { $cond: [{ $lte: ["$expireAt", new Date(now)] }, new Date(now + windowMs), "$expireAt"] }
          }
        }],
        { upsert: true, returnDocument: "after" }
      ).lean();
      return { count: doc.count, resetAt: new Date(doc.expireAt).getTime() };
    } catch (e) { /* fall through to memory */ }
  }
  return memHit(key, windowMs, now);
}

/** Takes one away again (used when a request turned out to be fine). */
async function unhit(key) {
  const entry = memory.get(key);
  if (entry && entry.count > 0) entry.count -= 1;
  if (dbReady()) {
    try { await RateHit.updateOne({ _id: key, count: { $gt: 0 } }, { $inc: { count: -1 } }); } catch (e) { /* ignore */ }
  }
}

/** Current count without changing it (0 when there is none or the window ended). */
async function peek(key, now = Date.now()) {
  if (dbReady()) {
    try {
      const doc = await RateHit.findById(key).lean();
      return doc && new Date(doc.expireAt).getTime() > now ? doc.count : 0;
    } catch (e) { /* fall through */ }
  }
  const entry = memory.get(key);
  return entry && entry.reset > now ? entry.count : 0;
}

async function reset(key) {
  memory.delete(key);
  if (dbReady()) { try { await RateHit.deleteOne({ _id: key }); } catch (e) { /* ignore */ } }
}

module.exports = { hit, unhit, peek, reset };
