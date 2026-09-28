import React, { useState } from "react";
import { faviconUrl } from "../../lib/items";

const WASHES = [
  "linear-gradient(140deg, #31aaa9, #a82020)",
  "linear-gradient(140deg, #f8e0a4, #31aaa9)",
  "linear-gradient(140deg, #a82020, #6c1a1a)",
  "linear-gradient(140deg, #6bc2c1, #f8e0a4)",
  "linear-gradient(140deg, #6c1a1a, #31aaa9)",
  "linear-gradient(140deg, #a82020, #f8e0a4)",
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
