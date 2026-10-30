import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { estimate, generatePassword, generatePassphrase } from "../../lib/strength";
import "./Generator.css";

const MIN = 8;
const MAX = 64;
const CLEAR_MS = 30000;
const TONES = ["danger", "danger", "warn", "ok", "ok"];
const SETS = [
  { key: "upper", label: "Uppercase", sample: "A–Z" },
  { key: "lower", label: "Lowercase", sample: "a–z" },
  { key: "digits", label: "Numbers", sample: "2–9" },
  { key: "symbols", label: "Symbols", sample: "!@#" },
];

function Switch({ id, label, sample, checked, onChange }) {
  return (
    <label className="gen-switch" htmlFor={id}>
      <span className="gen-switch__text">
        <span className="gen-switch__label">{label}</span>
        <span className="gen-switch__sample" aria-hidden="true">{sample}</span>
      </span>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="gen-switch__track" aria-hidden="true"><span className="gen-switch__thumb" /></span>
    </label>
  );
}

export default function Generator() {
  const uid = useId();
  const [mode, setMode] = useState("password");
  const [length, setLength] = useState(20);
  const [lengthDraft, setLengthDraft] = useState("20");
  const [sets, setSets] = useState({ upper: true, lower: true, digits: true, symbols: true });
  const [words, setWords] = useState(5);
  const [value, setValue] = useState("");
  const [history, setHistory] = useState([]);
  const [copied, setCopied] = useState(false);
  const clearTimer = useRef(null);
  const copiedTimer = useRef(null);

  const noneChosen = !Object.values(sets).some(Boolean);

  const make = useCallback(() => {
    const next = mode === "passphrase"
      ? generatePassphrase({ words })
      : generatePassword({ length, ...sets });
    setValue(next);
    setCopied(false);
    setHistory((h) => [next, ...h.filter((x) => x !== next)].slice(0, 5));
  }, [mode, words, length, sets]);

  // Regenerate whenever the recipe changes.
  useEffect(() => { make(); }, [make]);

  // Memory-only history and timers: dropped when the page is left.
  useEffect(() => () => { clearTimeout(clearTimer.current); clearTimeout(copiedTimer.current); }, []);

  const strength = useMemo(() => estimate(value), [value]);

  const copy = async (text = value) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      toast.error("Clipboard is not available. Select the text and copy it manually.");
      return;
    }
    setCopied(text === value);
    toast.success("Copied. The clipboard clears in 30 seconds.");
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2500);
    clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(async () => {
      try {
        if ((await navigator.clipboard.readText()) === text) await navigator.clipboard.writeText("");
      } catch { /* permission denied or unfocused: leave the clipboard alone */ }
    }, CLEAR_MS);
  };

  const commitLength = (raw) => {
    const n = Math.round(Number(raw));
    const clamped = Number.isFinite(n) ? Math.min(MAX, Math.max(MIN, n)) : length;
    setLength(clamped);
    setLengthDraft(String(clamped));
  };

  const fill = ((length - MIN) / (MAX - MIN)) * 100;

  return (
    <main className="gen">
      <header className="gen__head">
        <h1 className="gen__title">Password generator</h1>
        <p className="gen__lede">Create a random password or passphrase. It is generated in your browser with <code>crypto.getRandomValues</code> and nothing here is saved.</p>
      </header>

      <section className="gen-station" aria-label="Generator workstation">
        <div className="gen-controls">
          <div className="gen-tabs" role="radiogroup" aria-label="What to generate">
            {[["password", "Password"], ["passphrase", "Passphrase"]].map(([key, label]) => (
              <label key={key} className={`gen-tab ${mode === key ? "is-on" : ""}`}>
                <input type="radio" name={`${uid}-mode`} value={key} checked={mode === key} onChange={() => setMode(key)} />
                {label}
              </label>
            ))}
          </div>

          {mode === "password" ? (
            <>
              <div className="gen-field">
                <div className="gen-field__row">
                  <label className="gen-field__label" htmlFor={`${uid}-len`}>Length</label>
                  <input
                    className="gen-num"
                    type="number"
                    inputMode="numeric"
                    min={MIN}
                    max={MAX}
                    aria-label="Length in characters"
                    value={lengthDraft}
                    onChange={(e) => { setLengthDraft(e.target.value); const n = Number(e.target.value); if (n >= MIN && n <= MAX) setLength(Math.round(n)); }}
                    onBlur={(e) => commitLength(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") commitLength(e.currentTarget.value); }}
                  />
                </div>
                <input
                  id={`${uid}-len`}
                  className="gen-range"
                  type="range"
                  min={MIN}
                  max={MAX}
                  value={length}
                  style={{ "--fill": `${fill}%` }}
                  aria-valuetext={`${length} characters`}
                  onChange={(e) => { setLength(Number(e.target.value)); setLengthDraft(e.target.value); }}
                />
                <div className="gen-range__scale" aria-hidden="true"><span>{MIN}</span><span>{MAX}</span></div>
              </div>

              <fieldset className="gen-sets">
                <legend className="gen-field__label">Characters</legend>
                {SETS.map((s) => (
                  <Switch key={s.key} id={`${uid}-${s.key}`} label={s.label} sample={s.sample} checked={sets[s.key]}
                    onChange={(on) => setSets((prev) => ({ ...prev, [s.key]: on }))} />
                ))}
                {noneChosen && <p className="gen-hint" role="status">No sets chosen, so lowercase letters are used.</p>}
              </fieldset>
            </>
          ) : (
            <div className="gen-field">
              <div className="gen-field__row">
                <label className="gen-field__label" htmlFor={`${uid}-words`}>Words</label>
                <output className="gen-num gen-num--out" htmlFor={`${uid}-words`}>{words}</output>
              </div>
              <input id={`${uid}-words`} className="gen-range" type="range" min={3} max={10} value={words}
                style={{ "--fill": `${((words - 3) / 7) * 100}%` }} aria-valuetext={`${words} words`}
                onChange={(e) => setWords(Number(e.target.value))} />
              <div className="gen-range__scale" aria-hidden="true"><span>3</span><span>10</span></div>
              <p className="gen-hint">Words joined by hyphens, with one capital letter and one number mixed in.</p>
            </div>
          )}
        </div>

        <div className="gen-out">
          <p className="gen-field__label" id={`${uid}-out-label`}>{mode === "password" ? "Generated password" : "Generated passphrase"}</p>
          <output className="gen-out__value" aria-labelledby={`${uid}-out-label`} aria-live="polite" aria-atomic="true">{value}</output>

          <div className={`gen-meter gen-meter--${TONES[strength.score]}`}>
            <div className="gen-meter__bars" aria-hidden="true">
              {[1, 2, 3, 4].map((n) => <span key={n} className={strength.score >= n ? "on" : ""} />)}
            </div>
            <span className="gen-meter__label">Strength: {strength.label}{strength.bits ? ` · ~${strength.bits} bits` : ""}</span>
          </div>

          <div className="gen-actions">
            <button type="button" className="gen-btn gen-btn--primary" onClick={() => copy()}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" className="gen-btn" onClick={make}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg>
              Generate
            </button>
          </div>

          <div className="gen-save">
            <Link className="gen-save__link" to="/passwords">Save as new login →</Link>
            <p className="gen-hint">Copy it first, then open the vault and paste it into a new login.</p>
          </div>
        </div>
      </section>

      {history.length > 1 && (
        <section className="gen-history" aria-labelledby={`${uid}-hist`}>
          <h2 id={`${uid}-hist`} className="gen-history__title">Recent this visit <span>kept in memory only, cleared when you leave</span></h2>
          <ul>
            {history.slice(1).map((h, i) => (
              <li key={h}>
                <code>{h}</code>
                <button type="button" className="gen-btn gen-btn--sm" onClick={() => copy(h)} aria-label={`Copy earlier value ${i + 1}`}>Copy</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
