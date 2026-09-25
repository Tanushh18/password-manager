import React, { useEffect, useState } from "react";
import { ShieldLine, KeyLine, Close, Check, Alert, Repeat, Clock } from "../Icons/Icons";
import "./VaultHealth.css";

const R = 54;
const LEN = 2 * Math.PI * R;

const verdict = (score) =>
  score >= 85 ? "Excellent" : score >= 70 ? "Healthy" : score >= 45 ? "Needs care" : "At risk";

const toneFor = (score) => (score >= 70 ? "ok" : score >= 45 ? "warn" : "danger");

/** Counts up to the target so the score feels alive when it changes. */
function useCountUp(target, ms = 900) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let frame;
    const from = value;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ms]);
  return value;
}

/**
 * Live vault-health panel: overall score ring plus weak / reused / old counts.
 * Each count doubles as a filter for the grid below.
 */
export default function VaultHealth({ insights, loading, filter, onFilter, onBreachCheck, breachProgress, breachChecked }) {
  const score = insights?.score ?? 0;
  const shown = useCountUp(loading && !insights ? 0 : score);
  const tone = toneFor(score);

  const tiles = [
    { key: "all", label: "Total", value: insights?.total ?? 0, icon: <KeyLine size={16} />, tone: "accent" },
    { key: "strong", label: "Strong", value: insights?.strong ?? 0, icon: <Check size={16} />, tone: "ok" },
    { key: "weak", label: "Weak", value: insights?.weak ?? 0, icon: <Close size={16} />, tone: "danger" },
    { key: "reused", label: "Reused", value: insights?.reused ?? 0, icon: <Repeat size={16} />, tone: "warn" },
    { key: "breached", label: "Breached", value: breachChecked ? insights?.breached ?? 0 : "–", icon: <Alert size={16} />, tone: "danger" },
    { key: "old", label: "Older than 6 mo", value: insights?.old ?? 0, icon: <Clock size={16} />, tone: "cool" },
  ];

  const tip = !insights
    ? "Scanning your vault…"
    : insights.total === 0
    ? "Add a password to see how healthy your vault is."
    : insights.breached > 0
    ? `${insights.breached} password${insights.breached === 1 ? " appears" : "s appear"} in known data breaches — change ${insights.breached === 1 ? "it" : "them"} first.`
    : insights.reused > 0
    ? `${insights.reused} password${insights.reused === 1 ? " is" : "s are"} used more than once — give each account its own.`
    : insights.weak > 0
    ? `${insights.weak} weak password${insights.weak === 1 ? "" : "s"} could be guessed. Tap "Weak" to fix them.`
    : "Every password is strong and unique. Beautiful.";

  return (
    <section className={`health card health--${tone}`} aria-label="Vault health">
      <span className="card__ribbon" />

      <div className="health__ring" style={{ "--ring-len": LEN }}>
        <svg viewBox="0 0 128 128" aria-hidden="true">
          <defs>
            <linearGradient id="health-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--accent-3)" />
              <stop offset="50%" stopColor="var(--accent)" />
              <stop offset="100%" stopColor="var(--accent-2)" />
            </linearGradient>
          </defs>
          <circle className="health__track" cx="64" cy="64" r={R} />
          <circle
            className="health__arc"
            cx="64"
            cy="64"
            r={R}
            strokeDasharray={LEN}
            strokeDashoffset={LEN - (LEN * shown) / 100}
          />
        </svg>
        <div className="health__score">
          <strong>{loading && !insights ? "…" : shown}</strong>
          <span>{insights ? verdict(score) : "scanning"}</span>
        </div>
      </div>

      <div className="health__body">
        <span className="eyebrow">Vault health · live</span>
        <p className="health__tip">{tip}</p>
        {onBreachCheck ? (
          <div className="health__actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={onBreachCheck} disabled={Boolean(breachProgress)}>
              {breachProgress ? <span className="spinner spinner--accent" /> : <ShieldLine size={14} />}
              {breachProgress ? `Checking ${breachProgress.done}/${breachProgress.total}…` : breachChecked ? "Re-run breach check" : "Check for breaches"}
            </button>
            <span className="health__note">Uses Have I Been Pwned with k-anonymity — your passwords never leave this device.</span>
          </div>
        ) : null}

        <div className="health__tiles" role="tablist" aria-label="Filter passwords">
          {tiles.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={filter === t.key}
              className={`tile tile--${t.tone} ${filter === t.key ? "is-active" : ""}`}
              onClick={() => onFilter(filter === t.key ? "all" : t.key)}
            >
              <span className="tile__icon">{t.icon}</span>
              <span className="tile__value">{t.value}</span>
              <span className="tile__label">{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
