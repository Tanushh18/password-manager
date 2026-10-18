import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

/* One shared copy of the photo library so the grid, viewer and backup screens agree. */
let cache = null;
let viewerList = [];
const subs = new Set();
const publish = (next) => { cache = next; subs.forEach((fn) => fn(next)); };

export const setViewerList = (ids) => { viewerList = ids; };
export const getViewerList = () => viewerList;

export function patchMedia(id, patch) {
  if (!cache) return;
  publish({ ...cache, media: cache.media.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
}
export function dropMedia(ids) {
  if (!cache) return;
  const gone = new Set(ids);
  publish({ ...cache, media: cache.media.filter((m) => !gone.has(m.id)), albums: (cache.albums || []).map((a) => ({ ...a, mediaIds: (a.mediaIds || []).filter((m) => !gone.has(m)) })) });
}
export function patchAlbum(album) {
  if (!cache) return;
  const rest = (cache.albums || []).filter((a) => a.id !== album.id);
  publish({ ...cache, albums: album.deleted ? rest : [...rest, album] });
}

export function usePhotoData() {
  const [data, setData] = useState(cache);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { subs.add(setData); return () => subs.delete(setData); }, []);
  const reload = useCallback(async () => {
    setLoading(true);
    try { publish(await api.photoDashboard()); setError(""); }
    catch (e) { setError(e.message || "Could not load photos."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (!cache) reload(); }, [reload]);
  return { data, loading, error, reload };
}

export const monthLabel = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Undated" : d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
};
