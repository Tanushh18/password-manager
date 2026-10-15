const crypto = require("crypto");

/* Pure: one-time 6-digit reset codes. Only a salted scrypt hash is stored; codes expire and allow 5 tries. */
const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_GAP_MS = 60 * 1000;
const MAX_SENDS_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");
const hashCode = (code, salt) => crypto.scryptSync(String(code), salt, 32).toString("hex");

/** May a new code be sent now? Returns { ok, state } with the updated send counters. */
function canSend(reset, now = Date.now()) {
  const r = reset || {};
  if (r.sentAt && now - new Date(r.sentAt).getTime() < RESEND_GAP_MS) return { ok: false, reason: "wait" };
  const windowStart = r.windowStart && now - new Date(r.windowStart).getTime() < 3600 * 1000 ? new Date(r.windowStart) : new Date(now);
  const sentCount = windowStart.getTime() === new Date(r.windowStart || 0).getTime() ? (r.sentCount || 0) : 0;
  if (sentCount >= MAX_SENDS_PER_HOUR) return { ok: false, reason: "hourly" };
  return { ok: true, windowStart, sentCount: sentCount + 1 };
}

function issue(now = Date.now(), counters = {}) {
  const code = newCode();
  const salt = crypto.randomBytes(16).toString("hex");
  return { code, state: { codeHash: hashCode(code, salt), salt, expiresAt: new Date(now + CODE_TTL_MS), attempts: 0, sentAt: new Date(now), windowStart: counters.windowStart || new Date(now), sentCount: counters.sentCount || 1 } };
}

/** { ok } or { ok: false, reason: "none" | "expired" | "locked" | "wrong" } plus the attempts to save. */
function verify(reset, code, now = Date.now()) {
  if (!reset || !reset.codeHash) return { ok: false, reason: "none" };
  if (now > new Date(reset.expiresAt).getTime()) return { ok: false, reason: "expired" };
  if ((reset.attempts || 0) >= MAX_ATTEMPTS) return { ok: false, reason: "locked" };
  if (!/^\d{6}$/.test(String(code || ""))) return { ok: false, reason: "wrong", attempts: (reset.attempts || 0) + 1 };
  const good = crypto.timingSafeEqual(Buffer.from(hashCode(code, reset.salt), "hex"), Buffer.from(reset.codeHash, "hex"));
  return good ? { ok: true } : { ok: false, reason: "wrong", attempts: (reset.attempts || 0) + 1 };
}

module.exports = { newCode, issue, verify, canSend, CODE_TTL_MS, MAX_ATTEMPTS };
