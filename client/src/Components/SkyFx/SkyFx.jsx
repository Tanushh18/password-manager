import React, { useCallback, useEffect, useRef, useState } from "react";
import { useVault } from "../../state/vault";
import { fx, nextDelay, robotFlight, sparks } from "../../lib/fx";
import "./SkyFx.css";

let nextId = 1;
const MAX_ON_SCREEN = 4;

/* A small flying robot: propeller on top, jet flame below. */
function FlyBot({ size, hue }) {
  return (
    <svg className="fxbot" viewBox="0 0 64 56" width={size} height={size * 0.875} aria-hidden="true" style={{ "--h": hue }}>
      <g className="fxbot__prop"><ellipse cx="32" cy="6" rx="20" ry="2.6" /><rect x="30.5" y="6" width="3" height="8" rx="1.5" /></g>
      <rect className="fxbot__head" x="14" y="14" width="36" height="26" rx="9" />
      <rect className="fxbot__visor" x="19" y="20" width="26" height="12" rx="6" />
      <circle className="fxbot__eye" cx="27" cy="26" r="2.6" /><circle className="fxbot__eye" cx="37" cy="26" r="2.6" />
      <rect className="fxbot__arm" x="8" y="24" width="6" height="12" rx="3" /><rect className="fxbot__arm" x="50" y="24" width="6" height="12" rx="3" />
      <path className="fxbot__flame" d="M25 40 q7 18 14 0 q-7 6 -14 0z" />
    </svg>
  );
}

/* A small airliner seen from the side; the wheels come down during a landing. */
function Plane({ gear }) {
  return (
    <svg className={"fxplane" + (gear ? " has-gear" : "")} viewBox="0 0 130 50" width="130" height="50" aria-hidden="true">
      <path className="fxplane__body" d="M6 26 q0 -9 14 -10 h70 q26 1 34 9 q-8 8 -34 9 h-70 q-14 -1 -14 -8z" />
      <path className="fxplane__tail" d="M10 22 l-8 -16 h14 l12 15z" />
      <path className="fxplane__wing" d="M60 28 l26 14 h-14 l-26 -12z" />
      <path className="fxplane__wing fxplane__wing--far" d="M62 24 l22 -12 h-12 l-22 11z" />
      {[34, 46, 58, 70, 82].map((x) => <circle key={x} className="fxplane__win" cx={x} cy="23" r="2" />)}
      <g className="fxplane__gear"><rect x="52" y="34" width="3" height="9" /><circle cx="53.5" cy="45" r="3.4" /><rect x="96" y="34" width="3" height="8" /><circle cx="97.5" cy="44" r="3" /></g>
    </svg>
  );
}

function Boom({ x, y, big }) {
  const [parts] = useState(() => sparks(big ? 26 : 18));
  return (
    <div className={"fxboom" + (big ? " fxboom--big" : "")} style={{ left: x, top: y }} aria-hidden="true">
      <span className="fxboom__flash" />
      <span className="fxboom__ring" />
      <span className="fxboom__emoji">💥</span>
      {parts.map((p, i) => (
        <i key={i} className="fxboom__spark" style={{ "--a": p.angle + "deg", "--d": p.dist + "px", width: p.size, height: p.size, background: p.color, animationDelay: p.delay + "ms" }} />
      ))}
      <b className="fxboom__smoke" /><b className="fxboom__smoke fxboom__smoke--2" />
    </div>
  );
}

/*
 * Crazy-but-harmless effects layer: robots fly by, planes land on a runway, things blow up cartoon-style.
 * Real actions trigger it (see lib/fx.js: a save lands a plane, deleting for good or a new incident sets off a bomb),
 * and now and then a robot or plane drifts through on its own. It never takes clicks, pauses while the tab is hidden,
 * stays off when the system asks for reduced motion, and can be switched off in Settings.
 */
export default function SkyFx() {
  const { prefs } = useVault();
  const [items, setItems] = useState([]);
  const last = useRef({ x: null, y: null });
  const enabled = prefs?.fx !== false && !(typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  const add = useCallback((item) => setItems((list) => (list.length >= MAX_ON_SCREEN ? list : [...list, { id: nextId++, ...item }])), []);
  const remove = useCallback((id) => setItems((list) => list.filter((i) => i.id !== id)), []);

  useEffect(() => {
    if (!enabled) return undefined;
    const onDown = (e) => { last.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener("pointerdown", onDown, { passive: true });
    const off = fx.on((e) => {
      if (document.hidden) return;
      if (e.type === "robot") add({ kind: "robot", flight: robotFlight() });
      else if (e.type === "land") add({ kind: "plane", quick: true });
      else if (e.type === "boom") {
        const x = e.x ?? last.current.x ?? window.innerWidth / 2;
        const y = e.y ?? last.current.y ?? window.innerHeight / 3;
        add({ kind: "boom", x, y, big: Boolean(e.big) });
        document.body.classList.add("fx-shake");
        window.setTimeout(() => document.body.classList.remove("fx-shake"), 420);
      }
    });
    return () => { window.removeEventListener("pointerdown", onDown); off(); };
  }, [enabled, add]);

  // Ambient traffic: a first robot shortly after the page opens, then random robots and planes.
  useEffect(() => {
    if (!enabled) return undefined;
    const timers = [];
    const loop = (kind) => {
      const t = window.setTimeout(() => {
        if (!document.hidden) { if (kind === "plane") add({ kind: "plane" }); else add({ kind: "robot", flight: robotFlight() }); }
        loop(kind);
      }, nextDelay(kind));
      timers.push(t);
    };
    timers.push(window.setTimeout(() => add({ kind: "robot", flight: robotFlight() }), 2500));
    loop("robot"); loop("plane");
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [enabled, add]);

  if (!enabled) return null;
  return (
    <div className="skyfx" aria-hidden="true">
      {items.map((it) => {
        if (it.kind === "robot") {
          const f = it.flight;
          return (
            <div key={it.id} className={"fxfly" + (f.fromLeft ? "" : " is-rtl")} style={{ top: f.top + "vh", animationDuration: f.seconds + "s" }} onAnimationEnd={() => remove(it.id)}>
              <div className="fxfly__bob" style={{ "--bob": f.bob + "px" }}><FlyBot size={f.size} hue={f.hue} /></div>
            </div>
          );
        }
        if (it.kind === "plane") {
          return (
            <React.Fragment key={it.id}>
              <div className={"fxrunway" + (it.quick ? " is-quick" : "")}><span /></div>
              <div className={"fxland" + (it.quick ? " is-quick" : "")} onAnimationEnd={() => remove(it.id)}><Plane gear /></div>
              <div className={"fxdust" + (it.quick ? " is-quick" : "")}><i /><i /><i /></div>
            </React.Fragment>
          );
        }
        return <div key={it.id} onAnimationEnd={undefined}><BoomAuto it={it} remove={remove} /></div>;
      })}
    </div>
  );
}

/* Removes an explosion once its animation time is over. */
function BoomAuto({ it, remove }) {
  useEffect(() => { const t = window.setTimeout(() => remove(it.id), 1800); return () => window.clearTimeout(t); }, [it.id, remove]);
  return <Boom x={it.x} y={it.y} big={it.big} />;
}
