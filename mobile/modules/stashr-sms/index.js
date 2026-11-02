import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

/*
 * Reads bank SMS for the Money feature. Android only; everywhere else (Expo Go, web, iOS) every call is a harmless no-op that
 * returns false / [] / null and logs once. The messages are returned to JS only: this module never sends anything anywhere.
 */
const native = Platform.OS === "android" ? requireOptionalNativeModule("StashrSms") : null;
let warned = false;
const missing = () => {
  if (!warned) {
    warned = true;
    // eslint-disable-next-line no-console
    console.warn("StashrSms native module is not available in this build; SMS sync is off.");
  }
};

export const smsSupported = Boolean(native);

/** Both SMS permissions granted? */
export const hasPermission = () => {
  if (!native) { missing(); return false; }
  try { return Boolean(native.hasPermission()); } catch (e) { return false; }
};

/** Shows Android's permission dialogs (READ_SMS + RECEIVE_SMS); resolves true when both are granted. */
export const requestPermission = async () => {
  if (!native) { missing(); return false; }
  try { return Boolean(await native.requestPermission()); } catch (e) { return false; }
};

/**
 * Bank messages from the inbox dated `sinceMs` or later (never older), oldest first: [{ address, body, date (ms) }].
 * match: case-insensitive regex tested on the sender or the text (default "fed"). limit: default 500, at most 2000.
 * Throws an Error with code "E_SMS_PERMISSION" when SMS permission is missing.
 */
export const readBankSms = async ({ sinceMs, limit = 500, match = "fed" } = {}) => {
  if (!Number.isFinite(sinceMs) || sinceMs <= 0) throw new TypeError("readBankSms needs sinceMs (a time in milliseconds).");
  if (!native) { missing(); return []; }
  const rows = await native.readBankSms(sinceMs, Math.min(Math.max(Math.floor(limit) || 500, 1), 2000), String(match || "fed"));
  return (rows || []).map((r) => ({ address: String(r.address || ""), body: String(r.body || ""), date: Number(r.date) }));
};

/** Date (ms) of the newest bank message, or null. Cheap. */
export const getNewestBankSmsDate = (match = "fed") => {
  if (!native) { missing(); return null; }
  const v = native.getNewestBankSmsDate(String(match || "fed"));
  return Number.isFinite(v) ? v : null;
};

/** When the receiver last saw a bank message arrive (ms); 0 if it never has. */
export const getLastArrival = () => (native ? Number(native.getLastArrival()) || 0 : 0);

/**
 * Cheap check for a background task: true when a bank message may have arrived after `lastSeenMs`.
 * It is true when the receiver has never recorded anything (so the caller reads the inbox once and nothing is missed).
 */
export const hasNewSince = (lastSeenMs) => {
  if (!native) { missing(); return false; }
  return Boolean(native.hasNewSince(Number(lastSeenMs) || 0));
};

/** Which messages the arrival note looks for; use the same text you pass as `match`. */
export const setArrivalMatch = (match) => { if (native) native.setArrivalMatch(String(match || "fed")); };
