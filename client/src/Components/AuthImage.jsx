import React, { useEffect, useRef, useState } from "react";
import { getBlob } from "../api/client";
import "./AuthImage.css";

/* An image that needs the signed-in session to load. Loads only when scrolled into view, four at a time. */
let active = 0;
const waiting = [];
const next = () => { while (active < 4 && waiting.length) { active += 1; waiting.shift()(); } };
const slot = () => new Promise((resolve) => { waiting.push(resolve); next(); });
const release = () => { active -= 1; next(); };
const cache = new Map();

async function load(path) {
  if (cache.has(path)) return cache.get(path);
  await slot();
  try {
    let blob = await getBlob(path);
    if (blob.type.includes("json")) { // the server handed back a link to a worker server
      const { url } = JSON.parse(await blob.text());
      blob = await (await fetch(url)).blob();
    }
    const objectUrl = URL.createObjectURL(blob);
    cache.set(path, objectUrl);
    return objectUrl;
  } finally { release(); }
}

export default function AuthImage({ path, alt = "", className = "", onClick }) {
  const holder = useRef(null);
  const [src, setSrc] = useState(cache.get(path) || "");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (src || !holder.current) return undefined;
    let live = true;
    const watcher = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      watcher.disconnect();
      load(path).then((u) => live && setSrc(u)).catch(() => live && setFailed(true));
    }, { rootMargin: "300px" });
    watcher.observe(holder.current);
    return () => { live = false; watcher.disconnect(); };
  }, [path, src]);
  return (
    <div ref={holder} className={`authimg ${className}`} onClick={onClick} role={onClick ? "button" : undefined}>
      {src ? <img src={src} alt={alt} loading="lazy" /> : <span>{failed ? "No preview" : ""}</span>}
    </div>
  );
}
