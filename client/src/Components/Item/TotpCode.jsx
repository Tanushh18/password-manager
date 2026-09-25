import React, { useEffect, useState } from "react";
import { totpCode, parseTotp } from "../../lib/crypto";
import { Copy, Check } from "../Icons/Icons";

const R = 9;
const LEN = 2 * Math.PI * R;

/** Live 2FA code with a countdown ring; click to copy. */
export default function TotpCode({ secret, onCopy, compact }) {
  const [state, setState] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const cfg = parseTotp(secret);
    if (!cfg) {
      setState({ invalid: true });
      return undefined;
    }
    let alive = true;
    const tick = async () => {
      const r = await totpCode(cfg);
      if (alive) setState(r);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [secret]);

  if (!state) return null;
  if (state.invalid) return <span className="totp totp--bad">Invalid 2FA secret</span>;

  const pretty = state.code.length === 6 ? `${state.code.slice(0, 3)} ${state.code.slice(3)}` : state.code;
  const urgent = state.remaining <= 5;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(state.code);
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 1400);
    } catch (e) {
      /* ignore */
    }
  };

  return (
    <button type="button" className={`totp ${urgent ? "is-urgent" : ""} ${compact ? "totp--compact" : ""}`} onClick={copy} title="Copy 2FA code">
      <svg viewBox="0 0 24 24" className="totp__ring" aria-hidden="true">
        <circle cx="12" cy="12" r={R} className="totp__track" />
        <circle
          cx="12"
          cy="12"
          r={R}
          className="totp__arc"
          strokeDasharray={LEN}
          strokeDashoffset={LEN - (LEN * state.remaining) / state.period}
        />
      </svg>
      <span className="totp__code">{pretty}</span>
      <span className="totp__secs">{state.remaining}s</span>
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}
