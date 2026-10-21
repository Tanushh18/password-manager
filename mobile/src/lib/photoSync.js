import { Platform } from "react-native";
import { api, loadSavedToken } from "./api";

/*
 * Camera-roll backup. The device list lives in a small JSON file so the queue survives the app being killed.
 *   queued -> uploading -> verifying -> done      (failed items retry later with a growing delay)
 * Bytes go from the phone straight to Google Drive; the server only picks the account and verifies the result.
 */
const NAME = "photo-sync.json";
const MAX_ATTEMPTS = 6;
const DEFAULTS = { enabled: false, since: 0, wifiOnly: true, chargingOnly: false, quality: "balanced", folders: [], savedBytes: 0, items: {} };
const PARALLEL = 2;
// Photos are shrunk before upload (videos and GIFs are sent as they are). edge = longest side in pixels.
export const QUALITIES = { original: null, high: { edge: 3072, q: 0.85 }, balanced: { edge: 2048, q: 0.8 }, small: { edge: 1280, q: 0.7 } };
const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", heic: "image/heic", heif: "image/heif", mp4: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska", "3gp": "video/3gpp", webm: "video/webm" };

let state = null;
let running = false;
const listeners = new Set();

const stateFile = () => {
  const { File, Paths } = require("expo-file-system");
  return new File(Paths.document, NAME);
};

export async function loadState() {
  if (state) return state;
  state = { ...DEFAULTS, items: {} };
  if (Platform.OS === "web") return state;
  try {
    const f = stateFile();
    if (f.exists) state = { ...DEFAULTS, ...JSON.parse(await f.text()) };
  } catch (e) { /* start clean */ }
  return state;
}

function save() {
  try {
    if (Platform.OS !== "web") { const f = stateFile(); if (!f.exists) f.create(); f.write(JSON.stringify(state)); }
  } catch (e) { /* best effort */ }
  listeners.forEach((fn) => fn(state));
}

export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const getState = () => state || DEFAULTS;

export async function setSettings(patch) {
  await loadState();
  state = { ...state, ...patch };
  save();
  return state;
}

export async function permission(ask = false) {
  const ML = require("expo-media-library/legacy");
  const cur = await ML.getPermissionsAsync(false, ["photo", "video"]);
  if (cur.granted || !ask) return cur.granted;
  return (await ML.requestPermissionsAsync(false, ["photo", "video"])).granted;
}

const mimeOf = (name, type) => MIME[String(name).split(".").pop().toLowerCase()] || (type === "video" ? "video/mp4" : "image/jpeg");

/** Folders on the phone that hold photos or videos (Camera, Screenshots, WhatsApp Images ...). */
export async function deviceFolders() {
  const ML = require("expo-media-library/legacy");
  const albums = await ML.getAlbumsAsync();
  return albums.filter((a) => a.assetCount > 0).map((a) => ({ id: a.id, title: a.title, count: a.assetCount })).sort((x, y) => y.count - x.count);
}

/** Finds new camera-roll items (in the chosen folders, or all) newer than `since` and queues them. Returns how many were added. */
export async function scan({ limit = 2000 } = {}) {
  await loadState();
  if (!(await permission(false))) return 0;
  const ML = require("expo-media-library/legacy");
  const titles = new Map();
  try { (await ML.getAlbumsAsync()).forEach((a) => titles.set(String(a.id), a.title)); } catch (e) { /* folder names are optional */ }
  const sources = state.folders.length ? state.folders : [undefined];
  let added = 0;
  for (const album of sources) {
    let seen = 0, after;
    for (;;) {
      const page = await ML.getAssetsAsync({ first: 100, after, mediaType: ["photo", "video"], sortBy: [["creationTime", false]], ...(album ? { album } : {}), ...(state.since ? { createdAfter: state.since } : {}) });
      let fresh = 0;
      for (const a of page.assets) {
        const id = "local:" + a.id;
        if (state.items[id]) continue;
        state.items[id] = { assetId: a.id, filename: a.filename, type: a.mediaType, mimeType: mimeOf(a.filename, a.mediaType), takenAt: a.creationTime ? new Date(a.creationTime).toISOString() : "", folderName: titles.get(String(a.albumId ?? album)) || "", status: "queued", attempts: 0, error: "", nextAt: 0, updatedAt: Date.now() };
        fresh += 1; added += 1;
      }
      seen += page.assets.length;
      if (!page.hasNextPage || fresh === 0 || seen >= limit) break;
      after = page.endCursor;
    }
  }
  if (added) save();
  return added;
}

async function allowed() {
  try {
    const Network = require("expo-network");
    const net = await Network.getNetworkStateAsync();
    if (!net.isConnected) return "No connection";
    if (state.wifiOnly && net.type !== Network.NetworkStateType.WIFI) return "Waiting for Wi-Fi";
    if (state.chargingOnly) {
      const Battery = require("expo-battery");
      const s = await Battery.getBatteryStateAsync();
      if (s !== Battery.BatteryState.CHARGING && s !== Battery.BatteryState.FULL) return "Waiting for charger";
    }
    return "";
  } catch (e) { return "Could not check the network"; }
}

// Exponential backoff with jitter: about 30 s, 1 min, 2 min ... capped at an hour.
const backoff = (attempts) => Math.min(3600000, 30000 * 2 ** Math.max(0, attempts - 1)) * (0.75 + Math.random() * 0.5);

/** Shrinks a photo to the chosen quality. Returns { uri, mimeType, filename } of the file to send (a temp file when changed). */
async function optimize(item, info, uri, level) {
  const plan = QUALITIES[level];
  const same = { uri, mimeType: item.mimeType, filename: item.filename, temp: false };
  if (!plan || item.type !== "photo" || item.mimeType === "image/gif") return same;
  try {
    const { ImageManipulator, SaveFormat } = require("expo-image-manipulator");
    const { File } = require("expo-file-system");
    const w = info.width || 0, h = info.height || 0;
    const ctx = ImageManipulator.manipulate(uri);
    if (Math.max(w, h) > plan.edge) ctx.resize(w >= h ? { width: plan.edge, height: null } : { width: null, height: plan.edge });
    const out = await (await ctx.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: plan.q });
    const smaller = new File(out.uri).size;
    if (!(smaller < new File(uri).size * 0.9)) { try { new File(out.uri).delete(); } catch (e) { /* temp file */ } return same; }
    return { uri: out.uri, mimeType: "image/jpeg", filename: item.filename.replace(/\.[^.]+$/, "") + ".jpg", temp: true };
  } catch (e) { return same; } // if shrinking fails, upload the original rather than lose the photo
}

async function uploadOne(id, item) {
  const ML = require("expo-media-library/legacy");
  const { File, UploadType } = require("expo-file-system");
  item.status = "uploading"; save();
  const info = await ML.getAssetInfoAsync(item.assetId);
  const uri = info.localUri || info.uri;
  if (!uri) throw Object.assign(new Error("This item is no longer on the device."), { permanent: true });
  const originalSize = new File(uri).size;
  const send = await optimize(item, info, uri, state.quality);
  const f = new File(send.uri);
  try {
    const size = f.size;
    let md5 = "";
    try { md5 = (f.info({ md5: true }).md5 || "").toLowerCase(); } catch (e) { /* the server still verifies the size */ }
    item.size = size;
    const start = await api.photoUploadStart({ filename: send.filename, mimeType: send.mimeType, size, originalSize, takenAt: item.takenAt, localId: id, md5, folderName: item.folderName });
    if (start.duplicate) return { duplicate: true };
    item.jobId = start.jobId; item.destination = start.destination || ""; save();
    const sent = await f.upload(start.sessionUri, { httpMethod: "PUT", headers: { "Content-Type": send.mimeType }, uploadType: UploadType.BINARY_CONTENT });
    if (sent.status !== 200 && sent.status !== 201) {
      const err = new Error(`Google Drive answered ${sent.status}.`);
      err.quota = /quota/i.test(String(sent.body || ""));
      throw err;
    }
    let fileId = "";
    try { fileId = JSON.parse(sent.body).id; } catch (e) { /* handled below */ }
    if (!fileId) throw new Error("Google Drive did not return a file id.");
    item.status = "verifying"; save();
    await api.photoUploadComplete(start.jobId, fileId);
    state.savedBytes = (state.savedBytes || 0) + Math.max(0, originalSize - size);
    return {};
  } finally { if (send.temp) { try { f.delete(); } catch (e) { /* temp file */ } } }
}

/** Uploads queued items, two at a time. `budgetMs` keeps background runs short. */
export async function processQueue({ budgetMs = 8 * 60 * 1000 } = {}) {
  if (running) return { skipped: "busy" };
  running = true;
  const t0 = Date.now();
  const out = { done: 0, failed: 0, waiting: "" };
  try {
    await loadState();
    if (!(await loadSavedToken())) return { ...out, waiting: "Signed out" };
    const lane = async () => {
      for (;;) {
        const gate = await allowed();
        if (gate) { out.waiting = gate; return; }
        const entry = Object.entries(state.items).find(([, it]) => (it.status === "queued" || it.status === "failed") && it.attempts < MAX_ATTEMPTS && (it.nextAt || 0) <= Date.now());
        if (!entry || Date.now() - t0 > budgetMs) return;
        const [id, item] = entry;
        item.status = "uploading"; // claim it before any await so the other lane skips it
        try {
          await uploadOne(id, item);
          item.status = "done"; item.error = ""; item.doneAt = Date.now(); out.done += 1;
        } catch (e) {
          item.attempts += 1; item.status = "failed"; item.error = e?.message || "Upload failed"; item.nextAt = Date.now() + backoff(item.attempts);
          if (e?.permanent) item.attempts = MAX_ATTEMPTS;
          if (item.jobId) api.photoUploadFail(item.jobId, { error: item.error, quota: Boolean(e?.quota) }).catch(() => {});
          if (e?.status === 409) { item.error = "No connected account can take this file right now."; item.nextAt = Date.now() + 15 * 60000; }
          out.failed += 1;
        }
        item.updatedAt = Date.now(); save();
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, lane));
  } finally { running = false; }
  return out;
}

export function retry(id) {
  const item = state?.items[id];
  if (!item) return;
  item.status = "queued"; item.attempts = 0; item.nextAt = 0; item.error = ""; save();
}
export function skip(id) {
  const item = state?.items[id];
  if (!item) return;
  item.status = "skipped"; save();
  if (item.jobId) api.photoUploadCancel(item.jobId).catch(() => {});
}
export function retryAllFailed() {
  Object.keys(state?.items || {}).forEach((id) => { if (state.items[id].status === "failed") retry(id); });
}

export const counts = (s = getState()) => {
  const c = { queued: 0, uploading: 0, done: 0, failed: 0, skipped: 0 };
  Object.values(s.items).forEach((it) => { const k = it.status === "verifying" ? "uploading" : it.status; if (k in c) c[k] += 1; });
  return c;
};
