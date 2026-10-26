import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useVault } from "../../state/vault";
import AuthScene from "../../Components/AuthShell/AuthScene";
import { LockLine, ShieldCheck } from "../../Components/Icons/Icons";
import "../../styles/auth.css";
import "./Logout.css";

function Logout() {
  const navigate = useNavigate();
  const { logout: signOut } = useVault();
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const logout = async () => {
      // Revokes the session on the server and wipes the key from memory.
      await signOut();
      if (cancelled) return;
      setDone(true);
      setTimeout(() => navigate("/signin", { replace: true }), 1100);
    };

    logout();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="farewell">
      <div className="farewell__scene" aria-hidden="true">
        <AuthScene />
        <span className="farewell__shade" />
      </div>

      <div className="farewell__card" role="status" aria-live="polite">
        <p className="farewell__kicker">Departures</p>
        <span className={`farewell__seal ${done ? "is-done" : ""}`} aria-hidden="true">
          {done ? <ShieldCheck size={24} /> : <LockLine size={24} />}
        </span>

        <h1 className="farewell__title">{done ? "You have departed safely." : "Closing the gate…"}</h1>

        <p className="farewell__body">
          {done
            ? "You are signed out and your session has ended. Taking you back to sign in."
            : "Signing you out and ending this session."}
        </p>

        <div className="farewell__board" aria-hidden="true">
          <span><small>Gate</small><b>Vault</b></span>
          <span><small>Status</small><b className={done ? "is-ready" : "is-busy"}>{done ? "Departed" : "Closing"}</b></span>
        </div>

        <Link className="btn btn--ghost btn--block farewell__link" to="/signin" replace>Back to sign in</Link>
      </div>
    </div>
  );
}

export default Logout;
