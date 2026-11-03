import * as SecureStore from "expo-secure-store";
import { money } from "./moneyApi";
import { hasPermission, readBankSms, newestBankSmsDate } from "./sms";

/*
 * Sends new bank SMS to the server (which writes them to the owner's Google Sheet). Nothing is kept on the phone except small
 * cursors: how far we have read, when the last message arrived, the last result line and the last error text. Never reads
 * anything older than the start date the owner chose once.
 */
const K = { cursor: "stashr.money.cursor", arrival: "stashr.money.arrival", ran: "stashr.money.ran", rescan: "stashr.money.rescan", result: "stashr.money.result", error: "stashr.money.error" };
const get = async (k) => { try { return await SecureStore.getItemAsync(k); } catch (e) { return null; } };
const put = (k, v) => SecureStore.setItemAsync(k, String(v)).catch(() => {});
const del = (k) => SecureStore.deleteItemAsync(k).catch(() => {});

const BATCH = 100;
const OVERLAP_MS = 5 * 60 * 1000;
export const istMidnight = (ymd) => Date.parse(`${ymd}T00:00:00+05:30`);

/** Pure: where to start reading and what to send. */
export function planSync({ startDate, serverCursor, localCursor }, messages) {
  const startMs = istMidnight(startDate);
  const cursor = Math.max(Number(serverCursor) || 0, Number(localCursor) || 0);
  const since = Math.max(cursor ? cursor - OVERLAP_MS : startMs, startMs);
  const fresh = (messages || []).filter((m) => m.date >= startMs && m.date >= since).sort((a, b) => a.date - b.date);
  const batches = [];
  for (let i = 0; i < fresh.length; i += BATCH) batches.push(fresh.slice(i, i + BATCH));
  return { startMs, since, batches, count: fresh.length };
}

export const lastResult = async () => {
  const [result, error, ran] = await Promise.all([get(K.result), get(K.error), get(K.ran)]);
  let parsed = null;
  try { parsed = result ? JSON.parse(result) : null; } catch (e) { parsed = null; }
  return { result: parsed, error: error || "", ran: Number(ran) || 0 };
};

let running = null;
const listeners = new Set();
/** A screen that is open can listen for a finished pass (the website may have asked for one) and show the new numbers. */
export const onMoneySynced = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const tell = () => listeners.forEach((fn) => { try { fn(); } catch (e) { /* a screen went away */ } });

/** One pass. Resolves to { skipped } or { added, flagged, duplicates, ignored, unparsed, sent }. Never throws. */
export function syncNow() {
  if (running) return running;
  running = (async () => {
    try {
      const settings = await money.settings();
      // Tell the server what this pass found (or why it could not look), so the website can show a real status.
      const done = (result) => money.syncDone(result).catch(() => {});
      const skip = async (why) => { await done({ skipped: why }); return { skipped: why }; };
      if (!settings.configured) return skip("Add your Google Sheet first.");
      if (settings.needsStartDate || !settings.startDate) return skip("Choose how far back to read first.");
      if (!(await hasPermission())) return skip("Allow Stashr to read your SMS first.");
      // The start date was moved earlier on the website: read the older messages again, once (the server already reset its cursor).
      const rescanToken = String(Number(settings.rescanToken) || 0);
      const rescanning = rescanToken !== "0" && (await get(K.rescan)) !== rescanToken;
      const localCursor = rescanning ? 0 : Number(await get(K.cursor)) || 0;
      const startMs = istMidnight(settings.startDate);
      const first = Math.max(Math.max(Number(settings.lastSmsAt) || 0, localCursor) ? Math.max(Number(settings.lastSmsAt) || 0, localCursor) - OVERLAP_MS : startMs, startMs);
      const messages = await readBankSms({ sinceMs: first, limit: 3000 });
      const plan = planSync({ startDate: settings.startDate, serverCursor: settings.lastSmsAt, localCursor }, messages);
      const total = { added: 0, flagged: 0, duplicates: 0, ignored: 0, unparsed: 0, sent: 0 };
      for (const batch of plan.batches) {
        const r = await money.sms(batch.map((m) => ({ address: m.address, body: m.body, date: m.date })));
        if (r && r.needsStartDate) return skip("Choose how far back to read first.");
        total.added += r.added || 0; total.flagged += r.flagged || 0; total.duplicates += r.duplicates || 0; total.ignored += r.ignored || 0; total.unparsed += (r.unparsed || []).length; total.sent += batch.length;
        await put(K.cursor, Math.max(Number(r.lastSmsAt) || 0, batch[batch.length - 1].date));
      }
      const newest = await newestBankSmsDate();
      if (newest) await put(K.arrival, newest);
      await put(K.ran, Date.now());
      await put(K.result, JSON.stringify({ ...total, at: Date.now() }));
      await del(K.error);
      if (rescanning) await put(K.rescan, rescanToken);
      await done({ added: total.added, flagged: total.flagged, duplicates: total.duplicates });
      return total;
    } catch (e) {
      await put(K.error, String(e && e.message ? e.message : e).slice(0, 200));
      money.syncDone({ error: String(e && e.message ? e.message : e).slice(0, 160) }).catch(() => {});
      return { error: String(e && e.message ? e.message : e) };
    } finally {
      running = null;
      tell();
    }
  })();
  return running;
}

/** True when the website asked (Refresh) and this phone has not answered yet; then a pass runs. Cheap when nobody asked. */
export async function syncIfRequested() {
  try {
    const s = await money.settings();
    if (Number(s.syncRequestedAt) > Number(s.syncAckAt || 0)) return await syncNow();
  } catch (e) { /* no connection: the next try asks again */ }
  return null;
}

/** For the app coming to the front: at most one pass every 10 minutes. */
export async function syncIfStale(minutes = 10) {
  const ran = Number(await get(K.ran)) || 0;
  if (Date.now() - ran < minutes * 60000) return null;
  return syncNow();
}

export const lastSeenArrival = async () => Number(await get(K.arrival)) || 0;
export const forgetMoneyCursors = () => Promise.all(Object.values(K).map(del));
