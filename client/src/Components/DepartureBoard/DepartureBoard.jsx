import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import "./DepartureBoard.css";

const GLYPHS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/·";
const still = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* One split-flap tile: it flips through glyphs until it lands on `ch`, like an airport board. */
function Flap({ ch, delay }) {
  const target = String(ch || " ").toUpperCase();
  const [shown, setShown] = useState(() => (still() ? target : " "));
  const [flip, setFlip] = useState(0);

  useEffect(() => {
    if (still()) { setShown(target); return undefined; }
    let i = 0;
    const steps = 6 + Math.floor(Math.random() * 8);
    let timer = window.setTimeout(function tick() {
      i += 1;
      const done = i >= steps;
      setShown(done ? target : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]);
      setFlip((f) => f + 1);
      if (!done) timer = window.setTimeout(tick, 55);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [target, delay]);

  return <span className="dbf" key={flip}><span className="dbf__ch">{shown === " " ? " " : shown}</span></span>;
}

function FlapText({ text, width, start }) {
  const chars = String(text).toUpperCase().padEnd(width).slice(0, width).split("");
  return <span className="dbt" aria-hidden="true">{chars.map((c, i) => <Flap key={i} ch={c} delay={start + i * 28} />)}</span>;
}

/**
 * Airport departures board built from real vault and project state.
 * rows: [{ code, dest, status, tone: ok|warn|danger|idle, to }]
 */
export default function DepartureBoard({ rows, title = "Departures" }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 30000); return () => window.clearInterval(t); }, []);
  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <section className="dboard" aria-label={`${title} board`}>
      <header className="dboard__top">
        <span className="dboard__title"><span className="dboard__plane" aria-hidden="true">✈</span> {title}</span>
        <span className="dboard__clock" aria-label={`Time ${time}`}>{time}</span>
      </header>
      <div className="dboard__cols" aria-hidden="true"><span>Flight</span><span>Destination</span><span>Status</span></div>
      <ul className="dboard__rows">
        {rows.map((r, i) => (
          <li key={r.code}>
            <Link to={r.to} className={`dboard__row is-${r.tone || "idle"}`} aria-label={`${r.dest}: ${r.status}`}>
              <FlapText text={r.code} width={6} start={i * 140} />
              <FlapText text={r.dest} width={14} start={i * 140 + 120} />
              <span className="dboard__status"><i aria-hidden="true" /><FlapText text={r.status} width={12} start={i * 140 + 260} /></span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
