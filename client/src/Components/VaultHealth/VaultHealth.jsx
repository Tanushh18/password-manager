import React, { useEffect, useState } from "react";
import { ShieldLine, Check, Close, Alert, Repeat, Clock } from "../Icons/Icons";
import { IcKey } from "../Vault/VaultIcons";
import "./VaultHealth.css";

const verdict = (score) =>
  score >= 85 ? "Excellent" : score >= 70 ? "Healthy" : score >= 45 ? "Needs care" : "At risk";

const toneFor = (score) => (score >= 70 ? "ok" : score >= 45 ? "warn" : "danger");

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Counts up to the target so the score feels alive when it changes (instant with reduced motion). */
function useCountUp(target, ms = 700) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (reducedMotion()) { setValue(target); return undefined; }
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
 * Vault overview: Total / Strong / Weak / Reused cards, the Security Score
 * card, and the breach + age filters. Every count is also a filter.
 */
export default function VaultHealth({ insights, loading, filter, onFilter, onBreachCheck, breachProgress, breachChecked }) {
  const score = insights?.score ?? 0;
  const shown = useCountUp(loading && !insights ? 0 : score);
  const tone = toneFor(score);
  const total = insights?.total ?? 0;
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);

  const cards = [
    { key: "all", label: "Total Passwords", value: total, icon: <IcKey size={17} />, tone: "accent", foot: "logins with a password" },
    { key: "strong", label: "Strong", value: insights?.strong ?? 0, icon: <Check size={16} />, tone: "ok", foot: `${pct(insights?.strong ?? 0)}% of passwords` },
    { key: "weak", label: "Weak", value: insights?.weak ?? 0, icon: <Close size={16} />, tone: "danger", foot: insights?.weak ? "easy to guess" : "none found" },
    { key: "reused", label: "Reused", value: insights?.reused ?? 0, icon: <Repeat size={16} />, tone: "warn", foot: insights?.reused ? "shared between accounts" : "all unique" },
  ];

  const tip = !insights
    ? "Scanning your vault…"
    : total === 0
    ? "Add a password to see how healthy your vault is."
    : insights.breached > 0
    ? `${insights.breached} password${insights.breached === 1 ? " appears" : "s appear"} in known data breaches — change ${insights.breached === 1 ? "it" : "them"} first.`
    : insights.reused > 0
    ? `${insights.reused} password${insights.reused === 1 ? " is" : "s are"} used more than once — give each account its own.`
    : insights.weak > 0
    ? `${insights.weak} weak password${insights.weak === 1 ? "" : "s"} could be guessed. Select "Weak" to fix them.`
    : "Every password is strong and unique.";

  const toggle = (key) => onFilter(filter === key || key === "all" ? "all" : key);

  return (
    <section className="ov" aria-label="Vault overview">
      <div className="ov__grid">
        {cards.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={filter === c.key}
            className={`ov-card ov-card--${c.tone} ${filter === c.key ? "is-active" : ""}`}
            onClick={() => toggle(c.key)}
            title={c.key === "all" ? "Show all" : `Show only ${c.label.toLowerCase()} passwords`}
          >
            <span className="ov-card__top">
              <span className="ov-card__label">{c.label}</span>
              <span className="ov-card__icon">{c.icon}</span>
            </span>
            <span className="ov-card__value">{c.value}</span>
            <span className="ov-card__foot">{c.foot}</span>
          </button>
        ))}

        <div className={`ov-score ov-score--${tone}`} role="group" aria-label="Security score">
          <span className="ov-score__falls" aria-hidden="true" />
          <span className="ov-card__top">
            <span className="ov-card__label">Security Score</span>
            <span className="ov-score__flag">{insights ? verdict(score) : "Scanning"}</span>
          </span>
          <span className="ov-score__value">
            <strong>{loading && !insights ? "…" : shown}</strong><small>/100</small>
          </span>
          <span className="ov-score__bar" aria-hidden="true"><i style={{ width: `${shown}%` }} /></span>
        </div>
      </div>

      <div className="ov__strip">
        <p className="ov__tip">{tip}</p>
        <div className="ov__chips" role="group" aria-label="More filters">
          <button type="button" aria-pressed={filter === "breached"} className={`ov-chip ov-chip--danger ${filter === "breached" ? "is-active" : ""}`} onClick={() => toggle("breached")}>
            <Alert size={13} /> Breached <b>{breachChecked ? insights?.breached ?? 0 : "–"}</b>
          </button>
          <button type="button" aria-pressed={filter === "old"} className={`ov-chip ov-chip--cool ${filter === "old" ? "is-active" : ""}`} onClick={() => toggle("old")}>
            <Clock size={13} /> Older than 6 mo <b>{insights?.old ?? 0}</b>
          </button>
          {onBreachCheck ? (
            <button type="button" className="ov-chip ov-chip--action" onClick={onBreachCheck} disabled={Boolean(breachProgress)} title="Checks Have I Been Pwned using k-anonymity: only the first 5 characters of each password's SHA-1 hash are sent.">
              {breachProgress ? <span className="spinner spinner--accent" /> : <ShieldLine size={13} />}
              {breachProgress ? `Checking ${breachProgress.done}/${breachProgress.total}…` : breachChecked ? "Re-run breach check" : "Check for breaches"}
            </button>
          ) : null}
        </div>
      </div>
      {onBreachCheck ? <p className="ov__note">The breach check sends only the first 5 characters of each password's SHA-1 hash (k-anonymity).</p> : null}
    </section>
  );
}
