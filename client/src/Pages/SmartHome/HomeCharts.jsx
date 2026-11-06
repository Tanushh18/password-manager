import React, { useMemo, useState } from "react";
import { fmtMinutes, niceMax } from "../../lib/smartHome";

/*
 * Two small charts for the Smart home page, drawn as plain SVG: TV time per day (one series, bars) and the internet
 * speed history (download and upload, one axis in Mbit/s; ping is a different measure, so it is in the tooltip and
 * the table, never on a second axis). Colours come from CSS tokens, so dark mode has its own steps.
 */

const W = 640, H = 200, PAD = { l: 52, r: 56, t: 12, b: 26 };
const innerW = W - PAD.l - PAD.r, innerH = H - PAD.t - PAD.b;

function Grid({ max, unit }) {
  const ticks = [0, max / 2, max];
  return ticks.map((t) => {
    const y = PAD.t + innerH - (t / max) * innerH;
    return (
      <g key={t}>
        <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} className="shc-grid" />
        <text x={PAD.l - 6} y={y + 4} textAnchor="end" className="shc-axis">{Math.round(t)}{unit}</text>
      </g>
    );
  });
}

const dayLabel = (date) => new Date(date + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** TV minutes per day, with the daily limit as a dashed line. */
export function TvTimeChart({ days, limit }) {
  const [hover, setHover] = useState(null);
  const max = niceMax(Math.max(limit || 0, ...days.map((d) => d.minutes)) || 60);
  const slot = innerW / Math.max(days.length, 1);
  const bw = Math.max(4, Math.min(28, slot - 2));
  const y = (m) => PAD.t + innerH - (m / max) * innerH;
  const h = hover !== null ? days[hover] : null;
  return (
    <figure className="shc">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`TV time per day for the last ${days.length} days`} onMouseLeave={() => setHover(null)}>
        <Grid max={max} unit=" min" />
        {days.map((d, i) => {
          const x = PAD.l + i * slot + (slot - bw) / 2;
          const top = y(d.minutes), hgt = PAD.t + innerH - top;
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}>
              <rect x={PAD.l + i * slot} y={PAD.t} width={slot} height={innerH} fill="transparent" />
              {d.minutes > 0 ? <path className={"shc-bar" + (limit && d.minutes > limit ? " is-over" : "")} d={`M${x},${PAD.t + innerH} v${-Math.max(hgt - 4, 0)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${Math.max(hgt - 4, 0)} z`} opacity={hover === null || hover === i ? 1 : 0.55} /> : null}
              {i % Math.ceil(days.length / 7) === 0 || i === days.length - 1 ? <text x={x + bw / 2} y={H - 8} textAnchor="middle" className="shc-axis">{dayLabel(d.date)}</text> : null}
            </g>
          );
        })}
        {limit ? <><line x1={PAD.l} x2={W - PAD.r} y1={y(limit)} y2={y(limit)} className="shc-limit" /><text x={W - PAD.r + 4} y={y(limit) + 4} className="shc-axis">limit</text></> : null}
      </svg>
      {h ? <div className="shc-tip" role="status"><b>{dayLabel(h.date)}</b> · {fmtMinutes(h.minutes)}{Object.keys(h.apps || {}).length ? " · " + Object.entries(h.apps).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, m]) => `${n} ${fmtMinutes(m)}`).join(", ") : ""}</div> : <div className="shc-tip shc-tip--idle">Point at a day for its apps</div>}
      <details className="shc-table"><summary>Show as a table</summary>
        <table><thead><tr><th>Day</th><th>TV time</th><th>Apps</th></tr></thead>
          <tbody>{days.slice().reverse().map((d) => <tr key={d.date}><td>{dayLabel(d.date)}</td><td>{fmtMinutes(d.minutes)}</td><td>{Object.entries(d.apps || {}).map(([n, m]) => `${n} ${fmtMinutes(m)}`).join(", ") || "—"}</td></tr>)}</tbody></table>
      </details>
    </figure>
  );
}

/** Download and upload over time, with a crosshair tooltip. */
export function SpeedChart({ samples }) {
  const [hover, setHover] = useState(null);
  const pts = useMemo(() => samples.map((s) => ({ ...s, t: new Date(s.at).getTime() })), [samples]);
  if (pts.length < 2) return <p className="sh-dim">{pts.length ? `Last test: ${pts[0].down} Mbit/s down, ${pts[0].up} up, ${pts[0].ping} ms.` : "No speed tests yet. The tablet runs one every hour."}</p>;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const max = niceMax(Math.max(...pts.map((p) => Math.max(p.down, p.up))));
  const x = (t) => PAD.l + ((t - t0) / Math.max(t1 - t0, 1)) * innerW;
  const y = (v) => PAD.t + innerH - (v / max) * innerH;
  const path = (k) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p[k]).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    pts.forEach((p, i) => { if (Math.abs(x(p.t) - px) < Math.abs(x(pts[best].t) - px)) best = i; });
    setHover(best);
  };
  const h = hover !== null ? pts[hover] : null;
  const when = (t) => new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <figure className="shc">
      <div className="shc-legend"><span><i className="shc-key is-down" />Download</span><span><i className="shc-key is-up" />Upload</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Internet download and upload speed over time" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <Grid max={max} unit="" />
        <text x={PAD.l} y={H - 8} className="shc-axis">{when(t0)}</text>
        <text x={W - PAD.r} y={H - 8} textAnchor="end" className="shc-axis">{when(t1)}</text>
        <path d={path("down")} className="shc-line is-down" />
        <path d={path("up")} className="shc-line is-up" />
        <text x={x(last.t) + 6} y={y(last.down) + 4} className="shc-label">{last.down}</text>
        <text x={x(last.t) + 6} y={y(last.up) + 4} className="shc-label">{last.up}</text>
        {h ? <g><line x1={x(h.t)} x2={x(h.t)} y1={PAD.t} y2={PAD.t + innerH} className="shc-cross" />
          <circle cx={x(h.t)} cy={y(h.down)} r={4} className="shc-dot is-down" /><circle cx={x(h.t)} cy={y(h.up)} r={4} className="shc-dot is-up" /></g> : null}
      </svg>
      {h ? <div className="shc-tip" role="status"><b>{when(h.t)}</b> · {h.down} Mbit/s down · {h.up} up · {h.ping} ms ping</div> : <div className="shc-tip shc-tip--idle">Mbit/s · point at the chart for a test</div>}
      <details className="shc-table"><summary>Show as a table</summary>
        <table><thead><tr><th>When</th><th>Down</th><th>Up</th><th>Ping</th></tr></thead>
          <tbody>{pts.slice().reverse().slice(0, 100).map((p) => <tr key={p.t}><td>{when(p.t)}</td><td>{p.down}</td><td>{p.up}</td><td>{p.ping} ms</td></tr>)}</tbody></table>
      </details>
    </figure>
  );
}


/** Minutes the way home took, by day (one series, bars), with the usual time as a dashed line. */
export function CommuteChart({ series, usual }) {
  const [hover, setHover] = useState(null);
  if (!series || !series.length) return null;
  const max = niceMax(Math.max(usual || 0, ...series.map((d) => d.minutes)) || 30);
  const slot = innerW / series.length;
  const bw = Math.max(6, Math.min(30, slot - 4));
  const y = (m) => PAD.t + innerH - (m / max) * innerH;
  const h = hover !== null ? series[hover] : null;
  return (
    <figure className="shc">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Minutes the way home took, last ${series.length} days`} onMouseLeave={() => setHover(null)}>
        <Grid max={max} unit=" min" />
        {series.map((d, i) => {
          const x = PAD.l + i * slot + (slot - bw) / 2, top = y(d.minutes), hgt = PAD.t + innerH - top;
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}>
              <rect x={PAD.l + i * slot} y={PAD.t} width={slot} height={innerH} fill="transparent" />
              <path className="shc-bar" d={`M${x},${PAD.t + innerH} v${-Math.max(hgt - 4, 0)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${Math.max(hgt - 4, 0)} z`} opacity={hover === null || hover === i ? 1 : 0.55} />
              <text x={x + bw / 2} y={H - 8} textAnchor="middle" className="shc-axis">{dayLabel(d.date)}</text>
            </g>
          );
        })}
        {usual ? <><line x1={PAD.l} x2={W - PAD.r} y1={y(usual)} y2={y(usual)} className="shc-limit" /><text x={W - PAD.r + 4} y={y(usual) + 4} className="shc-axis">usual</text></> : null}
      </svg>
      {h ? <div className="shc-tip" role="status"><b>{dayLabel(h.date)}</b> · {h.minutes} min</div> : <div className="shc-tip shc-tip--idle">Point at a day</div>}
      <details className="shc-table"><summary>Show as a table</summary>
        <table><thead><tr><th>Day</th><th>Minutes</th></tr></thead><tbody>{series.slice().reverse().map((d) => <tr key={d.date}><td>{dayLabel(d.date)}</td><td>{d.minutes}</td></tr>)}</tbody></table>
      </details>
    </figure>
  );
}

/** Distance of the phone from a place over the last 24 hours, with the circle and the "counts as left" line. Points are coloured by state. */
export function PlaceTrailChart({ points, radius, outBeyondM, now = Date.now() }) {
  const [hover, setHover] = useState(null);
  const real = points.filter((p) => !p.same);
  if (real.length < 2) return <p className="sh-dim">{real.length ? "Only one position so far today." : "No positions in the last 24 hours yet."}</p>;
  const t1 = now, t0 = now - 24 * 3600000;
  const max = niceMax(Math.max(outBeyondM * 1.3, ...real.map((p) => p.distanceM)));
  const x = (t) => PAD.l + ((Math.max(t, t0) - t0) / (t1 - t0)) * innerW;
  const y = (m) => PAD.t + innerH - (Math.min(m, max) / max) * innerH;
  const colour = { in: "var(--shc-ok, #1d7f4e)", between: "var(--shc-warn, #d4880b)", out: "var(--shc-bad, #d1343a)" };
  const h = hover !== null ? real[hover] : null;
  const hours = [0, 6, 12, 18, 24].map((k) => t0 + k * 3600000);
  return (
    <figure className="shc">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Distance from the place over the last 24 hours" onMouseLeave={() => setHover(null)}>
        <Grid max={max} unit=" m" />
        <line x1={PAD.l} x2={W - PAD.r} y1={y(radius)} y2={y(radius)} className="shc-limit" />
        <text x={W - PAD.r + 4} y={y(radius) + 4} className="shc-axis">circle</text>
        <line x1={PAD.l} x2={W - PAD.r} y1={y(outBeyondM)} y2={y(outBeyondM)} className="shc-limit" strokeDasharray="2 4" />
        <text x={W - PAD.r + 4} y={y(outBeyondM) + 4} className="shc-axis">left</text>
        <polyline points={real.map((p) => `${x(p.at)},${y(p.distanceM)}`).join(" ")} fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" />
        {real.map((p, i) => (
          <circle key={p.at} cx={x(p.at)} cy={y(p.distanceM)} r={hover === i ? 5 : 3} fill={colour[p.state]} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} />
        ))}
        {hours.map((t) => <text key={t} x={x(t)} y={H - 6} textAnchor="middle" className="shc-axis">{new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</text>)}
      </svg>
      <figcaption className="sh-dim">
        {h ? `${new Date(h.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${h.distanceM} m from the centre · ${h.beyondM > 0 ? `${h.beyondM} m outside the circle` : `${-h.beyondM} m inside`} · ±${h.acc} m`
          : "Each dot is a position the phone sent. Green: inside the circle. Orange: outside the circle but not far enough to count as left. Red: counts as left."}
      </figcaption>
    </figure>
  );
}
