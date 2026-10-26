import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { getSessions, revokeSession, logoutOtherDevices, getAuditLog } from "../../api/client";
import "./SessionsPanel.css";

const ACTIONS = {
  sign_in: "Signed in",
  password_changed: "Password changed",
  sessions_revoked_all: "Signed out all other devices",
  session_revoked: "Signed out a device",
  two_factor_enabled: "Two-factor turned on",
  two_factor_disabled: "Two-factor turned off",
};
const when = (d) => (d ? new Date(d).toLocaleString() : "");

/* Settings: where you are signed in (with sign-out per device) and a log of recent security events. */
export default function SessionsPanel() {
  const [sessions, setSessions] = useState(null);
  const [events, setEvents] = useState(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([getSessions(), getAuditLog(30)]);
      setSessions(s.sessions || []);
      setEvents(a.events || []);
    } catch { setSessions([]); setEvents([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const revoke = async (s) => {
    setBusy(s.id);
    try { await revokeSession(s.id); toast.success("Device signed out."); await load(); }
    catch (e) { toast.error(e?.response?.data?.error || "Couldn't sign that device out."); }
    finally { setBusy(""); }
  };
  const revokeAll = async () => {
    if (!window.confirm("Sign out of every other device?")) return;
    setBusy("all");
    try { await logoutOtherDevices(); toast.success("Signed out of every other device."); await load(); }
    catch { toast.error("Couldn't sign the other devices out."); }
    finally { setBusy(""); }
  };

  if (!sessions) return <p className="sess__muted">Loading devices…</p>;
  const others = sessions.filter((s) => !s.current).length;
  return (
    <div className="sess">
      <ul className="sess__list" aria-label="Signed-in devices">
        {sessions.map((s) => (
          <li key={s.id} className={s.current ? "is-current" : ""}>
            <span className="sess__device" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="18" height="12" rx="2" /><path d="M8.5 20h7M12 16.5V20" /></svg>
            </span>
            <div className="sess__info">
              <strong>{s.device}{s.current ? <span className="sess__badge">This device</span> : null}</strong>
              <small>{s.ip ? s.ip + " · " : ""}signed in {when(s.createdAt)}</small>
            </div>
            {!s.current && <button type="button" className="btn btn--ghost btn--sm sess__out" disabled={busy === s.id} onClick={() => revoke(s)}>Sign out</button>}
          </li>
        ))}
        {!sessions.length && <li className="sess__muted">No sessions found.</li>}
      </ul>
      {others > 0 && <button type="button" className="btn btn--ghost btn--sm sess__all" disabled={busy === "all"} onClick={revokeAll}>Sign out all other devices</button>}
      <details className="sess__log">
        <summary>Recent security activity <span className="sess__count">{(events || []).length}</span></summary>
        <ol>
          {(events || []).map((e, i) => (
            <li key={i}><span>{ACTIONS[e.action] || e.action}</span><small>{e.device}{e.ip ? " · " + e.ip : ""} · {when(e.at)}</small></li>
          ))}
          {!(events || []).length && <li className="sess__muted">Nothing recorded yet.</li>}
        </ol>
      </details>
    </div>
  );
}
