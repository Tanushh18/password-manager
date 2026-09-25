import React, { useState } from "react";
import { Eye, EyeOff } from "../Icons/Icons";

/** Labelled input with an optional show/hide toggle and error hint. */
export default function Field({ id, label, error, hint, secret, className = "", right, ...input }) {
  const [shown, setShown] = useState(false);
  return (
    <div className={`field ${className}`}>
      {label ? (
        <label className="field__label" htmlFor={id}>
          {label}
        </label>
      ) : null}
      <div className="field__wrap">
        <input
          id={id}
          className={`input ${secret || right ? "input--icon" : ""} ${error ? "is-error" : ""} ${secret && shown ? "input--mono" : ""}`}
          type={secret ? (shown ? "text" : "password") : input.type || "text"}
          {...input}
        />
        {secret ? (
          <button
            type="button"
            className={`field__affix ${shown ? "is-on" : ""}`}
            onClick={() => setShown((v) => !v)}
            aria-label={shown ? "Hide" : "Show"}
            tabIndex={-1}
          >
            {shown ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        ) : (
          right
        )}
      </div>
      {error ? <p className="field__hint">{error}</p> : hint ? <p className="field__note">{hint}</p> : null}
    </div>
  );
}
