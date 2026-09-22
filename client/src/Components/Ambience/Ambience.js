import React from "react";

/**
 * Ambience — the quiet background behind every page.
 * A couple of wide, slow-drifting tints and a fine grid, so the surface has
 * depth without competing with the content. Purely decorative: it never
 * receives pointer events.
 *
 * `grid` and `glow` can be dialled down on dense pages (the vault, for one).
 */
export default function Ambience({ grid = true, glow = true }) {
  return (
    <div className="ambience" aria-hidden="true">
      {glow && (
        <>
          <span className="ambience__glow ambience__glow--one" />
          <span className="ambience__glow ambience__glow--two" />
          <span className="ambience__glow ambience__glow--three" />
        </>
      )}
      {grid && <span className="ambience__grid" />}
      <span className="ambience__grain" />
    </div>
  );
}
