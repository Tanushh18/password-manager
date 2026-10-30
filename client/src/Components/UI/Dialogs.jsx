import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Alert } from "../Icons/Icons";

/*
 * In-app replacements for window.confirm / window.prompt: the same promise semantics,
 * but styled, keyboard-trapped, labelled for screen readers and able to show a list of
 * what is about to change.
 *
 *   const { confirm, prompt } = useDialogs();
 *   if (!(await confirm({ title: "Delete?", message: "…", tone: "danger", confirmLabel: "Delete" }))) return;
 *   const name = await prompt({ title: "Rename folder", label: "Folder name", defaultValue: "Work" }); // null = cancelled
 */

const DialogContext = createContext(null);
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Accessible modal surface: focus trap, Escape, focus restore, scroll lock. Used by the dialogs below and by pages. */
export function DialogFrame({ labelledBy, describedBy, onClose, size = "sm", className = "", children, dismissOnBackdrop = true }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement;
    const node = ref.current;
    const first = node?.querySelector("[data-autofocus]") || node?.querySelector(FOCUSABLE) || node;
    first?.focus?.();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); closeRef.current?.(); return; }
      if (e.key !== "Tab" || !node) return;
      const list = [...node.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!list.length) { e.preventDefault(); return; }
      const [head, tail] = [list[0], list[list.length - 1]];
      if (e.shiftKey && document.activeElement === head) { e.preventDefault(); tail.focus(); }
      else if (!e.shiftKey && document.activeElement === tail) { e.preventDefault(); head.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      previous?.focus?.();
    };
  }, []);

  return createPortal(
    <div className="ui-scrim" onMouseDown={(e) => { if (dismissOnBackdrop && e.target === e.currentTarget) onClose?.(); }}>
      <section ref={ref} tabIndex={-1} className={`ui-dialog ui-dialog--${size} ${className}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy} aria-describedby={describedBy}>
        {children}
      </section>
    </div>,
    document.body
  );
}

function AskDialog({ kind, title, message, details, tone, confirmLabel, cancelLabel, label, placeholder, defaultValue = "", match, allowEmpty, maxLength, onSettle }) {
  const titleId = useId();
  const bodyId = useId();
  const inputId = useId();
  const [value, setValue] = useState(defaultValue);
  const isPrompt = kind === "prompt";
  const invalid = isPrompt && (match != null ? value.trim() !== match : !allowEmpty && !value.trim());
  const danger = tone === "danger";

  const submit = (e) => {
    e.preventDefault();
    if (invalid) return;
    onSettle(isPrompt ? value.trim() : true);
  };

  return (
    <DialogFrame labelledBy={titleId} describedBy={message ? bodyId : undefined} onClose={() => onSettle(isPrompt ? null : false)}>
      <form onSubmit={submit}>
        <header className="ui-dialog__head">
          {danger ? <span className="ui-dialog__icon is-danger" aria-hidden="true"><Alert size={18} /></span> : null}
          <h2 id={titleId} className="ui-dialog__title">{title}</h2>
        </header>
        {message ? <div id={bodyId} className="ui-dialog__body">{message}</div> : null}
        {details?.length ? (
          <ul className="ui-dialog__details">{details.map((d, i) => <li key={i}>{d}</li>)}</ul>
        ) : null}
        {isPrompt ? (
          <div className="ui-dialog__field">
            <label htmlFor={inputId} className="ui-label">{label || title}</label>
            <input
              id={inputId}
              data-autofocus
              className="input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              maxLength={maxLength || 120}
              autoComplete="off"
              spellCheck="false"
            />
            {match != null ? <p className="ui-hint">Type <strong>{match}</strong> to confirm.</p> : null}
          </div>
        ) : null}
        <footer className="ui-dialog__foot">
          <button type="button" className="btn btn--quiet" onClick={() => onSettle(isPrompt ? null : false)}>{cancelLabel || "Cancel"}</button>
          <button type="submit" data-autofocus={isPrompt ? undefined : true} className={`btn ${danger ? "btn--danger" : "btn--primary"}`} disabled={invalid}>
            {confirmLabel || (isPrompt ? "Save" : "Confirm")}
          </button>
        </footer>
      </form>
    </DialogFrame>
  );
}

export function DialogProvider({ children }) {
  const [queue, setQueue] = useState([]);
  const nextId = useRef(1);

  const open = useCallback((kind, options) => new Promise((resolve) => {
    const opts = typeof options === "string" ? { message: options } : options || {};
    setQueue((q) => [...q, { id: nextId.current++, kind, title: kind === "prompt" ? "Enter a value" : "Please confirm", ...opts, resolve }]);
  }), []);

  const api = useMemo(() => ({
    confirm: (options) => open("confirm", options),
    prompt: (options) => open("prompt", options),
  }), [open]);

  const current = queue[0];
  const settle = (value) => {
    current?.resolve(value);
    setQueue((q) => q.slice(1));
  };

  return (
    <DialogContext.Provider value={api}>
      {children}
      {current ? <AskDialog key={current.id} {...current} onSettle={settle} /> : null}
    </DialogContext.Provider>
  );
}

/** { confirm, prompt }. Falls back to the browser's dialogs outside the provider (tests, isolated renders). */
export function useDialogs() {
  const ctx = useContext(DialogContext);
  return ctx || {
    confirm: async (o) => window.confirm([o?.title, typeof o === "string" ? o : o?.message].filter(Boolean).join("\n\n")),
    prompt: async (o) => window.prompt(o?.title || "", o?.defaultValue || ""),
  };
}
