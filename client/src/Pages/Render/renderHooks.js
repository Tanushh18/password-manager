import { useEffect, useRef } from "react";

/**
 * Calls `callback` every `ms` while `enabled` and the tab is visible.
 * Catches up immediately when a hidden tab becomes visible again, and always
 * invokes the latest callback so intervals never act on stale closures.
 */
export function usePolling(callback, ms, enabled = true) {
  const saved = useRef(callback);
  saved.current = callback;

  useEffect(() => {
    if (!enabled) return undefined;
    let timer = null;
    const tick = () => { if (!document.hidden) void saved.current(); };
    const start = () => { if (timer == null) timer = window.setInterval(tick, ms); };
    const stop = () => { if (timer != null) { window.clearInterval(timer); timer = null; } };
    const onVisibility = () => {
      if (document.hidden) stop();
      else { tick(); start(); }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [ms, enabled]);
}

/** Guards against out-of-order async responses: only the newest request may commit. */
export function useRequestGate() {
  const counter = useRef(0);
  return () => {
    counter.current += 1;
    const mine = counter.current;
    return () => mine === counter.current;
  };
}
