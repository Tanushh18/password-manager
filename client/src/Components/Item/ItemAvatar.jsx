import React, { useState } from "react";
import { faviconUrl } from "../../lib/items";

// Calm solid tints for the letter fallback (no gradients).
const WASHES = ["#0f7f7d", "#3b6fd6", "#7c5cc4", "#c2410c", "#15803d", "#be185d", "#475569"];

export const washFor = (name) => WASHES[((name || "?").charCodeAt(0) || 0) % WASHES.length];

/** Website icon (when enabled) with a solid letter fallback. */
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
