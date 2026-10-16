const crypto = require("crypto");
const Unsupported = require("../models/UnsupportedService");

const userHash = (userId) => crypto.createHash("sha256").update("stashr-unsupported:" + String(userId)).digest("hex").slice(0, 20);
const MAX_VARS = 40;
const MAX_PACKAGES = 12;
const RECORD_EVERY_MS = 60 * 60 * 1000;
const seen = new Map(); // "userHash|key" -> time last written, so a page poll never turns into a database write

const clean = (list, max) => [...new Set((Array.isArray(list) ? list : []).map((x) => String(x || "").slice(0, 100)).filter(Boolean))].slice(0, max);

/** Remembers which services this user has that need a usage reader. Safe to call on every dashboard run. */
async function recordNeedsReader(userId, list, now = Date.now()) {
  const h = userHash(userId);
  for (const item of Array.isArray(list) ? list : []) {
    const key = String(item?.key || "").slice(0, 80);
    if (!/^[a-z0-9][a-z0-9:_-]{0,79}$/i.test(key)) continue;
    const memo = h + "|" + key;
    if (now - (seen.get(memo) || 0) < RECORD_EVERY_MS) continue;
    seen.set(memo, now);
    if (seen.size > 5000) seen.clear();
    const vars = clean(item.vars, 12), packages = clean(item.packages, 6);
    await Unsupported.updateOne(
      { key },
      { $set: { label: String(item.label || key).slice(0, 80), category: String(item.category || "Other").slice(0, 40), lastSeenAt: new Date(now) }, $addToSet: { userHashes: h }, $setOnInsert: { firstSeenAt: new Date(now) } },
      { upsert: true }
    ).catch(() => {});
    // Variable and package names are only collected until each list is long enough to write a reader from.
    if (vars.length) await Unsupported.updateOne({ key, [`vars.${MAX_VARS - 1}`]: { $exists: false } }, { $addToSet: { vars: { $each: vars } } }).catch(() => {});
    if (packages.length) await Unsupported.updateOne({ key, [`packages.${MAX_PACKAGES - 1}`]: { $exists: false } }, { $addToSet: { packages: { $each: packages } } }).catch(() => {});
  }
}

/** For the admin: what still needs a reader, counting every user except the admin's own account. */
async function listNeedsReader({ adminUserId, hasReader }) {
  const mine = userHash(adminUserId);
  const docs = await Unsupported.find({}).sort({ lastSeenAt: -1 }).limit(300).lean();
  return docs
    .filter((d) => !hasReader(d.key))
    .map((d) => ({ key: d.key, label: d.label, category: d.category, userCount: d.userHashes.filter((x) => x !== mine).length, vars: d.vars, packages: d.packages, firstSeenAt: d.firstSeenAt, lastSeenAt: d.lastSeenAt }))
    .filter((d) => d.userCount > 0)
    .sort((a, b) => b.userCount - a.userCount || a.label.localeCompare(b.label));
}

module.exports = { recordNeedsReader, listNeedsReader, userHash };
