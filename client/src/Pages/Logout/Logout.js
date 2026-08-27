import React, { useEffect, useState } from "react";
import { useHistory } from "react-router-dom";
import { useDispatch } from "react-redux";
import { logoutUser } from "../../axios/instance";
import { setAuth } from "../../redux/actions";
import Ambience from "../../Components/Ambience/Ambience";
import { HeartLine, LockLine } from "../../Components/Icons/Icons";
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
