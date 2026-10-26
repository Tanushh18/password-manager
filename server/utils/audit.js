const crypto = require("crypto");
const AuditEvent = require("../models/AuditEvent");

/* "Chrome on Android" style label from a User-Agent, short enough to show in a list. Never trusted for security. */
function deviceLabel(ua) {
  const s = String(ua || "");
  if (!s) return "Unknown device";
  if (/okhttp|Expo|ReactNative|Dalvik/i.test(s)) return "Stashr app";
  const browser = /Edg\//.test(s) ? "Edge" : /OPR\/|Opera/.test(s) ? "Opera" : /Firefox\//.test(s) ? "Firefox" : /Chrome\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : "Browser";
  const os = /Android/.test(s) ? "Android" : /iPhone|iPad|iOS/.test(s) ? "iOS" : /Windows/.test(s) ? "Windows" : /Mac OS X|Macintosh/.test(s) ? "macOS" : /Linux/.test(s) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

const clientIp = (req) => String((req && (req.ip || (req.connection && req.connection.remoteAddress))) || "").slice(0, 64);

/** Public id for a session: a short hash of its token, so the token itself is never sent to the browser. */
const sessionId = (token) => crypto.createHash("sha256").update(String(token)).digest("hex").slice(0, 16);

/** Records an event. Never throws and never blocks the request: auditing must not break sign-in. */
function record(req, userId, action, detail = "") {
  try {
    AuditEvent.create({ userId, action, ip: clientIp(req), device: deviceLabel(req && req.headers && req.headers["user-agent"]), detail: String(detail).slice(0, 200) }).catch(() => {});
  } catch (e) { /* ignore */ }
}

module.exports = { record, deviceLabel, clientIp, sessionId };
