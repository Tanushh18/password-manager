import React, { useId } from "react";
import "./Robot.css";

/* Eyes and mouth per mood, inside the visor. Drawn in a 100 x 132 box. */
function Face({ mood }) {
  if (mood === "dead") return (
    <g className="bot-face" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
      <path d="M33 39 l10 10 M43 39 l-10 10 M57 39 l10 10 M67 39 l-10 10" />
      <path d="M38 61 q12 -6 24 0" fill="none" />
    </g>
  );
  if (mood === "sleeping") return (
    <g className="bot-face" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none">
      <path d="M32 45 q6 4 12 0 M56 45 q6 4 12 0" />
      <path d="M44 60 h12" />
    </g>
  );
  const S = { stroke: "currentColor", strokeWidth: 3, strokeLinecap: "round", fill: "none" };
  if (mood === "celebrating") return (
    <g className="bot-face">
      <path d="M32 47 q6 -8 12 0 M56 47 q6 -8 12 0" {...S} />
      <path d="M36 56 q14 14 28 0 z" fill="currentColor" />
    </g>
  );
  if (mood === "starstruck") {
    const star = (cx, cy) => `M${cx} ${cy - 7} L${cx + 2} ${cy - 2} L${cx + 7} ${cy - 2} L${cx + 3} ${cy + 1.5} L${cx + 4.5} ${cy + 7} L${cx} ${cy + 3.5} L${cx - 4.5} ${cy + 7} L${cx - 3} ${cy + 1.5} L${cx - 7} ${cy - 2} L${cx - 2} ${cy - 2} Z`;
    return (
      <g className="bot-face">
        <path className="bot-eye bot-eye--star" d={star(38, 44)} fill="currentColor" />
        <path className="bot-eye bot-eye--star" d={star(62, 44)} fill="currentColor" />
        <path d="M39 57 q11 10 22 0" {...S} />
      </g>
    );
  }
  if (mood === "bored") return (
    <g className="bot-face">
      <path d="M31 44 h14 M55 44 h14" {...S} />
      <circle cx="38" cy="47" r="2.6" fill="currentColor" /><circle cx="62" cy="47" r="2.6" fill="currentColor" />
      <path d="M42 61 h16" {...S} />
    </g>
  );
  if (mood === "tired") return (
    <g className="bot-face">
      <path d="M32 43 q6 5 12 0 M56 43 q6 5 12 0" {...S} />
      <path d="M33 49 q5 2 10 0 M57 49 q5 2 10 0" {...S} strokeWidth={1.6} opacity={0.6} />
      <ellipse className="bot-yawn" cx="50" cy="61" rx="4.5" ry="5.5" fill="currentColor" />
    </g>
  );
  if (mood === "angry") return (
    <g className="bot-face">
      <path d="M30 36 l14 5 M70 36 l-14 5" {...S} />
      <circle className="bot-eye" cx="38" cy="46" r="5" fill="currentColor" /><circle className="bot-eye" cx="62" cy="46" r="5" fill="currentColor" />
      <path d="M39 63 q11 -8 22 0" {...S} />
    </g>
  );
  if (mood === "scared") return (
    <g className="bot-face">
      <circle cx="38" cy="44" r="7" {...S} strokeWidth={2.4} /><circle cx="62" cy="44" r="7" {...S} strokeWidth={2.4} />
      <circle className="bot-eye bot-eye--dart" cx="38" cy="44" r="2.2" fill="currentColor" /><circle className="bot-eye bot-eye--dart" cx="62" cy="44" r="2.2" fill="currentColor" />
      <path d="M38 62 q3 -3 6 0 t6 0 t6 0 t6 0" {...S} strokeWidth={2.4} />
    </g>
  );
  if (mood === "dizzy") {
    const spiral = (cx, cy) => `M${cx} ${cy} m-1 0 a1 1 0 1 1 2 0 a3 3 0 1 1 -5 0 a5 5 0 1 1 9 0 a6.5 6.5 0 1 1 -12 0`;
    return (
      <g className="bot-face">
        <path className="bot-eye bot-eye--spin" d={spiral(38, 44)} {...S} strokeWidth={2.2} />
        <path className="bot-eye bot-eye--spin" d={spiral(62, 44)} {...S} strokeWidth={2.2} />
        <path d="M40 62 q5 -5 10 0 t10 0" {...S} />
      </g>
    );
  }
  const big = mood === "fire" || mood === "transforming";
  const r = big ? 6.5 : 5.5;
  return (
    <g className="bot-face">
      <circle className="bot-eye__glow" cx="38" cy="44" r={r + 4} />
      <circle className="bot-eye__glow" cx="62" cy="44" r={r + 4} />
      <circle className="bot-eye" cx="38" cy="44" r={r} fill="currentColor" />
      <circle className="bot-eye" cx="62" cy="44" r={r} fill="currentColor" />
      <circle cx="40" cy="42" r="1.6" className="bot-eye__shine" />
      <circle cx="64" cy="42" r="1.6" className="bot-eye__shine" />
      {mood === "fire" && <ellipse cx="50" cy="61" rx="8" ry="6" fill="currentColor" />}
      {mood === "sweaty" && <path d="M41 62 q9 -5 18 0" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />}
      {mood === "chill" && <path d="M39 58 q11 8 22 0" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />}
      {mood === "transforming" && <path d="M40 61 h20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="3 3" />}
      {mood === "confused" && <path d="M40 62 q5 -4 10 0 t10 0" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />}
    </g>
  );
}

/**
 * A server (or app) as a robot: metal body, glowing visor, a chest meter for its load and a hover thruster.
 * `mood` drives the face, colours and animation; `load` (0-100) fills the meter and speeds up the core.
 * Purely decorative: the card around it carries the real text, so it is hidden from screen readers.
 */
export default function Robot({ mood = "confused", load = null, cpu = null, memory = null, size = 96 }) {
  const clamp = (v) => (v == null || !Number.isFinite(v) ? null : Math.max(0, Math.min(100, v)));
  const fill = clamp(load) ?? 0;
  // The body follows the live numbers: memory swells the belly, CPU heats the head red and lengthens the flame.
  const c = clamp(cpu) ?? clamp(load) ?? 0, m = clamp(memory) ?? 0;
  const heat = Math.max(0, Math.min(1, (c - 50) / 45));
  const body = { "--bot-belly": (1 + (m / 100) * 0.24).toFixed(3), "--bot-heat": heat.toFixed(2), "--bot-jet": (0.55 + (c / 100) * 0.95).toFixed(2) };
  const id = "bot" + useId().replace(/[^a-z0-9]/gi, "");
  // The chest core beats faster as the load rises (2.4 s idle, 0.5 s flat out).
  const beat = Math.max(0.5, 2.4 - fill * 0.019).toFixed(2) + "s";
  const alive = !["dead", "sleeping"].includes(mood);
  return (
    <div className={"bot bot--" + mood + (heat > 0.4 ? " is-hot" : "")} style={{ width: size, height: size * 1.32, "--bot-beat": beat, ...body }} aria-hidden="true">
      {heat > 0.4 && alive && <span className="bot-fx bot-fx--steam">♨</span>}
      {mood === "fire" && <span className="bot-fx bot-fx--fire">🔥</span>}
      {mood === "sleeping" && <span className="bot-fx bot-fx--zzz">z<small>z</small><small>z</small></span>}
      {mood === "sweaty" && <span className="bot-fx bot-fx--drop">💧</span>}
      {mood === "confused" && <span className="bot-fx bot-fx--q">?</span>}
      {mood === "transforming" && <span className="bot-fx bot-fx--ring" />}
      {mood === "celebrating" && <span className="bot-fx bot-fx--party">🎉</span>}
      {mood === "starstruck" && <span className="bot-fx bot-fx--spark">✨</span>}
      {mood === "bored" && <span className="bot-fx bot-fx--dots">…</span>}
      {mood === "tired" && <span className="bot-fx bot-fx--zzz bot-fx--small">z</span>}
      {mood === "angry" && <span className="bot-fx bot-fx--anger">💢</span>}
      {mood === "scared" && <span className="bot-fx bot-fx--q bot-fx--alert">!</span>}
      {mood === "dizzy" && <span className="bot-fx bot-fx--dizzy">💫</span>}
      <svg className="bot-svg" viewBox="0 0 100 132" width="100%" height="100%">
        <defs>
          <linearGradient id={id + "m"} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="bot-metal__hi" />
            <stop offset="1" className="bot-metal__lo" />
          </linearGradient>
          <linearGradient id={id + "v"} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" className="bot-visor__hi" />
            <stop offset="1" className="bot-visor__lo" />
          </linearGradient>
          <clipPath id={id + "c"}><rect x="24" y="29" width="52" height="40" rx="11" /></clipPath>
        </defs>

        {/* antenna */}
        <line x1="50" y1="7" x2="50" y2="19" className="bot-line" />
        <circle cx="50" cy="6" r="4.5" className="bot-light bot-antenna" />
        {/* head */}
        <rect x="16" y="19" width="68" height="56" rx="17" fill={"url(#" + id + "m)"} className="bot-shell" />
        <path d="M24 23 h52" className="bot-seam" />
        <rect x="24" y="29" width="52" height="40" rx="11" fill={"url(#" + id + "v)"} className="bot-visor" />
        <rect x="16" y="19" width="68" height="56" rx="17" className="bot-heat" />
        <g className="bot-eyes"><Face mood={mood} /></g>
        {alive && <g clipPath={"url(#" + id + "c)"}><rect className="bot-scan" x="24" y="29" width="52" height="5" /></g>}
        <g className="bot-hud"><line x1="27" y1="65" x2="34" y2="65" /><line x1="66" y1="65" x2="73" y2="65" /></g>
        {/* ear pods with status lights */}
        <rect x="8" y="37" width="9" height="22" rx="4.5" fill={"url(#" + id + "m)"} className="bot-shell" />
        <rect x="83" y="37" width="9" height="22" rx="4.5" fill={"url(#" + id + "m)"} className="bot-shell" />
        <circle cx="12.5" cy="48" r="1.8" className="bot-light bot-light--small" />
        <circle cx="87.5" cy="48" r="1.8" className="bot-light bot-light--small" />
        {/* neck */}
        <rect x="42" y="75" width="16" height="6" rx="2" className="bot-neck" />

        <g className="bot-body">
          {/* shoulders + arms */}
          <circle cx="23" cy="88" r="6" fill={"url(#" + id + "m)"} className="bot-shell" />
          <circle cx="77" cy="88" r="6" fill={"url(#" + id + "m)"} className="bot-shell" />
          <rect className="bot-arm bot-arm--l" x="9" y="85" width="13" height="7" rx="3.5" fill={"url(#" + id + "m)"} />
          <rect className="bot-arm bot-arm--r" x="78" y="85" width="13" height="7" rx="3.5" fill={"url(#" + id + "m)"} />
          {/* torso: the belly swells with memory; two meters show CPU and memory */}
          <g className="bot-belly">
            <rect x="27" y="80" width="46" height="34" rx="11" fill={"url(#" + id + "m)"} className="bot-shell" />
            <rect x="33" y="85" width="34" height="24" rx="6" className="bot-plate" />
            <rect x="37" y="88" width="26" height="4" rx="2" className="bot-meter" />
            <rect x="37" y="88" width={(26 * c) / 100} height="4" rx="2" className="bot-meter__fill" />
            <rect x="37" y="94" width="26" height="4" rx="2" className="bot-meter" />
            <rect x="37" y="94" width={(26 * m) / 100} height="4" rx="2" className="bot-meter__fill bot-meter__fill--mem" />
            <circle cx="50" cy="104" r="2.6" className="bot-light bot-core" />
            <circle cx="50" cy="104" r="5" className="bot-core__ring" />
            <circle cx="41" cy="104" r="1.5" className="bot-light bot-light--small" />
            <circle cx="59" cy="104" r="1.5" className="bot-light bot-light--small" />
          </g>
        </g>
        {/* hover thruster */}
        <path d="M40 114 h20 l-4 6 h-12 z" className="bot-shell bot-thruster" fill={"url(#" + id + "m)"} />
        {alive && <g className="bot-jet"><ellipse cx="50" cy="125" rx="5" ry="6" className="bot-flame" /></g>}
      </svg>
    </div>
  );
}
