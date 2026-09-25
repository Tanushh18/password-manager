import React, { useEffect, useMemo, useRef } from "react";

/**
 * Ambience — the living aurora behind every page.
 * Drifting colour glows, a sweeping aurora ribbon, a twinkling star field
 * and a soft light that follows the pointer. Purely decorative.
 */

const STAR_COUNT = 70;

function Stars() {
  const stars = useMemo(
    () =>
      Array.from({ length: STAR_COUNT }, (_, i) => {
        const size = Math.random() < 0.15 ? 3 : Math.random() < 0.5 ? 2 : 1;
        return {
          key: i,
          style: {
            width: `${size}px`,
            height: `${size}px`,
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            "--twinkle": `${3 + Math.random() * 5}s`,
            "--twinkle-delay": `${-Math.random() * 8}s`,
          },
        };
      }),
    []
  );

  return (
    <div className="ambience__stars">
      {stars.map((s) => (
        <span key={s.key} className="star" style={s.style} />
      ))}
    </div>
  );
}

export default function Ambience({ petals = true, stars = petals }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    if (window.matchMedia("(pointer: coarse)").matches) return undefined;

    let frame = null;
    const onMove = (e) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        el.style.setProperty("--mx", `${e.clientX}px`);
        el.style.setProperty("--my", `${e.clientY}px`);
        frame = null;
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="ambience" aria-hidden="true" ref={ref}>
      <span className="ambience__aurora" />
      <span className="ambience__glow ambience__glow--one" />
      <span className="ambience__glow ambience__glow--two" />
      <span className="ambience__glow ambience__glow--three" />
      {stars && <Stars />}
      <span className="ambience__grain" />
      <span className="ambience__spot" />
    </div>
  );
}
