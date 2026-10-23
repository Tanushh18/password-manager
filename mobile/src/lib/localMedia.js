import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";
import { permission } from "./photoSync";

/* Photos and videos stored on this phone, shaped like the cloud items so the grid and viewer can show both. */
const LIMIT = 3000;
let cache = null;
let denied = false;
const subs = new Set();
const publish = (next) => { cache = next; subs.forEach((fn) => fn(next)); };

export const isLocal = (m) => Boolean(m && m.local);
export const localMap = () => new Map((cache || []).map((m) => [m.id, m]));

async function load(ask) {
  if (Platform.OS === "web") return [];
  if (!(await permission(ask))) { denied = true; return []; }
  denied = false;
  const ML = require("expo-media-library/legacy");
  const out = [];
  let after;
  while (out.length < LIMIT) {
    const page = await ML.getAssetsAsync({ first: 300, after, mediaType: ["photo", "video"], sortBy: [["creationTime", false]] });
    page.assets.forEach((a) => out.push({
      id: "local:" + a.id,
      local: true,
      localUri: a.uri,
      filename: a.filename,
      type: a.mediaType === "video" ? "video" : "photo",
      takenAt: a.creationTime ? new Date(a.creationTime).toISOString() : null,
      width: a.width,
      height: a.height,
      account: "This phone",
      availabilityState: "available",
      hasThumbnail: true,
      archived: false,
      favorite: false,
    }));
    if (!page.hasNextPage) break;
    after = page.endCursor;
  }
  return out;
}

export function useLocalMedia() {
  const [items, setItems] = useState(cache || []);
  const [needsPermission, setNeeds] = useState(denied);
  useEffect(() => { subs.add(setItems); return () => subs.delete(setItems); }, []);
  const refresh = useCallback(async (ask = false) => {
    try { publish(await load(ask)); } catch (e) { /* the cloud library still shows */ }
    setNeeds(denied);
  }, []);
  useEffect(() => { refresh(true); }, [refresh]);
  return { items, needsPermission, refresh };
}
