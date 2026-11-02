/*
 * A thin wrapper around the native module that reads bank SMS (mobile/modules/stashr-sms). If the module is not in this build (the web, an
 * older APK) every call answers "no permission / nothing" instead of throwing, so the Money screen can explain instead of crashing.
 */
let native = null;
try { native = require("stashr-sms"); } catch (e) { /* not installed as a package */ }
if (!native) { try { native = require("../../modules/stashr-sms"); } catch (e) { /* not in this build */ } }
const mod = native && (native.default || native);

export const smsAvailable = () => Boolean(mod && typeof mod.readBankSms === "function");

export async function hasPermission() {
  try { return smsAvailable() ? Boolean(await mod.hasPermission()) : false; } catch (e) { return false; }
}
export async function requestPermission() {
  try { return smsAvailable() ? Boolean(await mod.requestPermission()) : false; } catch (e) { return false; }
}
/** -> [{ address, body, date(ms) }] oldest first; only messages that look like the bank's (match, e.g. "fed"). */
export async function readBankSms({ sinceMs, limit = 2000, match = "fed" } = {}) {
  if (!smsAvailable()) return [];
  const rows = await mod.readBankSms({ sinceMs: Math.max(0, Number(sinceMs) || 0), limit, match });
  return (Array.isArray(rows) ? rows : [])
    .filter((m) => m && typeof m.body === "string" && Number.isFinite(Number(m.date)))
    .map((m) => ({ address: String(m.address || ""), body: m.body, date: Number(m.date) }))
    .sort((a, b) => a.date - b.date);
}
export async function newestBankSmsDate(match = "fed") {
  try { return smsAvailable() && mod.getNewestBankSmsDate ? Number(await mod.getNewestBankSmsDate(match)) || 0 : 0; } catch (e) { return 0; }
}
/** Cheap: true when a bank SMS arrived after `ms`. When the module cannot say, answers true so a sync still happens. */
export async function hasNewSince(ms) {
  try { return smsAvailable() && mod.hasNewSince ? Boolean(await mod.hasNewSince(Number(ms) || 0)) : true; } catch (e) { return true; }
}
