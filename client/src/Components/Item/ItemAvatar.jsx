import React, { useState } from "react";
import { faviconUrl } from "../../lib/items";

const WASHES = [
  "linear-gradient(140deg, #8b5cf6, #ec4899)",
  "linear-gradient(140deg, #22d3ee, #8b5cf6)",
  "linear-gradient(140deg, #f472b6, #f59e0b)",
  "linear-gradient(140deg, #34d399, #0891b2)",
  "linear-gradient(140deg, #6366f1, #22d3ee)",
  "linear-gradient(140deg, #a855f7, #6366f1)",
];

export const washFor = (name) => WASHES[((name || "?").charCodeAt(0) || 0) % WASHES.length];

/** Website icon (when enabled) with a gradient-letter fallback. */
export default function ItemAvatar({ name, url, icons, size = 46 }) {
  const [failed, setFailed] = useState(false);
  const src = icons && !failed ? faviconUrl(url) : "";
  const letter = (name || "•").trim().charAt(0).toUpperCase() || "•";
  return (
    <span className="avatar" style={{ width: size, height: size, background: src ? "var(--surface-solid)" : washFor(name) }}>
      {src ? (
        <img src={src} alt="" width={size * 0.56} height={size * 0.56} referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span style={{ fontSize: size * 0.42 }}>{letter}</span>
      )}
    </span>
  );
}
