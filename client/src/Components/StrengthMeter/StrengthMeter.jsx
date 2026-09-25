import React from "react";

const TONES = ["danger", "danger", "warn", "ok", "ok"];

export default function StrengthMeter({ strength }) {
  return (
    <div className={`strength strength--${TONES[strength.score]}`} aria-live="polite">
      <div className="meter">
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={`meter__bar ${strength.score >= n ? `on-${strength.score}` : ""}`} />
        ))}
      </div>
      <span className="strength__label">
        {strength.label}
        {strength.bits ? ` · ~${strength.bits} bits` : ""}
      </span>
    </div>
  );
}

export { TONES as STRENGTH_TONES };
