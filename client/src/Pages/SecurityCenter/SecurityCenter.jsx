import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { useVault } from "../../state/vault";
import { fx } from "../../lib/fx";
import SessionsPanel from "../../Components/Sessions/SessionsPanel";
import { checkpointRows, overallStatus, scoreBand, lastCheckedText, BREACH_AT_KEY } from "../../lib/securityAudit";
import "./SecurityCenter.css";

let checkedThisSession = false; // breach results live in memory only, so remember within this tab

const readLast = () => {
  try { return Number(localStorage.getItem(BREACH_AT_KEY) || 0); } catch { return 0; }
};

function Gauge({ score, tone, empty }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const pct = empty ? 0 : Math.max(0, Math.min(100, score));
  return (
    <div className={`sc-gauge sc-tone-${tone}`} role="img" aria-label={empty ? "No security score yet" : `Security score ${score} out of 100`}>
      <svg viewBox="0 0 128 128" aria-hidden="true">
        <defs>
          <linearGradient id="scGaugeGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--emerald)" />
            <stop offset="1" stopColor="var(--river)" />
          </linearGradient>
        </defs>
        <circle cx="64" cy="64" r="60" className="sc-gauge-ticks" />
        <circle cx="64" cy="64" r={r} className="sc-gauge-track" />
        <circle cx="64" cy="64" r={r} className="sc-gauge-fill" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} />
      </svg>
      <div className="sc-gauge-num">
        <strong>{empty ? "--" : score}</strong>
        <span>score</span>
      </div>
    </div>
  );
}

const ICONS = {
  weak: <path d="M12 3a5 5 0 0 0-5 5v3H6v10h12V11h-1V8a5 5 0 0 0-5-5Zm-3 8V8a3 3 0 0 1 6 0v3Z" />,
  reused: <path d="M7 7h10l-3-3M17 17H7l3 3M4 12a5 5 0 0 1 3-5M20 12a5 5 0 0 1-3 5" fill="none" strokeWidth="2" strokeLinecap="round" />,
  old: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm1 4v5l4 2-1 2-5-3V7Z" />,
  breached: <path d="M12 2 4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5Zm-1 5h2v6h-2Zm0 8h2v2h-2Z" />,
  twofactor: <path d="M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm0 3v13h10V5Zm4 14h2v1h-2Z" />,
};

function Row({ row, index }) {
  const [open, setOpen] = useState(false);
  const list = row.affected;
  return (
    <li className={`sc-row sc-tone-${row.tone}`} style={{ "--i": index }}>
      <span className="sc-lane" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
      <span className="sc-icon" aria-hidden="true"><svg viewBox="0 0 24 24">{ICONS[row.key]}</svg></span>
      <div className="sc-row-main">
        <div className="sc-row-head">
          <h3>{row.title}</h3>
          <span className="sc-pill"><span className="sc-dot" aria-hidden="true" />{row.status}</span>
        </div>
        <p>{row.text}</p>
        {list.length > 0 && (
          <>
            <button type="button" className="sc-link-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              {open ? "Hide" : "Show"} affected items ({list.length})
            </button>
            {open && (
              <ul className="sc-affected">
                {list.map((it) => (
                  <li key={it.id}><Link to={`/passwords?q=${encodeURIComponent(it.name)}`}>{it.name}</Link></li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <div className="sc-row-action">
        {row.key === "twofactor" ? (
          <Link className="sc-btn sc-btn-ghost" to="/settings">{row.status === "On" ? "Manage" : "Turn on"}</Link>
        ) : row.affected.length > 0 ? (
          <Link className="sc-btn sc-btn-ghost" to="/passwords">Review</Link>
        ) : null}
      </div>
    </li>
  );
}

export default function SecurityCenter() {
  const { items = [], health = {}, breaches = {}, breachProgress, runBreachCheck, prefs = {}, setPrefs, profile } = useVault();
  const [checked, setChecked] = useState(checkedThisSession || Object.keys(breaches || {}).length > 0);
  const [lastAt, setLastAt] = useState(readLast);
  const [error, setError] = useState("");

  const rows = useMemo(() => checkpointRows(items, health, profile || {}, { breachChecked: checked }), [items, health, profile, checked]);
  const status = overallStatus(rows);
  const total = health.total || 0;
  const band = scoreBand(health.score, total);
  const running = Boolean(breachProgress);
  const pct = running && breachProgress.total ? Math.round((breachProgress.done / breachProgress.total) * 100) : 0;

  const check = async () => {
    setError("");
    try {
      const found = await runBreachCheck();
      checkedThisSession = true;
      setChecked(true);
      const now = Date.now();
      try { localStorage.setItem(BREACH_AT_KEY, String(now)); } catch { /* private mode */ }
      setLastAt(now);
      if (found) { fx.emit("boom", { big: true }); toast.error(`${found} password${found === 1 ? " was" : "s were"} found in data breaches.`); }
      else { fx.emit("land"); toast.success("No passwords found in known breaches."); }
    } catch {
      setError("The breach check couldn't reach the breach database. Check your connection and try again.");
    }
  };

  return (
    <main className="sc-page">
      <section className="sc-hero" aria-labelledby="sc-title">
        <div className="sc-scan" aria-hidden="true" />
        <div className="sc-hero-text">
          <p className="sc-eyebrow">Security</p>
          <h1 id="sc-title">Security center</h1>
          <p className={`sc-status sc-tone-${status.tone}`} role="status">
            <span className="sc-dot" aria-hidden="true" />{status.text}
          </p>
          <p className="sc-sub">
            {total ? `${total} password${total === 1 ? "" : "s"} scanned · ${health.strong || 0} strong · rated ${band.label.toLowerCase()}` : "Nothing to scan yet."}
          </p>
          <div className="sc-controls">
            <button type="button" className="sc-btn sc-btn-primary" onClick={check} disabled={running || !total}>
              {running ? `Checking ${breachProgress.done}/${breachProgress.total}` : "Run breach check"}
            </button>
            <label className="sc-toggle">
              <input type="checkbox" checked={Boolean(prefs.autoBreach)} onChange={(e) => setPrefs({ autoBreach: e.target.checked })} />
              <span className="sc-switch" aria-hidden="true" />
              Weekly check
            </label>
          </div>
          {running && (
            <div className="sc-progress" role="progressbar" aria-label="Breach check progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <span style={{ width: `${pct}%` }} />
            </div>
          )}
          <p className="sc-meta">{lastCheckedText(lastAt)}. Only the first 5 characters of each password&apos;s SHA-1 hash are sent to Have I Been Pwned.</p>
          {error && <p className="sc-error" role="alert">{error}</p>}
        </div>
        <Gauge score={health.score} tone={band.tone === "danger" && !(checked && health.breached) ? "warn" : band.tone}empty={!total} />
      </section>

      {!total && (
        <section className="sc-empty">
          <h2>No passwords to screen yet</h2>
          <p>Save or import your logins and this checkpoint will flag weak, reused, old and breached passwords.</p>
          <Link className="sc-btn sc-btn-primary" to="/passwords">Go to passwords</Link>
        </section>
      )}

      <section className="sc-board" aria-labelledby="sc-board-title">
        <div className="sc-board-head">
          <h2 id="sc-board-title">Checkpoints</h2>
          <span>Status</span>
        </div>
        <ol className="sc-rows">
          {rows.map((r, i) => <Row key={r.key} row={r} index={i} />)}
        </ol>
      </section>

      <section className="sc-board sc-sessions" aria-labelledby="sc-sess-title">
        <div className="sc-board-head">
          <h2 id="sc-sess-title">Sessions &amp; activity</h2>
          <span>{profile && Number.isFinite(profile.sessions) ? `${profile.sessions} active` : ""}</span>
        </div>
        <p className="sc-note">Sign out any device you don&apos;t recognise.</p>
        <SessionsPanel />
      </section>

      <section className="sc-board sc-account">
        <div>
          <h2>Account settings</h2>
          <p className="sc-note">Change your sign-in password, two-factor and recovery codes. Items are encrypted on the server with AES-256-GCM; your sign-in password is stored as a bcrypt hash.</p>
        </div>
        <Link className="sc-btn sc-btn-ghost" to="/settings">Open settings</Link>
      </section>
    </main>
  );
}
