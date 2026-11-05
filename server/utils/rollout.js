/**
 * Who is offered a new app version. The update check (GET /api/mobile-updates/<app>/latest) is open to anyone, so this only decides
 * whether the answer says "an update is available": "all" = everyone (the old behaviour), "hold" = nobody, "selected" = only the devices
 * you ticked. A device is recognised by its own token, which the apps send with the check (older versions do not: they are anonymous,
 * so they are offered the update only in "all" mode). The APK itself stays a public GitHub release; this controls what the apps offer.
 */
const AppRollout = require("../models/appRollout");
const HomeDevice = require("../models/homeDevice");
const home = require("./home");

const APPS = ["where", "hub", "tv", "android"];
// What a release does when you have not chosen yet. Location is held: it carries Room Lab, which is tried on one phone first.
const DEFAULT_MODE = { where: "hold", hub: "all", tv: "all", android: "all" };
const cache = new Map();            // app -> { at, policy }
const TTL = 10_000;

/** The pure rule. policy: { defaultMode, rules }; deviceId may be "" (anonymous). */
function allows(policy, versionCode, deviceId) {
    const rule = (policy && policy.rules && policy.rules[String(versionCode)]) || { mode: (policy && policy.defaultMode) || "all" };
    if (rule.mode === "all") return true;
    if (rule.mode === "selected") return Boolean(deviceId) && Array.isArray(rule.devices) && rule.devices.includes(String(deviceId));
    return false;                    // "hold", or anything unknown
}

async function policyOf(app) {
    const hit = cache.get(app);
    if (hit && Date.now() - hit.at < TTL) return hit.policy;
    const row = await AppRollout.findOne({ app }).lean().catch(() => null);
    const policy = row ? { defaultMode: row.defaultMode, rules: row.rules || {} } : { defaultMode: DEFAULT_MODE[app] || "all", rules: {} };
    cache.set(app, { at: Date.now(), policy });
    return policy;
}
const forget = (app) => cache.delete(app);

/** The device that sent this update check (its own token in the Authorization header), or "". */
async function deviceIdOf(req) {
    const m = /^Bearer (sh_[a-f0-9]{48})$/.exec((req.headers && req.headers.authorization) || "");
    if (!m) return "";
    const d = await HomeDevice.findOne({ tokenHash: home.hashToken(m[1]) }).select("_id").lean().catch(() => null);
    return d ? String(d._id) : "";
}

/** Is this release offered to whoever sent `req`? The main app ("android") cannot be told apart per device, so "selected" counts as "hold" there. */
async function offered(app, versionCode, req) {
    const policy = await policyOf(app);
    return allows(policy, versionCode, app === "android" ? "" : await deviceIdOf(req));
}

module.exports = { APPS, DEFAULT_MODE, allows, policyOf, deviceIdOf, offered, forget };
