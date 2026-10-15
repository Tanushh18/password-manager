import React, { useEffect, useRef } from "react";
import { Alert } from "../Icons/Icons";

/**
 * A sign-in / sign-up error that stays on the page until it is dealt with (a toast disappears after a few seconds and
 * is easy to miss). `error` is { title?, message, hint? } or a plain string; nothing renders without one.
 */
export default function AuthError({ error }) {
  const ref = useRef(null);
  const view = typeof error === "string" ? { message: error } : error;
  useEffect(() => { if (view?.message) ref.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); }, [view?.message]);
  if (!view?.message) return null;
  return (
    <div ref={ref} className="notice notice--err auth__error" role="alert" aria-live="assertive">
      <Alert size={16} />
      <div>
        {view.title ? <strong>{view.title}</strong> : null}
        <span>{view.message}</span>
        {view.hint ? <small>{view.hint}</small> : null}
      </div>
    </div>
  );
}
