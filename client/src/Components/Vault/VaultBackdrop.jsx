import React from "react";

/**
 * Decorative header horizon: sky (moon and stars at night, sun by day), a far
 * city skyline with a control tower and runway lights, a plane on approach,
 * birds, a jungle ridge with a waterfall, mist and a shimmering river, palms and
 * a little robot keeping watch. Pure SVG, aria-hidden; the few motions stop
 * under prefers-reduced-motion (see Vault.css).
 */
export default function VaultBackdrop() {
  return (
    <svg className="vx-backdrop" viewBox="0 0 1200 220" preserveAspectRatio="xMaxYMax slice" aria-hidden="true" focusable="false">
      {/* sky */}
      <g className="vx-backdrop__stars">
        {[[540, 30], [600, 18], [690, 26], [780, 14], [860, 34], [960, 20], [1040, 30], [1110, 12], [1170, 40], [500, 52], [920, 48]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i % 3 ? 1.1 : 1.6} style={{ animationDelay: `${(i % 5) * 0.7}s` }} />
        ))}
      </g>
      <g className="vx-backdrop__orb">
        <circle cx="1090" cy="46" r="18" />
        <circle className="vx-backdrop__orb-glow" cx="1090" cy="46" r="30" />
      </g>

      {/* birds */}
      <g className="vx-backdrop__birds" fill="none" strokeWidth="1.6" strokeLinecap="round">
        <path d="M560 70q5-5 10 0q5-5 10 0" />
        <path d="M586 60q4-4 8 0q4-4 8 0" />
        <path d="M604 76q3-3 6 0q3-3 6 0" />
      </g>

      {/* plane on approach */}
      <g className="vx-backdrop__plane">
        <path d="M0 0l26 3 8-6h5l-5 8 12 1 4-4h4l-3 6 3 6h-4l-4-4-12 1 5 8h-5l-8-6-26 3z" transform="translate(860 52) scale(0.8)" />
      </g>

      {/* skyline */}
      <g className="vx-backdrop__city">
        <rect x="610" y="92" width="26" height="128" />
        <rect x="640" y="60" width="18" height="160" />
        <path d="M649 60v-22" strokeWidth="2" className="vx-backdrop__mast" />
        <rect x="662" y="104" width="34" height="116" />
        <rect x="700" y="74" width="22" height="146" />
        <path d="M726 220V48l14-12 14 12v172z" />
        <rect x="758" y="96" width="30" height="124" />
        <rect x="792" y="118" width="20" height="102" />
        <rect x="816" y="84" width="26" height="136" />
        <path d="M846 220v-96h40l12 14v82z" />
        <rect x="902" y="70" width="16" height="150" />
        <rect x="922" y="102" width="34" height="118" />
        <rect x="960" y="124" width="24" height="96" />
        <path d="M988 220v-140c10-8 22-8 32 0v140z" />
        <rect x="1024" y="110" width="28" height="110" />
        {/* airport control tower */}
        <path d="M1062 220v-92h8v92zM1052 128h28l-4-14h-20z" />
        <rect x="1078" y="130" width="40" height="90" />
        <rect x="1122" y="104" width="22" height="116" />
        <rect x="1148" y="140" width="52" height="80" />
      </g>
      <g className="vx-backdrop__lights">
        <rect x="744" y="64" width="3" height="3" /><rect x="744" y="80" width="3" height="3" /><rect x="706" y="90" width="3" height="3" />
        <rect x="822" y="100" width="3" height="3" /><rect x="908" y="88" width="3" height="3" /><rect x="1002" y="96" width="3" height="3" />
        <rect x="1060" y="104" width="3" height="3" /><rect x="646" y="78" width="3" height="3" />
        <rect x="1058" y="118" width="16" height="4" rx="1" className="vx-backdrop__towerglass" />
      </g>
      {/* runway beacons along the bottom right */}
      <g className="vx-backdrop__runway">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => <circle key={i} cx={1000 + i * 28} cy="212" r="2.2" style={{ animationDelay: `${i * 0.18}s` }} />)}
      </g>

      {/* jungle ridge + waterfall + river */}
      <path className="vx-backdrop__ridge" d="M380 220c40-40 70-62 110-58 30 3 44-26 76-28 40-2 52 30 90 26 38-4 58-34 100-30 46 4 64 40 112 38 50-2 70-30 118-26 52 4 80 36 128 30 40-6 62-20 86-16V220z" />
      <path className="vx-backdrop__falls" d="M560 140c3 24 2 52 6 80h10c-4-28-3-56-6-80z" />
      <g className="vx-backdrop__mist">
        <circle cx="566" cy="214" r="10" /><circle cx="578" cy="210" r="7" /><circle cx="555" cy="211" r="6" />
      </g>
      <path className="vx-backdrop__river" d="M470 220c40-14 80-18 110-16 40 3 70 10 120 4" />
      <path className="vx-backdrop__shimmer" d="M500 214c30-6 60-8 80-7M610 210c24 1 44 3 70 1" />

      {/* robot keeping watch on the ridge */}
      <g className="vx-backdrop__bot" transform="translate(690 150)">
        <rect x="-7" y="-14" width="14" height="11" rx="3" />
        <rect x="-5" y="-3" width="10" height="9" rx="2" />
        <path d="M0 -14v-5" strokeWidth="1.5" />
        <circle cx="0" cy="-20" r="1.8" className="vx-backdrop__botlight" />
        <circle cx="-3" cy="-9" r="1.3" className="vx-backdrop__boteye" /><circle cx="3" cy="-9" r="1.3" className="vx-backdrop__boteye" />
      </g>

      {/* palms */}
      <g className="vx-backdrop__palm">
        <path d="M470 220c2-30 0-52-6-74" fill="none" strokeWidth="3" />
        <path d="M464 146c-14-8-30-6-42 4 14-2 26 0 42-4zM464 146c10-14 26-18 40-12-14 2-26 6-40 12zM464 146c-4-16 2-30 14-38-4 14-8 26-14 38zM464 146c-18 4-28 16-30 30 8-12 18-22 30-30zM464 146c18 2 30 12 34 26-10-10-20-18-34-26z" />
      </g>
      <g className="vx-backdrop__palm vx-backdrop__palm--far">
        <path d="M1180 220c1-22 0-38-4-52" fill="none" strokeWidth="2.4" />
        <path d="M1176 168c-11-6-23-5-32 3 11-1 20 0 32-3zM1176 168c8-10 20-13 30-9-10 1-20 4-30 9zM1176 168c-3-12 2-22 10-28-3 10-6 19-10 28z" />
      </g>
    </svg>
  );
}
