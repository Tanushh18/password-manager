import React, { useId } from "react";
import { Face } from "./Robot";
import "./Robot.css";
import "./Mascot.css";

/*
 * Page mascots: a safe, a rocket, an alarm clock, a shield, a gear and a satellite. They share the robot's face and
 * emotions (same mood names, colours and animations), each with its own body and one trick of its own.
 * Drawn in the robot's 100 x 132 box so the face sits in the same place. Decorative only.
 */
function Body({ kind, id, alive }) {
  const metal = "url(#" + id + "m)";
  const visor = "url(#" + id + "v)";
  switch (kind) {
    case "safe": return (
      <>
        <rect x="12" y="16" width="76" height="98" rx="12" fill={metal} className="bot-shell" />
        <rect x="18" y="22" width="64" height="86" rx="8" className="bot-plate" />
        <rect x="8" y="34" width="5" height="16" rx="2" className="bot-shell mascot-hinge" fill={metal} />
        <rect x="8" y="78" width="5" height="16" rx="2" className="bot-shell mascot-hinge" fill={metal} />
        <rect x="24" y="29" width="52" height="40" rx="10" fill={visor} className="bot-visor" />
        <g className="mascot-dial"><circle cx="50" cy="90" r="11" className="mascot-dial__ring" /><path d="M50 81 v5 M59 90 h-5 M50 99 v-5 M41 90 h5" className="mascot-dial__ticks" /><circle cx="50" cy="90" r="3" className="bot-light" /></g>
        <rect x="20" y="114" width="14" height="8" rx="3" className="bot-neck" /><rect x="66" y="114" width="14" height="8" rx="3" className="bot-neck" />
      </>
    );
    case "rocket": return (
      <>
        <path d="M50 2 C70 16 78 40 78 70 L78 100 L22 100 L22 70 C22 40 30 16 50 2 Z" fill={metal} className="bot-shell" />
        <circle cx="50" cy="16" r="3.5" className="bot-light bot-antenna" />
        <rect x="24" y="29" width="52" height="40" rx="20" fill={visor} className="bot-visor" />
        <path d="M22 78 L6 104 L22 100 Z M78 78 L94 104 L78 100 Z" fill={metal} className="bot-shell mascot-fin" />
        <rect x="34" y="78" width="32" height="5" rx="2.5" className="bot-meter" />
        <path d="M34 100 h32 l-5 10 h-22 z" fill={metal} className="bot-shell" />
        {alive && <g className="bot-jet"><ellipse cx="50" cy="121" rx="8" ry="10" className="bot-flame" /></g>}
      </>
    );
    case "clock": return (
      <>
        <g className="mascot-bells">
          <circle cx="24" cy="18" r="11" fill={metal} className="bot-shell" />
          <circle cx="76" cy="18" r="11" fill={metal} className="bot-shell" />
          <path d="M44 8 h12" className="bot-line" />
        </g>
        <circle cx="50" cy="56" r="42" fill={metal} className="bot-shell" />
        <circle cx="50" cy="56" r="35" className="bot-plate" />
        <rect x="24" y="29" width="52" height="40" rx="18" fill={visor} className="bot-visor" />
        <g className="mascot-ticks">{Array.from({ length: 12 }, (_, i) => { const a = (i * Math.PI) / 6; return <line key={i} x1={50 + 38 * Math.sin(a)} y1={56 - 38 * Math.cos(a)} x2={50 + 40.5 * Math.sin(a)} y2={56 - 40.5 * Math.cos(a)} />; })}</g>
        <path d="M28 96 l-8 18 M72 96 l8 18" className="bot-line" />
        <rect x="12" y="112" width="16" height="6" rx="3" className="bot-neck" /><rect x="72" y="112" width="16" height="6" rx="3" className="bot-neck" />
      </>
    );
    case "shield": return (
      <>
        <path d="M50 6 L88 18 C88 62 76 96 50 118 C24 96 12 62 12 18 Z" fill={metal} className="bot-shell" />
        <path d="M50 14 L80 24 C80 60 70 88 50 106 C30 88 20 60 20 24 Z" className="bot-plate" />
        <rect x="24" y="29" width="52" height="40" rx="12" fill={visor} className="bot-visor" />
        <path d="M40 84 l7 7 l14 -14" className="mascot-check" />
      </>
    );
    case "gear": return (
      <>
        <g className="mascot-gear">
          <circle cx="50" cy="52" r="40" className="mascot-gear__teeth" />
          <circle cx="50" cy="52" r="36" fill={metal} className="bot-shell" />
        </g>
        <rect x="24" y="29" width="52" height="40" rx="18" fill={visor} className="bot-visor" />
        <circle cx="50" cy="80" r="4" className="bot-light bot-core" />
        <path d="M38 92 l-6 22 M62 92 l6 22" className="bot-line" />
        <rect x="22" y="112" width="16" height="6" rx="3" className="bot-neck" /><rect x="62" y="112" width="16" height="6" rx="3" className="bot-neck" />
      </>
    );
    case "satellite": return (
      <>
        <g className="mascot-waves"><path d="M62 4 q8 6 0 14 M68 0 q12 10 0 22" /></g>
        <line x1="50" y1="10" x2="50" y2="20" className="bot-line" /><circle cx="50" cy="9" r="4" className="bot-light bot-antenna" />
        <rect x="4" y="38" width="12" height="30" rx="2" className="mascot-panel" />
        <rect x="84" y="38" width="12" height="30" rx="2" className="mascot-panel" />
        <path d="M16 53 h8 M76 53 h8" className="bot-line" />
        <rect x="20" y="20" width="60" height="62" rx="20" fill={metal} className="bot-shell" />
        <rect x="24" y="29" width="52" height="40" rx="12" fill={visor} className="bot-visor" />
        <path d="M36 88 q14 14 28 0" className="bot-line mascot-dish" />
        <line x1="50" y1="94" x2="50" y2="110" className="bot-line" />
        <rect x="38" y="110" width="24" height="7" rx="3" className="bot-neck" />
      </>
    );
    default: return null;
  }
}

export default function Mascot({ kind = "safe", mood = "chill", size = 72 }) {
  const id = "m" + useId().replace(/[^a-z0-9]/gi, "");
  const alive = !["dead", "sleeping"].includes(mood);
  return (
    <div className={"bot mascot mascot--" + kind + " bot--" + mood} style={{ width: size, height: size * 1.32 }} aria-hidden="true">
      {mood === "fire" && <span className="bot-fx bot-fx--fire">🔥</span>}
      {mood === "sleeping" && <span className="bot-fx bot-fx--zzz">z<small>z</small><small>z</small></span>}
      {mood === "celebrating" && <span className="bot-fx bot-fx--party">🎉</span>}
      {mood === "starstruck" && <span className="bot-fx bot-fx--spark">✨</span>}
      {mood === "scared" && <span className="bot-fx bot-fx--q bot-fx--alert">!</span>}
      {mood === "angry" && <span className="bot-fx bot-fx--anger">💢</span>}
      {mood === "dizzy" && <span className="bot-fx bot-fx--dizzy">💫</span>}
      {mood === "confused" && <span className="bot-fx bot-fx--q">?</span>}
      {mood === "sweaty" && <span className="bot-fx bot-fx--drop">💧</span>}
      {mood === "bored" && <span className="bot-fx bot-fx--dots">…</span>}
      <svg className="bot-svg" viewBox="0 0 100 132" width="100%" height="100%">
        <defs>
          <linearGradient id={id + "m"} x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="bot-metal__hi" /><stop offset="1" className="bot-metal__lo" /></linearGradient>
          <linearGradient id={id + "v"} x1="0" y1="0" x2="1" y2="1"><stop offset="0" className="bot-visor__hi" /><stop offset="1" className="bot-visor__lo" /></linearGradient>
        </defs>
        <Body kind={kind} id={id} alive={alive} />
        <g className="bot-eyes"><Face mood={mood} /></g>
      </svg>
    </div>
  );
}
