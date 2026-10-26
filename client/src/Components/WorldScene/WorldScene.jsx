import React, { useEffect, useId, useRef } from "react";
import "./WorldScene.css";

/*
  WorldScene — one coherent place: a glass city and an airport on the horizon,
  a jungle cliff with a waterfall in the middle distance, and a river that
  flows toward the viewer between large tropical leaves.

  Pure inline SVG + CSS. Animations use transform/opacity only, pause when the
  scene is off-screen, and stop entirely for prefers-reduced-motion.

  variant: "hero"  – fills its container (give the container a height)
           "panel" – card-sized, fills its container (min-height 200px)
           "strip" – short wide banner (default 140px tall)
*/

/* Deterministic pseudo-random so the skyline never shifts between renders. */
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const HORIZON = 560;

const FAR_TOWERS = [
  [20, 70, 230], [95, 50, 300], [150, 80, 200], [240, 46, 340], [292, 70, 250],
  [372, 54, 290], [432, 90, 210], [530, 52, 320], [590, 70, 240], [668, 60, 180],
  [735, 80, 150], [820, 60, 120],
];

const NEAR_TOWERS = [
  // x, width, height, crown ("flat" | "spire" | "slant" | "garden")
  [-10, 110, 250, "slant"],
  [110, 86, 360, "spire"],
  [210, 120, 270, "garden"],
  [345, 78, 410, "spire"],
  [436, 104, 300, "slant"],
  [555, 92, 230, "flat"],
  [660, 120, 190, "garden"],
  [790, 70, 150, "flat"],
];

function buildWindows() {
  const r = rng(42);
  const out = [];
  NEAR_TOWERS.forEach(([x, w, h], ti) => {
    const top = HORIZON - h + 26;
    for (let y = top; y < HORIZON - 14; y += 14) {
      for (let wx = x + 8; wx < x + w - 10; wx += 12) {
        const v = r();
        if (v < 0.46) out.push({ x: wx, y, k: v < 0.12 ? "c" : "w", t: ti });
      }
    }
  });
  return out;
}
const WINDOWS = buildWindows();

const RUNWAY_LIGHTS = Array.from({ length: 16 }, (_, i) => 1130 + i * 30);
const REFLECTIONS = [
  [150, 760, 46], [240, 790, 30], [380, 770, 52], [470, 812, 36], [620, 748, 40],
  [720, 800, 28], [1240, 770, 40], [1360, 805, 54], [1470, 760, 34],
];

/* Organic canopy: a row of overlapping arcs along a polyline, closed downward. */
function bumps(pts, r, floor = 652) {
  let d = `M${pts[0][0]} ${floor}`;
  d += ` L${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / (r * 1.4)));
    for (let k = 1; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n;
      const y = y0 + ((y1 - y0) * k) / n;
      const rr = r * (0.8 + (((i * 7 + k * 3) % 5) / 10));
      d += ` A${rr} ${rr} 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
  }
  const last = pts[pts.length - 1];
  return `${d} L${last[0]} ${floor} Z`;
}

function Leaf({ d = 1, className = "", ...rest }) {
  // A large, slightly asymmetric tropical leaf pointing right from (0,0).
  const L = 260 * d;
  return (
    <g className={`ws-leaf ${className}`} {...rest}>
      <path
        className="ws-leaf__blade"
        d={`M0 0 C ${L * 0.25} ${-L * 0.32}, ${L * 0.72} ${-L * 0.3}, ${L} 0 C ${L * 0.7} ${L * 0.26}, ${L * 0.25} ${L * 0.28}, 0 0 Z`}
      />
      <path className="ws-leaf__rib" d={`M0 0 Q ${L * 0.5} ${-L * 0.02} ${L * 0.98} 0`} />
      {[0.22, 0.38, 0.54, 0.7].map((t) => (
        <path
          key={t}
          className="ws-leaf__vein"
          d={`M${L * t} 0 Q ${L * (t + 0.08)} ${-L * 0.1} ${L * (t + 0.16)} ${-L * 0.17} M${L * t} 0 Q ${L * (t + 0.08)} ${L * 0.09} ${L * (t + 0.15)} ${L * 0.15}`}
        />
      ))}
    </g>
  );
}

function Frond({ x, y, rot, flip = false, scale = 1, sway = "a" }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${flip ? -scale : scale} ${scale})`}>
      <g className={`ws-sway ws-sway--${sway}`}>
        <Leaf d={1.15} transform="rotate(-28)" />
        <Leaf d={0.95} transform="rotate(-2)" className="ws-leaf--b" />
        <Leaf d={0.8} transform="rotate(24)" />
      </g>
    </g>
  );
}

export default function WorldScene({ variant = "hero", className = "", parallax = true }) {
  const rootRef = useRef(null);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = (n) => `ws${uid}${n}`;

  // Pause animations off-screen.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver(([e]) => {
      el.classList.toggle("ws--paused", !e.isIntersecting);
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Gentle pointer parallax: desktop pointers only, never with reduced motion.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !parallax || variant === "strip" || typeof window.matchMedia !== "function") return undefined;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!fine.matches || reduce.matches) return undefined;

    let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
    const tick = () => {
      cx += (tx - cx) * 0.06;
      cy += (ty - cy) * 0.06;
      el.style.setProperty("--ws-px", cx.toFixed(4));
      el.style.setProperty("--ws-py", cy.toFixed(4));
      raf = Math.abs(tx - cx) > 0.001 || Math.abs(ty - cy) > 0.001 ? requestAnimationFrame(tick) : 0;
    };
    const onMove = (e) => {
      tx = e.clientX / window.innerWidth - 0.5;
      ty = e.clientY / window.innerHeight - 0.5;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [parallax, variant]);

  const preserve = variant === "strip" ? "xMidYMid slice" : "xMidYMax slice";

  return (
    <div ref={rootRef} className={`ws ws--${variant} ${className}`} aria-hidden="true">
      <svg className="ws__svg" viewBox="0 0 1600 900" preserveAspectRatio={preserve} focusable="false">
        <defs>
          <linearGradient id={id("sky")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="ws-s-sky1" />
            <stop offset="0.55" className="ws-s-sky2" />
            <stop offset="1" className="ws-s-sky3" />
          </linearGradient>
          <radialGradient id={id("glow")} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" className="ws-s-glow" />
            <stop offset="1" className="ws-s-glow" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={id("ray")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="ws-s-ray" />
            <stop offset="1" className="ws-s-ray" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={id("glass")} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" className="ws-s-glass1" />
            <stop offset="1" className="ws-s-glass2" />
          </linearGradient>
          <linearGradient id={id("water")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="ws-s-water1" />
            <stop offset="0.5" className="ws-s-water2" />
            <stop offset="1" className="ws-s-water3" />
          </linearGradient>
          <linearGradient id={id("fall")} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" className="ws-s-fall1" />
            <stop offset="0.5" className="ws-s-fall2" />
            <stop offset="1" className="ws-s-fall1" />
          </linearGradient>
          <linearGradient id={id("haze")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="ws-s-haze" stopOpacity="0" />
            <stop offset="1" className="ws-s-haze" />
          </linearGradient>
          <clipPath id={id("fallclip")}>
            <path d="M1032 392 C 1030 470, 1022 560, 1008 652 L 1142 652 C 1128 560, 1118 470, 1114 392 Z" />
          </clipPath>
          <clipPath id={id("riverclip")}>
            <path d="M995 650 C 960 690, 830 704, 720 730 C 560 770, 300 798, -20 816 L -20 920 L 1620 920 L 1620 836 C 1320 812, 1040 796, 930 764 C 1060 734, 1170 694, 1150 650 Z" />
          </clipPath>
        </defs>

        {/* ── Sky ─────────────────────────────── */}
        <rect width="1600" height="900" fill={`url(#${id("sky")})`} />
        <g className="ws-layer ws-layer--sky">
          <circle className="ws-orb-glow" cx="1260" cy="170" r="190" fill={`url(#${id("glow")})`} />
          <g className="ws-clouds">
            <ellipse cx="420" cy="230" rx="220" ry="18" />
            <ellipse cx="1000" cy="300" rx="300" ry="14" />
            <ellipse cx="1450" cy="330" rx="200" ry="12" />
          </g>
        </g>

        {/* ── Far skyline + airport (background) ── */}
        <g className="ws-layer ws-layer--far">
          <g className="ws-far-city">
            {FAR_TOWERS.map(([x, w, h], i) => (
              <rect key={i} x={x} y={HORIZON - h} width={w} height={h} rx="2" />
            ))}
          </g>

          {/* Airport: glass terminal, control tower, runway */}
          <g className="ws-airport" transform="translate(50 0)">
            <rect className="ws-apron" x="1100" y={HORIZON - 4} width="520" height="40" />
            <path className="ws-terminal" d="M1170 558 Q1320 462 1470 558 Z" fill={`url(#${id("glass")})`} />
            <g className="ws-terminal-mullions">
              {[1210, 1250, 1290, 1330, 1370, 1410, 1450].map((x) => (
                <line key={x} x1={x} y1="558" x2={1320 + (x - 1320) * 0.55} y2={x > 1200 && x < 1440 ? 492 + Math.abs(x - 1320) * 0.32 : 540} />
              ))}
              <path d="M1196 536 Q1320 478 1444 536" fill="none" />
            </g>
            <g className="ws-terminal-lights">
              {[1220, 1260, 1300, 1340, 1380, 1420].map((x) => (
                <rect key={x} x={x} y="546" width="18" height="3" rx="1.5" />
              ))}
            </g>
            <g className="ws-tower">
              <rect x="1524" y="408" width="14" height="152" />
              <path d="M1508 404 L1554 404 L1546 384 L1516 384 Z" />
              <rect className="ws-tower__cab" x="1514" y="388" width="34" height="11" />
              <circle className="ws-beacon" cx="1531" cy="376" r="3.2" />
              <line x1="1531" y1="384" x2="1531" y2="372" />
            </g>
            <path className="ws-runway" d="M1080 586 L1620 576 L1620 594 L1060 600 Z" />
            <g className="ws-runway-lights">
              {RUNWAY_LIGHTS.map((x, i) => (
                <circle key={x} cx={x} cy={591 - i * 0.55} r="2.2" style={{ animationDelay: `${i * 0.16}s` }} />
              ))}
            </g>
            {/* Aircraft taking off, slowly */}
            <g className="ws-plane-path">
              <g className="ws-plane">
                <path d="M0 0 L46 -3 C52 -3.5 56 -2 56 0 C56 2 52 3 46 3 L0 3 Z" />
                <path d="M18 0 L30 -14 L35 -14 L28 1 Z" />
                <path d="M20 3 L32 14 L36 14 L29 2 Z" />
                <path d="M2 0 L-2 -10 L4 -10 L9 0 Z" />
                <circle className="ws-plane__nav" cx="56" cy="0" r="1.6" />
              </g>
            </g>
          </g>
        </g>

        {/* ── Near city: glass towers, rooftop gardens, elevated transit ── */}
        <g className="ws-layer ws-layer--city">
          {NEAR_TOWERS.map(([x, w, h, crown], i) => {
            const top = HORIZON - h;
            return (
              <g key={i} className="ws-tower-near">
                <rect x={x} y={top} width={w} height={h} fill={`url(#${id("glass")})`} />
                <rect className="ws-tower-edge" x={x} y={top} width="3" height={h} />
                {crown === "spire" && <path className="ws-crown" d={`M${x + w / 2 - 3} ${top} L${x + w / 2} ${top - 54} L${x + w / 2 + 3} ${top} Z`} />}
                {crown === "slant" && <path className="ws-crown" d={`M${x} ${top} L${x + w} ${top - 26} L${x + w} ${top} Z`} />}
                {crown === "garden" && (
                  <g className="ws-garden">
                    <rect x={x - 4} y={top - 4} width={w + 8} height="6" rx="2" />
                    {[0.15, 0.35, 0.55, 0.78].map((t, j) => (
                      <ellipse key={j} cx={x + w * t} cy={top - 10 - (j % 2) * 5} rx={12 + (j % 2) * 5} ry={9 + (j % 2) * 4} />
                    ))}
                  </g>
                )}
                {crown === "spire" && <circle className="ws-beacon ws-beacon--slow" cx={x + w / 2} cy={top - 54} r="2.4" />}
              </g>
            );
          })}
          <g className="ws-windows">
            {WINDOWS.map((wn, i) => (
              <rect key={i} className={wn.k === "c" ? "ws-win ws-win--c" : "ws-win"} x={wn.x} y={wn.y} width="6" height="7" />
            ))}
          </g>

          {/* Elevated transit line */}
          <g className="ws-transit">
            {[60, 200, 340, 480, 620, 760, 900].map((x) => (
              <rect key={x} className="ws-pillar" x={x} y="478" width="7" height={HORIZON - 478} />
            ))}
            <path className="ws-guideway" d="M-20 472 L960 472 Q 990 472 1010 480" />
            <g className="ws-train">
              <rect x="0" y="456" width="64" height="14" rx="6" />
              <rect x="68" y="456" width="64" height="14" rx="3" />
              <rect x="136" y="456" width="60" height="14" rx="6" />
              {[8, 22, 36, 50, 76, 90, 104, 118, 144, 158, 172].map((x) => (
                <rect key={x} className="ws-train__win" x={x} y="460" width="9" height="4" rx="1" />
              ))}
            </g>
          </g>
          <rect className="ws-haze" x="-20" y="380" width="1640" height={HORIZON - 360} fill={`url(#${id("haze")})`} />
        </g>

        {/* ── Light rays ── */}
        <g className="ws-rays">
          <path d="M1180 0 L1300 0 L980 700 L820 700 Z" fill={`url(#${id("ray")})`} />
          <path d="M1340 0 L1400 0 L1140 640 L1060 640 Z" fill={`url(#${id("ray")})`} />
        </g>

        {/* ── Midground: jungle cliff + waterfall ── */}
        <g className="ws-layer ws-layer--mid">
          <path className="ws-ground" d="M-20 600 C 300 586, 600 600, 900 610 L 1620 600 L1620 700 L-20 720 Z" />
          <path className="ws-cliff" d="M840 650 C 860 560, 910 490, 966 440 C 994 416, 1020 400, 1036 394 L 1112 394 C 1150 404, 1190 440, 1220 490 C 1246 540, 1266 600, 1280 650 Z" />
          <path className="ws-canopy-shape" d={bumps([[828, 640], [850, 560], [890, 500], [940, 452], [990, 418], [1034, 396]], 26)} />
          <path className="ws-canopy-shape" d={bumps([[1112, 396], [1160, 420], [1200, 460], [1236, 520], [1262, 590], [1278, 650]], 26)} />
          <path className="ws-canopy-shape ws-canopy-shape--hi" d={bumps([[860, 600], [900, 530], [950, 480], [1000, 440]], 14, 652)} />
          <path className="ws-canopy-shape ws-canopy-shape--hi" d={bumps([[1150, 430], [1196, 470], [1230, 540]], 14, 652)} />
          <g className="ws-rock">
            <path d="M1022 404 C 1012 470, 1000 560, 990 652 L 1012 652 C 1022 560, 1030 470, 1034 400 Z" />
            <path d="M1112 400 C 1118 470, 1128 560, 1140 652 L 1166 652 C 1150 560, 1134 470, 1124 404 Z" />
          </g>

          {/* Waterfall */}
          <path className="ws-fall" d="M1032 392 C 1030 470, 1022 560, 1008 652 L 1142 652 C 1128 560, 1118 470, 1114 392 Z" fill={`url(#${id("fall")})`} />
          <g clipPath={`url(#${id("fallclip")})`}>
            <g className="ws-fall-flow">
              {Array.from({ length: 14 }, (_, i) => 1012 + i * 9.5).map((x, i) => (
                <g key={x}>
                  {[0, 1, 2, 3, 4].map((k) => (
                    <rect key={k} className="ws-fall-streak" x={x} y={240 + k * 120 + (i % 3) * 36} width={i % 2 ? 2 : 3.2} height={52 + (i % 4) * 14} rx="1.5" />
                  ))}
                </g>
              ))}
            </g>
          </g>
          <path className="ws-strand" d="M1052 396 C 1050 480, 1046 560, 1040 652 L 1046 652 C 1052 560, 1056 480, 1058 396 Z" />
          <path className="ws-strand" d="M1092 396 C 1096 480, 1102 560, 1108 652 L 1114 652 C 1108 560, 1100 480, 1098 396 Z" />
          <ellipse className="ws-lip" cx="1073" cy="394" rx="42" ry="3" />
          <g className="ws-mist">
            <ellipse className="ws-mist__a" cx="1075" cy="652" rx="150" ry="34" fill={`url(#${id("glow")})`} />
            <ellipse className="ws-mist__b" cx="1040" cy="636" rx="110" ry="28" fill={`url(#${id("glow")})`} />
            <ellipse className="ws-mist__c" cx="1120" cy="640" rx="100" ry="24" fill={`url(#${id("glow")})`} />
          </g>
        </g>

        {/* ── Foreground: river ── */}
        <g className="ws-layer ws-layer--river">
          <path className="ws-river" d="M995 650 C 960 690, 830 704, 720 730 C 560 770, 300 798, -20 816 L -20 920 L 1620 920 L 1620 836 C 1320 812, 1040 796, 930 764 C 1060 734, 1170 694, 1150 650 Z" fill={`url(#${id("water")})`} />
          <g clipPath={`url(#${id("riverclip")})`}>
            <g className="ws-reflections">
              {REFLECTIONS.map(([x, y, w], i) => (
                <rect key={i} x={x} y={y} width={w} height="3" rx="1.5" style={{ animationDelay: `${i * 0.6}s` }} />
              ))}
            </g>
            <g className="ws-shimmer">
              <path d="M940 690 C 800 720, 640 740, 480 760" />
              <path d="M1100 700 C 1150 730, 1300 760, 1480 790" />
              <path d="M1000 740 C 820 780, 520 812, 220 840" />
              <path d="M1180 760 C 1280 800, 1420 830, 1600 850" />
              <path d="M760 820 C 560 846, 360 862, 120 880" />
            </g>
            <g className="ws-shimmer ws-shimmer--b">
              <path d="M1060 680 C 1000 700, 900 716, 800 728" />
              <path d="M900 790 C 1000 812, 1160 830, 1340 852" />
              <path d="M600 800 C 460 820, 300 834, 60 852" />
            </g>
          </g>
          <path className="ws-bank" d="M-20 800 C 200 790, 500 760, 760 724 C 600 770, 300 800, -20 830 Z" />
          <path className="ws-bank" d="M1620 790 C 1440 770, 1280 730, 1200 690 C 1300 760, 1460 800, 1620 820 Z" />
          <path className="ws-mistband" d="M-20 640 C 400 610, 1200 610, 1620 640 L1620 690 C 1200 660, 400 660, -20 690 Z" />
        </g>

        {/* ── Foreground leaves framing the edges ── */}
        <g className="ws-layer ws-layer--fore">
          <Frond x={-40} y={920} rot={-58} scale={1} sway="a" />
          <Frond x={-70} y={760} rot={-12} scale={0.7} sway="b" />
          <Frond x={1640} y={920} rot={58} flip scale={1.05} sway="b" />
          <Frond x={1650} y={80} rot={18} flip scale={0.95} sway="a" />
          <Frond x={1660} y={700} rot={-4} flip scale={0.6} sway="a" />
        </g>
      </svg>
    </div>
  );
}
