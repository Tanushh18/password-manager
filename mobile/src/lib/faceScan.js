import { Image, Platform } from "react-native";
import { api, mediaSource, loadSavedToken } from "./api";

const fc = require("./faceCluster");

/*
 * On-device face grouping. For each photo: download the small preview, find faces (Google ML Kit, on the phone),
 * crop each face, turn it into a 128-number fingerprint with a small TFLite model (assets/models/facenet.tflite),
 * and group similar fingerprints. Fingerprints and groups are kept in a file on this phone only.
 */
const NAME = "faces.json";
const BACKUP = "faces.bak.json";
const FACE = 160; // model input size
const MIN_FACE_PX = 40; // faces smaller than this in the preview are too blurry to match
const MAX_FACES = 8;

let store = null;
let model = null;
let busy = false;
let generation = 0; // bumped when all face data is deleted, so a scan already running stops instead of re-adding faces
const listeners = new Set();

const file = (name = NAME) => { const { File, Paths } = require("expo-file-system"); return new File(Paths.document, name); };

export async function loadStore() {
  if (store) return store;
  store = { ...fc.emptyStore(), settings: { enabled: false, threshold: fc.THRESHOLD } };
  if (Platform.OS === "web") return store;
  for (const name of [NAME, BACKUP]) { // a kill in the middle of a save can truncate one copy; the other is still whole
    try { const f = file(name); if (f.exists) { store = { ...store, ...JSON.parse(await f.text()) }; break; } } catch (e) { /* try the next copy */ }
  }
  store.settings = { enabled: false, threshold: fc.THRESHOLD, ...(store.settings || {}) };
  return store;
}
function save() {
  try {
    if (Platform.OS !== "web") {
      const json = JSON.stringify(store);
      for (const name of [NAME, BACKUP]) { const f = file(name); if (!f.exists) f.create(); f.write(json); }
    }
  } catch (e) { /* best effort */ }
  listeners.forEach((fn) => fn(store));
}
export const subscribeFaces = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const getStore = () => store;

export async function setFaceSettings(patch) { await loadStore(); store.settings = { ...store.settings, ...patch }; save(); }
export function renamePerson(id, name) { fc.renameCluster(store, id, name); save(); }
export function mergePeople(intoId, fromId) { const ok = fc.mergeClusters(store, intoId, fromId); save(); return ok; }
export function notThisPerson(faceId) { const id = fc.splitFace(store, faceId); save(); return id; }
export function deletePerson(id) { fc.deleteCluster(store, id); save(); }
/** Deletes every fingerprint and group and forgets which photos were scanned. */
export async function deleteAllFaceData() { await loadStore(); generation += 1; const settings = store.settings; store = { ...fc.emptyStore(), settings }; save(); }
export const peopleList = () => (store ? fc.people(store) : []);
export const photosOf = (id) => (store ? fc.mediaOf(store, id) : []);
export const facesOf = (id) => (store ? (store.clusters.find((c) => c.id === id)?.faceIds || []).map((f) => store.faces[f]).filter(Boolean) : []);

async function loadModel() {
  if (model) return model;
  const { loadTensorflowModel } = require("react-native-fast-tflite");
  try { model = await loadTensorflowModel(require("../../assets/models/facenet.tflite"), []); }
  catch (e) { throw Object.assign(new Error("The face model could not be loaded. This needs the installed app, not Expo Go."), { fatal: true }); }
  return model;
}

async function bytesOf(f) {
  if (typeof f.bytes === "function") return new Uint8Array(await f.bytes());
  return require("react-native-quick-base64").toByteArray(await f.base64());
}

/** 160x160 JPEG of a face -> 128 numbers. */
async function fingerprint(uri) {
  const { File } = require("expo-file-system");
  const jpeg = require("jpeg-js");
  const { data } = jpeg.decode(await bytesOf(new File(uri)), { useTArray: true, formatAsRGBA: true });
  const px = new Float32Array(FACE * FACE * 3);
  for (let i = 0, j = 0; i < data.length; i += 4) { px[j++] = data[i]; px[j++] = data[i + 1]; px[j++] = data[i + 2]; }
  fc.standardize(px);
  const m = await loadModel();
  const out = await m.run([px.buffer]);
  const emb = Array.from(new Float32Array(out[0]));
  if (emb.length !== fc.DIM) throw Object.assign(new Error(`The face model returned ${emb.length} numbers, expected ${fc.DIM}.`), { fatal: true });
  return emb;
}

const sizeOf = (uri) => new Promise((resolve, reject) => Image.getSize(uri, (width, height) => resolve({ width, height }), reject));

async function facesIn(uri) {
  const FaceDetection = require("@react-native-ml-kit/face-detection").default;
  const { ImageManipulator, SaveFormat } = require("expo-image-manipulator");
  const { File } = require("expo-file-system");
  const found = (await FaceDetection.detect(uri, { performanceMode: "accurate", landmarkMode: "none", classificationMode: "none" })) || [];
  const { width: W, height: H } = await sizeOf(uri);
  const out = [];
  for (const face of found.slice(0, MAX_FACES)) {
    const fr = face.frame;
    if (!fr || Math.max(fr.width, fr.height) < MIN_FACE_PX) continue;
    const side = Math.min(Math.max(fr.width, fr.height) * 1.3, W, H);
    const x = Math.min(Math.max(fr.left + fr.width / 2 - side / 2, 0), W - side);
    const y = Math.min(Math.max(fr.top + fr.height / 2 - side / 2, 0), H - side);
    const ctx = ImageManipulator.manipulate(uri);
    ctx.crop({ originX: Math.round(x), originY: Math.round(y), width: Math.round(side), height: Math.round(side) });
    ctx.resize({ width: FACE, height: FACE });
    const crop = await (await ctx.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.95 });
    try { out.push({ emb: await fingerprint(crop.uri), box: { x: Math.round(x), y: Math.round(y), side: Math.round(side), imgW: W, imgH: H } }); }
    finally { try { new File(crop.uri).delete(); } catch (e) { /* temp file */ } }
  }
  return out;
}

async function chargingOrWifiOk(requireCharging) {
  try {
    if (requireCharging) {
      const Battery = require("expo-battery");
      const s = await Battery.getBatteryStateAsync();
      if (s !== Battery.BatteryState.CHARGING && s !== Battery.BatteryState.FULL) return false;
    }
    const Network = require("expo-network");
    const n = await Network.getNetworkStateAsync();
    return Boolean(n.isConnected && n.type === Network.NetworkStateType.WIFI);
  } catch (e) { return false; }
}

/**
 * Scans photos that have not been looked at yet. `auto` runs only on Wi-Fi while charging (it is heavy on battery);
 * a manual run from the People screen ignores that. Returns { scanned, remaining }.
 */
export async function scanFaces({ limit = 30, auto = false, onProgress } = {}) {
  if (busy) return { scanned: 0, remaining: null, busy: true };
  busy = true;
  try {
    await loadStore();
    if (auto && (!store.settings.enabled || !(await chargingOrWifiOk(true)))) return { scanned: 0, remaining: null };
    if (!(await loadSavedToken())) return { scanned: 0, remaining: null };
    const { File, Paths } = require("expo-file-system");
    const startedAt = generation;
    const dash = await api.photoDashboard();
    const photos = (dash.media || []).filter((m) => m.type === "photo" && m.hasThumbnail && m.availabilityState === "available");
    // Only prune when the server clearly answered with a library; an empty or failed answer must never wipe people.
    if ((dash.media || []).length > 0 && (dash.connections || []).length > 0) fc.forgetMissing(store, dash.media.map((m) => m.id));
    const todo = photos.filter((m) => !store.processed[m.id]);
    let scanned = 0;
    store.failed = store.failed || {};
    for (const m of todo.slice(0, limit)) {
      if (generation !== startedAt) return { scanned, remaining: null, cancelled: true };
      const src = mediaSource(m.id);
      const target = new File(Paths.cache, "face-scan.jpg");
      try {
        if (target.exists) target.delete();
        const got = await File.createDownloadTask(src.uri, target, { headers: src.headers }).downloadAsync();
        if (!got) throw new Error("download failed");
        const found = await facesIn(got.uri);
        if (generation !== startedAt) return { scanned, remaining: null, cancelled: true };
        fc.addFaces(store, m.id, found, store.settings.threshold);
      } catch (e) {
        if (e?.fatal) throw e; // a broken model fails every photo; stop instead of downloading the whole batch
        // A photo that cannot be read is retried on later runs, but only a few times.
        store.failed[m.id] = (store.failed[m.id] || 0) + 1;
        if (store.failed[m.id] >= 3) store.processed[m.id] = Date.now();
        continue;
      } finally { try { if (target.exists) target.delete(); } catch (e) { /* temp file */ } }
      scanned += 1;
      if (scanned % 5 === 0) save();
      onProgress?.({ scanned, total: Math.min(limit, todo.length), remaining: todo.length - scanned });
    }
    save();
    return { scanned, remaining: Math.max(0, todo.length - scanned), total: photos.length };
  } finally { busy = false; }
}
export const isScanning = () => busy;
