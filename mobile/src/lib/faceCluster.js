/*
 * Face grouping logic (pure, no native code): compare face "fingerprints" and group the ones that look like
 * the same person. Fingerprints are 128 numbers from the on-device model and never leave the phone.
 * Groups are suggestions: the user can name, merge, split and delete them.
 */
const DIM = 128;
const THRESHOLD = 0.6; // cosine similarity needed to join an existing person; higher = stricter

const norm = (v) => Math.sqrt(v.reduce((n, x) => n + x * x, 0));
function normalize(v) {
  const n = norm(v) || 1;
  return v.map((x) => x / n);
}
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 1) s += a[i] * b[i]; return s; };
const cosine = (a, b) => dot(normalize(a), normalize(b));
const round = (v) => v.map((x) => Math.round(x * 10000) / 10000);

/** Per-image standardisation the model expects: zero mean, unit variance (std floored so flat images stay finite). */
function standardize(pixels) {
  const n = pixels.length;
  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += pixels[i];
  mean /= n;
  let variance = 0;
  for (let i = 0; i < n; i += 1) variance += (pixels[i] - mean) ** 2;
  const std = Math.max(Math.sqrt(variance / n), 1 / Math.sqrt(n));
  for (let i = 0; i < n; i += 1) pixels[i] = (pixels[i] - mean) / std;
  return pixels;
}

const emptyStore = () => ({ version: 1, model: "facenet-128", faces: {}, clusters: [], processed: {} });
const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function centroidOf(store, cluster) {
  const sum = new Array(DIM).fill(0);
  for (const id of cluster.faceIds) { const e = store.faces[id]?.emb; if (e) for (let i = 0; i < DIM; i += 1) sum[i] += e[i]; }
  return normalize(sum);
}
const refresh = (store, cluster) => { cluster.centroid = round(centroidOf(store, cluster)); cluster.coverFaceId = cluster.faceIds.includes(cluster.coverFaceId) ? cluster.coverFaceId : cluster.faceIds[0] || null; };

/** Adds the faces found in one photo, each joining the closest person or starting a new one. Returns the number of new people. */
function addFaces(store, mediaId, faces, threshold = THRESHOLD) {
  let created = 0;
  faces.forEach((face, index) => {
    if (!face.emb || face.emb.length !== DIM) return;
    const emb = round(normalize(face.emb));
    const id = `${mediaId}#${index}`;
    if (store.faces[id]) return;
    store.faces[id] = { id, mediaId, box: face.box || null, emb };
    let best = null, bestScore = threshold;
    for (const c of store.clusters) { const score = dot(emb, c.centroid); if (score >= bestScore) { best = c; bestScore = score; } }
    if (!best) { best = { id: newId("p"), name: "", faceIds: [], centroid: emb, coverFaceId: id }; store.clusters.push(best); created += 1; }
    best.faceIds.push(id);
    refresh(store, best);
  });
  store.processed[mediaId] = Date.now();
  return created;
}

const find = (store, id) => store.clusters.find((c) => c.id === id);

function renameCluster(store, id, name) { const c = find(store, id); if (c) c.name = String(name || "").trim().slice(0, 60); }

/** Merges person `fromId` into `intoId` (the name of whichever has one is kept; `into` wins if both have). */
function mergeClusters(store, intoId, fromId) {
  const into = find(store, intoId), from = find(store, fromId);
  if (!into || !from || into === from) return false;
  into.faceIds.push(...from.faceIds);
  if (!into.name) into.name = from.name;
  store.clusters = store.clusters.filter((c) => c !== from);
  refresh(store, into);
  return true;
}

/** "Not this person": moves one face out into a person of its own. */
function splitFace(store, faceId) {
  const from = store.clusters.find((c) => c.faceIds.includes(faceId));
  if (!from || from.faceIds.length < 2) return null;
  from.faceIds = from.faceIds.filter((f) => f !== faceId);
  refresh(store, from);
  const made = { id: newId("p"), name: "", faceIds: [faceId], centroid: store.faces[faceId].emb, coverFaceId: faceId };
  store.clusters.push(made);
  return made.id;
}

/** Deletes a person and their stored faces. The photos stay marked as scanned so they are not grouped again. */
function deleteCluster(store, id) {
  const c = find(store, id);
  if (!c) return;
  c.faceIds.forEach((f) => { delete store.faces[f]; });
  store.clusters = store.clusters.filter((x) => x !== c);
}

/** Photo ids that contain a person, newest order is left to the caller. */
const mediaOf = (store, id) => [...new Set((find(store, id)?.faceIds || []).map((f) => store.faces[f]?.mediaId).filter(Boolean))];

/** People sorted by how many photos they appear in; one-off faces come last. */
function people(store) {
  return store.clusters.map((c) => ({ id: c.id, name: c.name, photos: mediaOf(store, c.id).length, faces: c.faceIds.length, cover: c.coverFaceId ? store.faces[c.coverFaceId] : null })).sort((a, b) => b.photos - a.photos);
}

/** Removes records of photos that no longer exist, so a deleted photo does not keep a face in someone's group. */
function forgetMissing(store, existingIds) {
  const keep = new Set(existingIds);
  for (const id of Object.keys(store.faces)) if (!keep.has(store.faces[id].mediaId)) delete store.faces[id];
  store.clusters.forEach((c) => { c.faceIds = c.faceIds.filter((f) => store.faces[f]); });
  store.clusters = store.clusters.filter((c) => c.faceIds.length);
  store.clusters.forEach((c) => refresh(store, c));
  for (const id of Object.keys(store.processed)) if (!keep.has(id)) delete store.processed[id];
}

module.exports = { DIM, THRESHOLD, normalize, cosine, standardize, emptyStore, addFaces, renameCluster, mergeClusters, splitFace, deleteCluster, mediaOf, people, forgetMissing };
