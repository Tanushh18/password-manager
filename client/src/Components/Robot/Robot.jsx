import React from "react";
import "./Robot.css";

/* Eyes and mouth per mood. Drawn in a 100 x 120 box. */
function Face({ mood }) {
  if (mood === "dead") return (
    <g className="bot-face" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
      <path d="M33 40 l10 10 M43 40 l-10 10 M57 40 l10 10 M67 40 l-10 10" />
      <path d="M38 62 q12 -6 24 0" fill="none" />
    </g>
  );
  if (mood === "sleeping") return (
    <g className="bot-face" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none">
      <path d="M32 46 q6 4 12 0 M56 46 q6 4 12 0" />
      <path d="M44 61 h12" />
    </g>
  );
  const big = mood === "fire" || mood === "transforming";
  return (
    <g className="bot-face">
      <circle className="bot-eye" cx="38" cy="45" r={big ? 7 : 6} fill="currentColor" />
      <circle className="bot-eye" cx="62" cy="45" r={big ? 7 : 6} fill="currentColor" />
      {mood === "fire" && <ellipse cx="50" cy="63" rx="9" ry="7" fill="currentColor" />}
      {mood === "sweaty" && <path d="M40 63 q10 -5 20 0" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />}
      {mood === "chill" && <path d="M38 60 q12 9 24 0" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />}
      {mood === "transforming" && <path d="M40 62 h20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />}
      {mood === "confused" && <path d="M40 63 q5 -4 10 0 t10 0" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />}
    </g>
  );
}

/**
 * A server (or app) as a small robot. `mood` drives the face and the animation; `load` (0-100) fills the chest
 * meter. Purely decorative: the card around it carries the real text, so it is hidden from screen readers.
 */
export default function Robot({ mood = "confused", load = null, size = 96 }) {
  const fill = load == null ? 0 : Math.max(0, Math.min(100, load));
  return (
    <div className={"bot bot--" + mood} style={{ width: size, height: size * 1.2 }} aria-hidden="true">
      {mood === "fire" && <span className="bot-fx bot-fx--fire">🔥</span>}
      {mood === "sleeping" && <span className="bot-fx bot-fx--zzz">z<small>z</small><small>z</small></span>}
      {mood === "sweaty" && <span className="bot-fx bot-fx--drop">💧</span>}
      {mood === "confused" && <span className="bot-fx bot-fx--q">?</span>}
      {mood === "transforming" && <span className="bot-fx bot-fx--ring" />}
      <svg className="bot-svg" viewBox="0 0 100 120" width="100%" height="100%">
        <line x1="50" y1="6" x2="50" y2="20" className="bot-line" />
        <circle cx="50" cy="6" r="5" className="bot-light" />
        <rect x="18" y="20" width="64" height="56" rx="16" className="bot-head" />
        <rect x="24" y="30" width="52" height="40" rx="11" className="bot-visor" />
        <g className="bot-eyes"><Face mood={mood} /></g>
        <rect x="10" y="40" width="8" height="18" rx="4" className="bot-ear" />
        <rect x="82" y="40" width="8" height="18" rx="4" className="bot-ear" />
        <g className="bot-body">
          <rect x="28" y="80" width="44" height="32" rx="10" className="bot-torso" />
          <rect x="35" y="88" width="30" height="7" rx="3.5" className="bot-meter" />
          <rect x="35" y="88" width={(30 * fill) / 100} height="7" rx="3.5" className="bot-meter__fill" />
          <circle cx="42" cy="103" r="2.5" className="bot-light bot-light--small" />
          <circle cx="50" cy="103" r="2.5" className="bot-light bot-light--small" />
          <circle cx="58" cy="103" r="2.5" className="bot-light bot-light--small" />
          <rect className="bot-arm bot-arm--l" x="14" y="84" width="12" height="7" rx="3.5" />
          <rect className="bot-arm bot-arm--r" x="74" y="84" width="12" height="7" rx="3.5" />
        </g>
      </svg>
    </div>
  );
}
