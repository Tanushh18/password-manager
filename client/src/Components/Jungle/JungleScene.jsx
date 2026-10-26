import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useVault } from "../../state/vault";
import { floaters, grassBlades, makeActor, modeFor, nextDelay } from "../../lib/jungle";
import "./JungleScene.css";

let nextId = 1;
const readTheme = () => (typeof document !== "undefined" && document.documentElement.getAttribute("data-theme")) || "dark";

/* Follows the light/dark switch without a page reload. */
function useThemeMode() {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(readTheme()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return modeFor(theme);
}

function Grass({ blades }) {
  return (
    <svg className="jg-grass" viewBox="0 0 1000 60" preserveAspectRatio="none" aria-hidden="true">
      {blades.map((b, i) => (
        <path key={i} className={"jg-blade t" + b.tone + " s" + b.sway} style={{ transformOrigin: `${b.x}px 60px` }}
          d={`M${b.x - b.w / 2} 60 Q${b.x + b.bend * 0.4} ${60 - b.h * 0.55} ${b.x + b.bend} ${60 - b.h} Q${b.x + b.bend * 0.3} ${60 - b.h * 0.5} ${b.x + b.w / 2} 60 Z`} />
      ))}
    </svg>
  );
}

/* A hanging vine with leaves; something sits on its end (a monkey by day, an owl by night). */
function Vine({ side, hanger, label }) {
  return (
    <div className={"jg-vine jg-vine--" + side} aria-hidden="true">
      <svg viewBox="0 0 120 230" width="120" height="230">
        <path className="jg-vine__stem" d="M60 0 C 40 50, 80 90, 58 140 S 62 200, 60 222" />
        {[[52, 34, -30], [70, 70, 35], [48, 104, -40], [68, 150, 30], [52, 186, -25]].map(([x, y, r], i) => (
          <path key={i} className="jg-leaf" transform={`translate(${x} ${y}) rotate(${r})`} d="M0 0 C 10 -12, 26 -8, 30 0 C 26 8, 10 12, 0 0 Z" />
        ))}
      </svg>
      <span className="jg-vine__hanger" title={label}>{hanger}</span>
    </div>
  );
}

function Leaves({ side }) {
  return (
    <svg className={"jg-leaves jg-leaves--" + side} viewBox="0 0 220 160" aria-hidden="true">
      <path className="jg-bigleaf l1" d="M20 160 C 10 90, 60 30, 140 20 C 120 70, 90 120, 20 160 Z" />
      <path className="jg-bigleaf l2" d="M60 160 C 70 110, 130 70, 210 70 C 180 110, 130 150, 60 160 Z" />
      <path className="jg-bigleaf l3" d="M0 160 C 0 120, 20 80, 60 60 C 55 100, 40 135, 0 160 Z" />
      <path className="jg-leafvein" d="M20 160 C 50 110, 90 60, 140 20 M60 160 C 110 130, 160 95, 210 70" />
    </svg>
  );
}

function Actor({ a, onDone }) {
  const style = { animationDuration: a.seconds + "s", ...(a.kind === "flyer" ? { top: a.top + "%" } : {}) };
  const body = (
    <span className={"jg-actor__body" + (a.hop ? " is-hop" : "")} style={{ fontSize: a.size }}>
      {a.rider && <span className="jg-rider">{a.rider}</span>}
      {a.flock ? Array.from({ length: a.flock }, (_, i) => <i key={i} className="jg-flockbird" style={{ "--i": i }}>{a.emoji}</i>) : a.emoji}
    </span>
  );
  return (
    <div className={"jg-actor jg-actor--" + a.kind + (a.fromLeft ? " is-ltr" : " is-rtl") + (a.robot ? " is-robot" : "")} style={style} onAnimationEnd={(e) => { if (e.target === e.currentTarget) onDone(); }}>
      <div className="jg-actor__face">{body}</div>
    </div>
  );
}

/*
 * The jungle that lives around every page: swaying grass along the bottom, vines in the top corners, big leaves,
 * animals walking and birds flying past, with Stashr's robots mixed in (riding elephants, walking with the herd).
 * Light theme = day jungle, dark theme = night jungle. Never takes clicks; reduced motion keeps it still; Settings can hide it.
 */
export default function JungleScene() {
  const { prefs } = useVault();
  const mode = useThemeMode();
  const enabled = prefs?.jungle !== false;
  const blades = useMemo(() => grassBlades(window.innerWidth < 600 ? 60 : 110), []);
  const lights = useMemo(() => floaters(window.innerWidth < 600 ? 5 : 9), []);
  const [actors, setActors] = useState([]);
  const add = useCallback((a) => setActors((l) => (l.length >= 4 ? l : [...l, { id: nextId++, ...a }])), []);
  const remove = useCallback((id) => setActors((l) => l.filter((x) => x.id !== id)), []);
  const still = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (!enabled) return undefined;
    document.body.classList.add("has-jungle");
    return () => document.body.classList.remove("has-jungle");
  }, [enabled]);

  useEffect(() => {
    if (!enabled || still) return undefined;
    setActors([]);
    const timers = [];
    const loop = (kind) => timers.push(window.setTimeout(() => { if (!document.hidden) add(makeActor(kind, mode)); loop(kind); }, nextDelay(kind)));
    timers.push(window.setTimeout(() => add(makeActor("walker", mode)), 1500));
    timers.push(window.setTimeout(() => add(makeActor("flyer", mode)), 5000));
    loop("walker"); loop("flyer");
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [enabled, still, mode, add]);

  if (!enabled) return null;
  const day = mode === "day";
  return (
    <div className={"jungle " + (day ? "is-day" : "is-night")} aria-hidden="true">
      <span className="jg-sky" />
      <Vine side="left" hanger={day ? "🐒" : "🦉"} label={day ? "monkey" : "owl"} />
      <Vine side="right" hanger={day ? "🦜" : "🤖"} label={day ? "parrot" : "robot"} />
      <div className="jg-lights">
        {lights.map((f, i) => (
          <i key={i} className={day ? "jg-butterfly" : "jg-firefly"} style={{ left: f.left + "%", bottom: f.bottom + "%", "--dx": f.dx + "px", "--dy": f.dy + "px", animationDuration: f.seconds + "s", animationDelay: f.delay + "ms" }}>{day ? "🦋" : ""}</i>
        ))}
      </div>
      {actors.map((a) => <Actor key={a.id} a={a} onDone={() => remove(a.id)} />)}
      <Leaves side="left" />
      <Leaves side="right" />
      <Grass blades={blades} />
    </div>
  );
}
