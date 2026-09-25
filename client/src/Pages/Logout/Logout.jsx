import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useVault } from "../../state/vault";
import Ambience from "../../Components/Ambience/Ambience";
import { HeartLine, LockLine } from "../../Components/Icons/Icons";
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
    <div className="farewell page">
      <Ambience botanical={false} />

      <div className="farewell__card card anim-scale-in">
        <span className="card__ribbon" />
        <span className={`farewell__seal ${done ? "is-done" : "anim-beat"}`}>
          {done ? <LockLine size={26} /> : <HeartLine size={26} />}
        </span>

        <h1 className="farewell__title">
          {done ? (
            <>
              Locked up <em className="serif-em">safely.</em>
            </>
          ) : (
            <>
              Closing the <em className="serif-em">vault…</em>
            </>
          )}
        </h1>

        <p className="farewell__body">
          {done
            ? "Everything is sealed again. Come back whenever you like."
            : "Tidying up and signing you out."}
        </p>

        <div className="farewell__dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>

        <p className="farewell__sign script">until next time</p>
      </div>
    </div>
  );
}

export default Logout;
