import React from "react";

/*
 * "Arrival gate" scenery: the view from an airport-lounge window over a waterfall, a river and the jungle, with a city
 * skyline and runway beyond. Pure inline SVG; colours come from CSS custom properties in auth.css so the light theme
 * reads as daytime and the dark theme as dusk with runway lights. Decorative only (aria-hidden).
 */
const TOWERS = [
  [300, 196, 16, 64], [318, 176, 12, 84], [332, 206, 20, 54], [354, 160, 10, 100], [366, 188, 18, 72],
  [386, 212, 14, 48], [402, 170, 16, 90], [420, 198, 22, 62], [444, 182, 12, 78], [458, 208, 18, 52],
  [478, 192, 14, 68], [494, 214, 20, 46], [516, 186, 12, 74], [530, 204, 18, 56], [550, 196, 14, 64]
];
const WINDOWS = [[321, 190], [321, 206], [357, 176], [357, 196], [405, 186], [405, 204], [447, 196], [481, 206], [519, 200]];
const LIGHTS = Array.from({ length: 22 }, (_, i) => 18 + i * 27);

export default function AuthScene({ className = "" }) {
  return (
    <svg className={`scene ${className}`} viewBox="0 0 600 640" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="sc-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="sc-sky-1" />
          <stop offset="0.62" className="sc-sky-2" />
          <stop offset="1" className="sc-sky-3" />
        </linearGradient>
        <linearGradient id="sc-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="sc-water-1" />
          <stop offset="1" className="sc-water-2" />
        </linearGradient>
        <linearGradient id="sc-fall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="sc-fall-1" />
          <stop offset="1" className="sc-fall-2" />
        </linearGradient>
        <radialGradient id="sc-mist" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" className="sc-mist-1" />
          <stop offset="1" className="sc-mist-2" />
        </radialGradient>
      </defs>

      {/* sky, sun / moon */}
      <rect width="600" height="640" fill="url(#sc-sky)" />
      <circle className="sc-sun" cx="520" cy="120" r="26" />
      <circle className="sc-sun-halo" cx="520" cy="120" r="54" />

      {/* city skyline on the horizon */}
      <g className="sc-city">
        {TOWERS.map(([x, y, w, h]) => <rect key={x} x={x} y={y} width={w} height={h} rx="1.5" />)}
        <path d="M354 160 L359 146 L364 160 Z" />
      </g>
      <g className="sc-city-win">
        {WINDOWS.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="3" height="3" />)}
      </g>

      {/* aircraft climbing out, far away */}
      <g className="sc-plane" transform="translate(330 70) rotate(-9)">
        <path d="M0 6 L46 2 Q54 2 56 5 Q54 8 46 8 Z M20 5 L34 -8 L39 -8 L31 5 Z M22 7 L32 16 L36 16 L31 7 Z M2 5 L-2 -2 L3 -2 L8 5 Z" />
        <circle className="sc-beacon" cx="56" cy="5" r="1.6" />
      </g>

      {/* runway + lights */}
      <rect className="sc-runway" x="0" y="254" width="600" height="14" />
      <g className="sc-lights">
        {LIGHTS.map((x, i) => <circle key={x} cx={x} cy="261" r="1.9" style={{ animationDelay: `${(i % 11) * 0.35}s` }} />)}
      </g>

      {/* far hills and the cliff the waterfall drops from */}
      <path className="sc-hill-far" d="M0 268 C80 238 150 250 220 262 C300 246 380 240 460 258 C520 246 570 250 600 256 V330 H0 Z" />
      <path className="sc-cliff" d="M120 300 C150 262 190 250 236 254 L330 252 C380 254 420 270 460 300 L470 470 H110 Z" />
      <path className="sc-cliff-shade" d="M250 254 L322 254 L332 470 L240 470 Z" />

      {/* waterfall */}
      <path className="sc-fall" d="M254 256 Q286 250 318 256 L330 468 L242 468 Z" fill="url(#sc-fall)" />
      <g className="sc-fall-lines">
        <path d="M262 262 L254 466" />
        <path d="M276 258 L272 466" />
        <path d="M290 257 L290 466" />
        <path d="M304 258 L308 466" />
        <path d="M314 260 L322 466" />
      </g>

      {/* river winding toward the viewer, with reflections */}
      <path className="sc-river" d="M236 462 C200 492 300 520 230 560 C180 590 120 610 60 640 H560 C470 610 410 586 400 556 C388 516 340 494 336 462 Z" fill="url(#sc-water)" />
      <g className="sc-ripples">
        <path d="M258 500 h48" />
        <path d="M232 540 h70" />
        <path d="M190 584 h96" />
        <path d="M300 612 h120" />
      </g>
      <ellipse className="sc-mist" cx="288" cy="466" rx="120" ry="38" fill="url(#sc-mist)" />
      <ellipse className="sc-mist sc-mist--drift" cx="300" cy="440" rx="80" ry="26" fill="url(#sc-mist)" />

      {/* jungle masses and large foreground leaves */}
      <path className="sc-jungle-back" d="M0 330 C40 300 90 306 120 300 C140 340 130 420 150 470 C120 520 60 540 0 560 Z" />
      <path className="sc-jungle-back" d="M600 320 C560 296 500 296 460 300 C450 360 470 420 440 470 C470 520 540 540 600 556 Z" />
      <g className="sc-leaves">
        <path d="M-10 640 C10 560 60 500 140 470 C120 540 80 600 30 640 Z" />
        <path d="M40 640 C70 590 130 560 200 556 C170 600 130 630 100 640 Z" />
        <path d="M610 640 C590 560 540 500 460 476 C480 540 520 600 570 640 Z" />
        <path d="M560 640 C530 596 470 570 410 566 C440 606 480 632 510 640 Z" />
        <path d="M-10 420 C30 400 80 410 110 440 C70 460 20 456 -10 446 Z" />
        <path d="M610 410 C570 392 520 402 492 432 C530 452 580 448 610 438 Z" />
      </g>
      <g className="sc-veins">
        <path d="M0 636 C40 570 80 520 136 474" />
        <path d="M600 636 C570 570 530 520 464 480" />
      </g>

      {/* lounge window frame: glass mullions and a soft reflection */}
      <g className="sc-frame">
        <rect x="0" y="0" width="600" height="10" />
        <rect x="196" y="0" width="5" height="640" />
        <rect x="399" y="0" width="5" height="640" />
        <rect x="0" y="352" width="600" height="3" />
      </g>
      <path className="sc-glare" d="M420 0 L470 0 L300 640 L250 640 Z" />
    </svg>
  );
}
