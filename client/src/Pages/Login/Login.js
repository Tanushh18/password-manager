import React, { useEffect, useRef, useState } from "react";
import { Link, useHistory } from "react-router-dom";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { useDispatch, useSelector } from "react-redux";
import { loginUser } from "../../axios/instance";
import { setAuth } from "../../redux/actions";
import Ambience from "../../Components/Ambience/Ambience";
import ServiceStatus from "../../Components/ServiceStatus/ServiceStatus";
import { ShieldLine, LockLine, Eye, EyeOff, Check, Arrow, Sparkle } from "../../Components/Icons/Icons";
import "../../styles/auth.css";

const STAGES = {
  idle: { label: "Secure sign in", tone: "accent" },
  waking: { label: "Waking the vault…", tone: "accent" },
  connecting: { label: "Opening an encrypted connection…", tone: "accent" },
  verifying: { label: "Verifying your credentials…", tone: "accent" },
  success: { label: "Signed in", tone: "positive" },
  error: { label: "That didn't work", tone: "danger" },
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function Login() {
  const isAuthenticated = useSelector((s) => s.isAuthenticated);
  const history = useHistory();
  const dispatch = useDispatch();
  const btnRef = useRef(null);

  const [userData, setUserData] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState({ email: "", password: "" });
  const [valid, setValid] = useState({ email: false, password: false });
  const [stage, setStage] = useState("idle");
  const [message, setMessage] = useState("");
  const [showPass, setShowPass] = useState(false);

  const loading = ["waking", "connecting", "verifying"].includes(stage);

  useEffect(() => {
    if (isAuthenticated) history.replace("/");
  }, [isAuthenticated, history]);

  const validate = (field, value) => {
    if (field === "email") {
      const ok = EMAIL_RE.test(value);
      setErrors((p) => ({ ...p, email: value && !ok ? "That email doesn't look quite right" : "" }));
      setValid((p) => ({ ...p, email: !!value && ok }));
    }
    if (field === "password") {
      const ok = value.length >= 6;
      setErrors((p) => ({ ...p, password: value && !ok ? "At least 6 characters, please" : "" }));
      setValid((p) => ({ ...p, password: ok }));
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setUserData((p) => ({ ...p, [name]: value }));
    validate(name, value);
  };

  const ripple = (e) => {
    const btn = btnRef.current;
    if (!btn || !e?.clientX) return;
    const rect = btn.getBoundingClientRect();
    const span = document.createElement("span");
    span.className = "ripple";
    span.style.left = `${e.clientX - rect.left}px`;
    span.style.top = `${e.clientY - rect.top}px`;
    btn.appendChild(span);
    setTimeout(() => span.remove(), 700);
  };

  const fail = (msg) => {
    setStage("error");
    setMessage(msg);
    toast.error(msg);
    setTimeout(() => {
      setStage("idle");
      setMessage("");
    }, 2600);
  };

  const handleLogin = async (e) => {
    if (e) {
      e.preventDefault();
      ripple(e);
    }
    if (loading) return;

    let bad = false;
    if (!userData.email) {
      setErrors((p) => ({ ...p, email: "We need your email" }));
      bad = true;
    }
    if (!userData.password) {
      setErrors((p) => ({ ...p, password: "And your password" }));
      bad = true;
    }
    if (bad) {
      setStage("error");
      setTimeout(() => setStage("idle"), 1600);
      return;
    }

    try {
      setStage("waking");
      setMessage("Waking the vault — free hosting takes a moment to start.");
      await delay(800);

      setStage("connecting");
      setMessage("Opening an encrypted connection…");
      await delay(500);

      setStage("verifying");
      setMessage("Verifying your credentials…");

      const res = await loginUser(userData);

      if (res.status === 200) {
        setStage("success");
        setMessage("Signed in. Opening your vault…");
        await delay(1100);
        dispatch(setAuth(true));
        history.push("/");
      } else {
        fail(res.data?.error || "We couldn't sign you in.");
      }
    } catch (err) {
      const status = err?.response?.status;
      const serverMsg = err?.response?.data?.error;
      if (status === 400 || status === 401) {
        fail(serverMsg || "That email and password don't match.");
      } else if (err?.code === "ERR_NETWORK" || /network/i.test(err?.message || "")) {
        fail("We can't reach the vault right now. Please try again in a moment.");
      } else {
        fail(serverMsg || "Something went wrong. Please try again.");
      }
    }
  };

  const cfg = STAGES[stage] || STAGES.idle;

  return (
    <div className="auth page">
      <Ambience />
      <ToastContainer position="top-right" autoClose={4500} newestOnTop closeOnClick pauseOnHover draggable />

      <div className="auth__card card anim-fade-up">
        {loading && (
          <div className="auth__progress">
            <span className="auth__progress-fill" />
          </div>
        )}

        {/* ── Form side ── */}
        <form className="auth__form" onSubmit={handleLogin}>
          <span className={`pill auth__stage auth__stage--${cfg.tone}`}>
            <span className="dot dot--live" />
            {cfg.label}
          </span>

          <h1 className="auth__title">
            Welcome <em className="serif-em">back.</em>
          </h1>
          <p className="auth__sub">Sign in to unlock your vault. Everything is exactly where you left it.</p>

          {message && (
            <div
              className={`notice auth__message ${
                stage === "error" ? "notice--err" : stage === "success" ? "notice--ok" : ""
              }`}
            >
              {stage === "success" ? <Check size={15} /> : <Sparkle size={15} />}
              <span>{message}</span>
            </div>
          )}

          <div className="field">
            <label className="field__label" htmlFor="login-email">
              Email address
            </label>
            <div className="field__wrap">
              <input
                id="login-email"
                className={`input input--icon ${errors.email ? "is-error" : valid.email ? "is-valid" : ""}`}
                type="email"
                name="email"
                placeholder="you@example.com"
                value={userData.email}
                onChange={handleChange}
                autoComplete="email"
                disabled={loading}
                required
              />
              {valid.email && !errors.email && (
                <span className="field__affix is-ok">
                  <Check size={15} />
                </span>
              )}
            </div>
            {errors.email && <p className="field__hint">{errors.email}</p>}
          </div>

          <div className="field">
            <div className="field__row">
              <label className="field__label" htmlFor="login-pass">
                Password
              </label>
            </div>
            <div className="field__wrap">
              <input
                id="login-pass"
                className={`input input--icon ${errors.password ? "is-error" : valid.password ? "is-valid" : ""}`}
                type={showPass ? "text" : "password"}
                name="password"
                placeholder="••••••••••"
                value={userData.password}
                onChange={handleChange}
                autoComplete="current-password"
                disabled={loading}
                required
              />
              <button
                type="button"
                className={`field__affix ${showPass ? "is-on" : ""}`}
                onClick={() => setShowPass((v) => !v)}
                aria-label={showPass ? "Hide password" : "Show password"}
                tabIndex={-1}
              >
                {showPass ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            {errors.password && <p className="field__hint">{errors.password}</p>}
          </div>

          <button
            ref={btnRef}
            type="submit"
            className={`btn btn--primary btn--block auth__submit ${
              stage === "success" ? "btn--success" : stage === "error" ? "btn--error" : ""
            }`}
            disabled={loading}
            onClick={handleLogin}
          >
            {loading ? (
              <>
                <span className="spinner" />
                {stage === "waking" ? "Waking the vault…" : stage === "connecting" ? "Connecting…" : "Verifying…"}
              </>
            ) : stage === "success" ? (
              <>
                <Check size={16} /> Welcome home
              </>
            ) : stage === "error" ? (
              <>Try once more</>
            ) : (
              <>
                Unlock my vault <Arrow size={16} />
              </>
            )}
          </button>

          {stage === "waking" && (
            <p className="auth__wake">
              The free-tier server naps after a while — the first sign in can take ten seconds or so.
            </p>
          )}

          <p className="auth__swap">
            New here? <Link to="/signup">Create your vault</Link>
          </p>

          <div className="auth__status">
            <ServiceStatus compact />
          </div>
        </form>

        {/* ── Assurance panel ── */}
        <aside className="auth__aside" aria-hidden="true">
          <span className="auth__aside-glow" />
          <span className="auth__aside-ring" />

          <div className="auth__seal">
            {stage === "success" ? <Check size={26} /> : <LockLine size={26} />}
          </div>

          <h2 className="auth__aside-title">
            Encrypted,
            <br />
            <em>never shared.</em>
          </h2>
          <p className="auth__aside-body">
            Every password is encrypted with AES-256 before it is stored. Only you can unlock it.
          </p>

          <div className="auth__aside-list">
            <span className="auth__aside-item">
              <ShieldLine size={15} /> Private by default
            </span>
            <span className="auth__aside-item">
              <LockLine size={15} /> Encrypted the moment you save
            </span>
            <span className="auth__aside-item">
              <Sparkle size={15} /> Available on every device
            </span>
          </div>

        </aside>
      </div>
    </div>
  );
}

export default Login;
