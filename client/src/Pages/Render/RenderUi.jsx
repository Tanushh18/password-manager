import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { formatNumber, formatDateTime, formatTime, peakOf, STATE_LABEL } from "./renderUtils";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

const modalStack = [];

/** Accessible modal: focus trap, Escape to close, scroll lock, focus restored on close. Only the topmost modal handles keys. */
export function Modal({ labelledBy, onClose, children, className = "", wide = false, dismissOnBackdrop = true }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const token = Symbol("modal");
    modalStack.push(token);
    const previous = document.activeElement;
    const node = ref.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = node?.querySelector("[data-autofocus]") || node?.querySelector(FOCUSABLE);
    (first || node)?.focus?.();
    const onKey = (event) => {
      if (modalStack[modalStack.length - 1] !== token) return;
      if (event.key === "Escape") { event.stopPropagation(); closeRef.current?.(); return; }
      if (event.key !== "Tab" || !node) return;
      const items = [...node.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) { event.preventDefault(); return; }
      const head = items[0], tail = items[items.length - 1];
      if (event.shiftKey && document.activeElement === head) { event.preventDefault(); tail.focus(); }
      else if (!event.shiftKey && document.activeElement === tail) { event.preventDefault(); head.focus(); }
      else if (!node.contains(document.activeElement)) { event.preventDefault(); head.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      modalStack.splice(modalStack.indexOf(token), 1);
      document.body.style.overflow = overflow;
      if (previous && document.contains(previous)) previous.focus?.();
    };
  }, []);

  return (
    <div className="rd-backdrop" onMouseDown={(e) => { if (dismissOnBackdrop && e.target === e.currentTarget) onClose?.(); }}>
      <section ref={ref} tabIndex={-1} className={"rd-dialog " + (wide ? "rd-dialog--wide " : "") + className} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        {children}
      </section>
    </div>
  );
}

/**
 * Promise-based confirm/prompt replacing window.confirm / window.prompt.
 * const [ask, dialog] = useConfirm(); ... if (!(await ask({ message }))) return; ... {dialog}
 */
export function useConfirm() {
  const [state, setState] = useState(null);
  const resolver = useRef(null);

  const ask = useCallback((options) => new Promise((resolve) => {
    resolver.current?.(null);
    resolver.current = resolve;
    setState(typeof options === "string" ? { message: options } : options);
  }), []);

  const settle = useCallback((value) => {
    const resolve = resolver.current;
    resolver.current = null;
    setState(null);
    resolve?.(value);
  }, []);

  useEffect(() => () => { resolver.current?.(null); resolver.current = null; }, []);

  const dialog = state ? <ConfirmDialog {...state} onSettle={settle} /> : null;
  return [ask, dialog];
}

function ConfirmDialog({ title = "Please confirm", message, confirmLabel = "Confirm", danger = false, input = null, onSettle }) {
  const id = useId();
  const [value, setValue] = useState(input?.defaultValue || "");
  const submit = (event) => {
    event.preventDefault();
    if (input) { if (input.match != null ? value !== input.match : !value.trim()) return; onSettle(input.match != null ? value : value.trim()); } else onSettle(true);
  };
  return (
    <Modal labelledBy={id} onClose={() => onSettle(null)} className="rd-dialog--sm">
      <form onSubmit={submit}>
        <h2 id={id} className="rd-dialog__title">{title}</h2>
        <p className="rd-dialog__body">{message}</p>
        {input && <input data-autofocus className="rd-field" value={value} onChange={(e) => setValue(e.target.value)} placeholder={input.placeholder} maxLength={input.maxLength || 60} autoComplete="off" spellCheck="false" aria-label={input.label || title} />}
        <div className="rd-dialog__actions">
          <button type="button" className="rd-btn rd-btn--quiet" onClick={() => onSettle(null)}>Cancel</button>
          <button type="submit" data-autofocus={input ? undefined : true} className={"rd-btn " + (danger ? "rd-btn--danger" : "rd-btn--primary")} disabled={Boolean(input) && (input.match != null ? value !== input.match : !value.trim())}>{confirmLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

export function StatePill({ state }) {
  return <span className={"rd-pill is-" + state}><i aria-hidden="true" />{STATE_LABEL[state] || state}</span>;
}

export function Skeleton({ lines = 3, height = 14 }) {
  return <div className="rd-skeleton" aria-hidden="true">{Array.from({ length: lines }, (_, i) => <span key={i} style={{ height, width: (100 - (i % 3) * 14) + "%" }} />)}</div>;
}

export function Empty({ icon = "▣", title, children, action }) {
  return <div className="rd-empty"><span aria-hidden="true">{icon}</span><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>;
}

export function Kpi({ label, value, hint, tone, onClick }) {
  const Tag = onClick ? "button" : "div";
  return <Tag type={onClick ? "button" : undefined} onClick={onClick} className={"rd-kpi" + (tone ? " is-" + tone : "") + (onClick ? " is-link" : "")}><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</Tag>;
}

export function Section({ title, subtitle, actions, children, className = "" }) {
  return <section className={"rd-card " + className}><header className="rd-card__head"><div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>{actions && <div className="rd-card__actions">{actions}</div>}</header>{children}</section>;
}

/** Stacked horizontal bar describing the fleet split. */
export function FleetBar({ counts }) {
  const total = counts.active + counts.incident + counts.suspended;
  if (!total) return <div className="rd-fleetbar is-empty" aria-hidden="true" />;
  const parts = [["active", counts.active], ["incident", counts.incident], ["suspended", counts.suspended]].filter(([, n]) => n);
  return (
    <div className="rd-fleetbar" role="img" aria-label={parts.map(([k, n]) => n + " " + STATE_LABEL[k].toLowerCase()).join(", ")}>
      {parts.map(([key, n]) => <span key={key} className={"is-" + key} style={{ flexGrow: n }} title={STATE_LABEL[key] + ": " + n} />)}
    </div>
  );
}

const SERIES_COLORS = ["#2bb3b1", "#6e9bff", "#e0a23b", "#c27be8", "#f0707a", "#4fc3d9", "#a9c24a", "#9d94ff"];

/** Multi-series SVG line chart with a hover crosshair and an accessible data summary. */
export function LineChart({ series, metric, height = 240 }) {
  const wrapRef = useRef(null);
  const [hover, setHover] = useState(null);
  const data = useMemo(() => (series || [])
    .map((item, index) => ({ ...item, color: SERIES_COLORS[index % SERIES_COLORS.length], points: (item.points || []).filter((p) => p.timestamp && Number.isFinite(Number(p.value))).map((p) => ({ ...p, t: new Date(p.timestamp).getTime(), v: Number(p.value) })).sort((a, b) => a.t - b.t) }))
    .filter((item) => item.points.length), [series]);

  if (!data.length) return <p className="rd-muted rd-chart-empty">No samples returned for this period. Render only exposes some metrics for certain service types and plans.</p>;

  const all = data.flatMap((s) => s.points);
  const minT = Math.min(...all.map((p) => p.t)), maxT = Math.max(...all.map((p) => p.t));
  const minV = Math.min(...all.map((p) => p.v)), maxV = Math.max(...all.map((p) => p.v));
  const pad = (maxV - minV) * 0.12 || Math.max(Math.abs(maxV) * 0.12, 1);
  const low = Math.max(0, minV - pad), high = maxV + pad;
  const W = 900, H = height, L = 56, R = 16, T = 14, B = 28, PW = W - L - R, PH = H - T - B;
  const x = (t) => L + (maxT === minT ? PW / 2 : (t - minT) / (maxT - minT) * PW);
  const y = (v) => T + (high - v) / (high - low || 1) * PH;
  const unit = all.find((p) => p.unit)?.unit || "";

  const onMove = (event) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return;
    const px = (event.clientX - rect.left) / rect.width * W;
    const t = minT + Math.min(1, Math.max(0, (px - L) / PW)) * (maxT - minT);
    const rows = data.map((s) => {
      const nearest = s.points.reduce((best, p) => (Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best), s.points[0]);
      return { name: s.name, color: s.color, point: nearest };
    });
    const anchor = rows.reduce((best, r) => (Math.abs(r.point.t - t) < Math.abs(best.point.t - t) ? r : best), rows[0]);
    setHover({ t: anchor.point.t, rows, leftPct: x(anchor.point.t) / W * 100 });
  };

  return (
    <div className="rd-chart">
      <div className="rd-chart__plot" ref={wrapRef} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${metric} over time, ${data.length} series. Peak ${formatNumber(maxV)} ${unit}`}>
          {[0, 1, 2, 3].map((i) => {
            const v = high - (high - low) * i / 3, yy = T + PH * i / 3;
            return <g key={i}><line x1={L} x2={W - R} y1={yy} y2={yy} className="rd-chart__grid" /><text x={L - 8} y={yy + 4} textAnchor="end" className="rd-chart__label">{formatNumber(v)}</text></g>;
          })}
          {data.map((s) => {
            const path = s.points.map((p, j) => `${j ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
            const peak = peakOf(s.points);
            return <g key={s.key || s.name}><path d={path} fill="none" stroke={s.color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /><circle cx={x(peak.t)} cy={y(peak.v)} r="3.6" fill={s.color} /></g>;
          })}
          {hover && <line x1={x(hover.t)} x2={x(hover.t)} y1={T} y2={T + PH} className="rd-chart__cursor" />}
          {hover && hover.rows.map((r) => <circle key={r.name} cx={x(r.point.t)} cy={y(r.point.v)} r="4" fill={r.color} stroke="var(--surface)" strokeWidth="2" />)}
          <text x={L} y={H - 8} className="rd-chart__label">{formatTime(minT)}</text>
          <text x={W - R} y={H - 8} textAnchor="end" className="rd-chart__label">{formatTime(maxT)}</text>
        </svg>
        {hover && (
          <div className="rd-chart__tip" style={{ left: hover.leftPct > 62 ? "auto" : `calc(${hover.leftPct}% + 12px)`, right: hover.leftPct > 62 ? `calc(${100 - hover.leftPct}% + 12px)` : "auto" }}>
            <b>{formatDateTime(hover.t)}</b>
            {hover.rows.map((r) => <span key={r.name}><i style={{ background: r.color }} />{r.name}<em>{formatNumber(r.point.v)} {r.point.unit || unit}</em></span>)}
          </div>
        )}
      </div>
      <ul className="rd-legend">
        {data.map((s) => {
          const peak = peakOf(s.points), last = s.points[s.points.length - 1];
          return <li key={s.key || s.name}><i style={{ background: s.color }} /><span>{s.name}</span><small>Now {formatNumber(last.v)} · Peak {formatNumber(peak.v)} {peak.unit || unit} at {formatTime(peak.t)}</small></li>;
        })}
      </ul>
    </div>
  );
}
