import React, { useMemo } from "react";

/**
 * Ambience — the soft, living background behind every page.
 * Blurred rose glows, drifting petals, faint botanical line art and a
 * whisper of grain. Purely decorative: it never receives pointer events.
 */

const PETAL_COUNT = 14;

function Petals() {
  const petals = useMemo(
    () =>
      Array.from({ length: PETAL_COUNT }, (_, i) => {
        const size = 6 + Math.random() * 12;
        return {
          key: i,
          style: {
            width: `${size}px`,
            height: `${size * 0.82}px`,
            left: `${Math.random() * 100}%`,
            "--petal-drift": `${(Math.random() - 0.5) * 220}px`,
            "--petal-opacity": (0.2 + Math.random() * 0.4).toFixed(2),
            animation: `petal-fall ${22 + Math.random() * 26}s linear ${
              -Math.random() * 40
            }s infinite`,
          },
        };
      }),
    []
  );

  return (
    <div className="ambience__petals">
      {petals.map((p) => (
        <span key={p.key} className="petal" style={p.style} />
      ))}
    </div>
  );
}

function Botanical({ className }) {
  return (
    <svg
      className={`ambience__botanical ${className}`}
      viewBox="0 0 220 220"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.9"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M20 205C40 140 70 96 128 62" />
      <path d="M62 148c-16-4-26-16-27-32 17 1 29 11 33 27" />
      <path d="M84 116c-10-13-10-28-1-41 13 9 17 24 10 39" />
      <path d="M104 92c3-16 15-27 31-29-2 17-13 28-29 32" />
      <path d="M128 62c14-6 29-2 39 11-15 8-30 6-41-6" />
      <circle cx="150" cy="44" r="9" />
      <circle cx="171" cy="66" r="5.5" />
      <path d="M139 30c4-6 12-8 18-4M164 28c6 1 10 6 10 12" />
    </svg>
  );
}

export default function Ambience({ petals = true, botanical = true }) {
  return (
    <div className="ambience" aria-hidden="true">
      <span className="ambience__glow ambience__glow--one" />
      <span className="ambience__glow ambience__glow--two" />
      <span className="ambience__glow ambience__glow--three" />
      {botanical && (
        <>
          <Botanical className="ambience__botanical--tl" />
          <Botanical className="ambience__botanical--br" />
        </>
      )}
      {petals && <Petals />}
      <span className="ambience__grain" />
    </div>
  );
}
