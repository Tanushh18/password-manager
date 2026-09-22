import React, { useEffect, useState } from "react";
import { useHistory } from "react-router-dom";
import { useDispatch } from "react-redux";
import { logoutUser } from "../../axios/instance";
import { setAuth } from "../../redux/actions";
import Ambience from "../../Components/Ambience/Ambience";
import { ShieldLine, LockLine } from "../../Components/Icons/Icons";
import "./Logout.css";

function Logout() {
  const history = useHistory();
  const dispatch = useDispatch();
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const logout = async () => {
      try {
        await logoutUser();
      } catch (err) {
        // Even if the call fails we still clear the session locally
        console.error("Logout request failed:", err?.message);
      } finally {
        if (cancelled) return;
        dispatch(setAuth(false));
        setDone(true);
        setTimeout(() => history.replace("/signin"), 1100);
      }
    };

    logout();
    return () => {
      cancelled = true;
    };
  }, [history, dispatch]);

  return (
    <div className="farewell page">
      <Ambience />

      <div className="farewell__card card anim-scale-in">
        <span className="card__ribbon" />
        <span className={`farewell__seal ${done ? "is-done" : ""}`}>
          {done ? <LockLine size={26} /> : <ShieldLine size={26} />}
        </span>

        <h1 className="farewell__title">
          {done ? (
            <>
              Signed out <em className="serif-em">securely.</em>
            </>
          ) : (
            <>
              Closing the <em className="serif-em">vault…</em>
            </>
          )}
        </h1>

        <p className="farewell__body">
          {done
            ? "Your vault is locked and your session has ended."
            : "Clearing your session and locking the vault."}
        </p>

        <div className="farewell__dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>

      </div>
    </div>
  );
}

export default Logout;
