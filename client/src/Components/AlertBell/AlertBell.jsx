import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getRenderOpsIncidents } from "../../api/client";
import { openIncidents, newIncidents } from "../../lib/alerts";
import "./AlertBell.css";

const POLL_MS = 60 * 1000;

/* Bell in the navbar: shows open server incidents and raises a desktop notification for new ones (if allowed). */
export default function AlertBell({ enabled }) {
  const [open, setOpen] = useState([]);
  const [menu, setMenu] = useState(false);
  const seen = useRef(null); // null until the first load, so old incidents never pop a notification
  const wrap = useRef(null);

  const poll = useCallback(async () => {
    if (document.hidden) return;
    try {
      const { incidents } = await getRenderOpsIncidents(200);
      const now = openIncidents(incidents);
      if (seen.current && typeof Notification !== "undefined" && Notification.permission === "granted") {
        newIncidents(now, seen.current).slice(0, 3).forEach((e) => new Notification(`${e.serviceName || "Service"}: ${e.type}`, { body: e.message || "New incident", tag: e.id }));
      }
      seen.current = new Set(now.map((e) => e.id));
      setOpen(now);
    } catch { /* no Render accounts yet, or offline: keep the bell quiet */ }
  }, []);

  useEffect(() => {
    if (!enabled) { seen.current = null; setOpen([]); return undefined; }
    void poll();
    const t = setInterval(poll, POLL_MS);
    const onVisible = () => { if (!document.hidden) void poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  }, [enabled, poll]);

  useEffect(() => {
    if (!menu) return undefined;
    const close = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setMenu(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  if (!enabled) return null;
  const canAsk = typeof Notification !== "undefined" && Notification.permission === "default";
  return (
    <div className="bell" ref={wrap}>
      <button type="button" className="bell__btn" onClick={() => setMenu((m) => !m)} aria-label={`Alerts${open.length ? `, ${open.length} open` : ""}`} aria-expanded={menu}>
        <span aria-hidden="true">🔔</span>
        {open.length ? <span className="bell__count">{open.length > 9 ? "9+" : open.length}</span> : null}
      </button>
      {menu && (
        <div className="bell__menu card" role="menu">
          {open.length ? open.slice(0, 6).map((e) => (
            <Link key={e.id} to="/render" className="bell__item" role="menuitem" onClick={() => setMenu(false)}>
              <strong>{e.serviceName || "Service"}</strong><small>{e.message}</small>
            </Link>
          )) : <p className="bell__empty">No open incidents.</p>}
          {canAsk && <button type="button" className="btn btn--quiet btn--sm" onClick={() => Notification.requestPermission().then(() => setMenu(false))}>Enable desktop alerts</button>}
        </div>
      )}
    </div>
  );
}
