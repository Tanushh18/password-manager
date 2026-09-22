import React, { useEffect, useRef, useState } from "react";
import { Link, useHistory } from "react-router-dom";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { useSelector } from "react-redux";
import { signupUser } from "../../axios/instance";
import Ambience from "../../Components/Ambience/Ambience";
import ServiceStatus from "../../Components/ServiceStatus/ServiceStatus";
import { ShieldLine, LockLine, Eye, EyeOff, Check, Arrow, Sparkle } from "../../Components/Icons/Icons";
import "../../styles/auth.css";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const strengthOf = (value = "") => {
  let score = 0;
  if (value.length >= 6) score += 1;
  if (value.length >= 10) score += 1;
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score += 1;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score += 1;
  return Math.min(score, 4);
};

const STRENGTH_WORDS = ["", "a little fragile", "getting there", "nice and strong", "beautifully strong"];

function Signup() {
  const isAuthenticated = useSelector((state) => state.isAuthenticated);
  const history = useHistory();
  const btnRef = useRef(null);

  const [userData, setUserData] = useState({ name: "", email: "", password: "", cpassword: "" });
  const [errors, setErrors] = useState({});
  const [stage, setStage] = useState("idle"); // idle | saving | success | error
  const [message, setMessage] = useState("");
  const [showPass, setShowPass] = useState(false);

  const loading = stage === "saving";
  const strength = strengthOf(userData.password);

  useEffect(() => {
    if (isAuthenticated) history.replace("/");
  }, [isAuthenticated, history]);

  const validate = (field, value, all) => {
    const data = { ...userData, ...all, [field]: value };
    const next = {};
    if (field === "name") next.name = value && value.trim().length < 2 ? "Use at least two characters" : "";
    if (field === "email") next.email = value && !EMAIL_RE.test(value) ? "Enter a valid email address" : "";
    if (field === "password") next.password = value && value.length < 6 ? "Use at least 6 characters" : "";
    if (field === "password" || field === "cpassword") {
      next.cpassword =
        data.cpassword && data.password !== data.cpassword ? "Passwords do not match" : "";
    }
    setErrors((p) => ({ ...p, ...next }));
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
    }, 2800);
  };

  const handleRegister = async (e) => {
    if (e) {
      e.preventDefault();
      ripple(e);
    }
    if (loading) return;

    const { name, email, password, cpassword } = userData;
    const found = {};
    if (!name.trim()) found.name = "Enter your name";
    if (!email) found.email = "Enter your email address";
    if (!password) found.password = "Choose a password";
    if (!cpassword) found.cpassword = "Confirm your password";
    if (password && cpassword && password !== cpassword) found.cpassword = "Passwords do not match";
    if (email && !EMAIL_RE.test(email)) found.email = "Enter a valid email address";

    if (Object.keys(found).length) {
      setErrors((p) => ({ ...p, ...found }));
      setStage("error");
      setTimeout(() => setStage("idle"), 1600);
      return;
    }

    try {
      setStage("saving");
      setMessage("Preparing your vault — this can take a moment on first visit.");

      const res = await signupUser(userData);

      if (res.status === 201) {
        setStage("success");
        setMessage("Vault created. Taking you to sign in…");
        toast.success(res.data?.message || "Vault created successfully.");
        setUserData({ name: "", email: "", password: "", cpassword: "" });
        setTimeout(() => history.push("/signin"), 1300);
      } else {
        fail(res.data?.error || "We couldn't create your vault.");
      }
    } catch (err) {
      const serverMsg = err?.response?.data?.error;
      if (err?.code === "ERR_NETWORK" || /network/i.test(err?.message || "")) {
        fail("We can't reach the vault right now. Please try again in a moment.");
      } else {
        fail(serverMsg || "We couldn't create your vault. Please try again.");
      }
    }
  };

  const stageCfg =
    stage === "success"
      ? { label: "Vault created", tone: "positive" }
      : stage === "error"
      ? { label: "Almost there", tone: "danger" }
      : stage === "saving"
      ? { label: "Preparing your vault…", tone: "accent" }
      : { label: "Create your vault", tone: "accent" };

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

        <form className="auth__form" onSubmit={handleRegister}>
          <span className={`pill auth__stage auth__stage--${stageCfg.tone}`}>
            <span className="dot dot--live" />
            {stageCfg.label}
          </span>

          <h1 className="auth__title">
            Create your <em className="serif-em">vault.</em>
          </h1>
          <p className="auth__sub">
            One account and one master password — every other credential is handled for you.
          </p>

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
            <label className="field__label" htmlFor="su-name">Full name</label>
            <div className="field__wrap">
              <input
                id="su-name"
                className={`input ${errors.name ? "is-error" : userData.name.trim().length > 1 ? "is-valid" : ""}`}
                type="text"
                name="name"
                placeholder="Your name"
                value={userData.name}
                onChange={handleChange}
                autoComplete="name"
                disabled={loading}
                required
              />
            </div>
            {errors.name && <p className="field__hint">{errors.name}</p>}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="su-email">Email address</label>
            <div className="field__wrap">
              <input
                id="su-email"
                className={`input input--icon ${
                  errors.email ? "is-error" : EMAIL_RE.test(userData.email) ? "is-valid" : ""
                }`}
                type="email"
                name="email"
                placeholder="you@example.com"
                value={userData.email}
                onChange={handleChange}
                autoComplete="email"
                disabled={loading}
                required
              />
              {EMAIL_RE.test(userData.email) && !errors.email && (
                <span className="field__affix is-ok"><Check size={15} /></span>
              )}
            </div>
            {errors.email && <p className="field__hint">{errors.email}</p>}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="su-pass">Password</label>
            <div className="field__wrap">
              <input
                id="su-pass"
                className={`input input--icon ${errors.password ? "is-error" : strength >= 3 ? "is-valid" : ""}`}
                type={showPass ? "text" : "password"}
                name="password"
                placeholder="At least 6 characters"
                value={userData.password}
                onChange={handleChange}
                autoComplete="new-password"
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
            {userData.password && (
              <>
                <div className="meter" aria-hidden="true">
                  {[1, 2, 3, 4].map((i) => (
                    <span key={i} className={`meter__bar ${strength >= i ? `on-${strength}` : ""}`} />
                  ))}
                </div>
                <p className={`field__hint ${!errors.password ? "field__hint--ok" : ""}`}>
                  {errors.password || `This one is ${STRENGTH_WORDS[strength] || "a little fragile"}`}
                </p>
              </>
            )}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="su-cpass">Confirm password</label>
            <div className="field__wrap">
              <input
                id="su-cpass"
                className={`input input--icon ${
                  errors.cpassword
                    ? "is-error"
                    : userData.cpassword && userData.cpassword === userData.password
                    ? "is-valid"
                    : ""
                }`}
                type={showPass ? "text" : "password"}
                name="cpassword"
                placeholder="Re-enter your password"
                value={userData.cpassword}
                onChange={handleChange}
                autoComplete="new-password"
                disabled={loading}
                required
              />
              {userData.cpassword && userData.cpassword === userData.password && (
                <span className="field__affix is-ok"><Check size={15} /></span>
              )}
            </div>
            {errors.cpassword && <p className="field__hint">{errors.cpassword}</p>}
          </div>

          <button
            ref={btnRef}
            type="submit"
            className={`btn btn--primary btn--block auth__submit ${
              stage === "success" ? "btn--success" : stage === "error" ? "btn--error" : ""
            }`}
            disabled={loading}
            onClick={handleRegister}
          >
            {loading ? (
              <>
                <span className="spinner" /> Preparing your vault…
              </>
            ) : stage === "success" ? (
              <>
                <Check size={16} /> Vault created
              </>
            ) : (
              <>
                Create my vault <Arrow size={16} />
              </>
            )}
          </button>

          <p className="auth__swap">
            Already have a vault? <Link to="/signin">Sign in</Link>
          </p>

          <div className="auth__status">
            <ServiceStatus compact />
          </div>
        </form>

        <aside className="auth__aside" aria-hidden="true">
          <span className="auth__aside-glow" />
          <span className="auth__aside-ring" />

          <div className="auth__seal">
            <ShieldLine size={26} />
          </div>

          <h2 className="auth__aside-title">
            One account,
            <br />
            <em>every credential.</em>
          </h2>
          <p className="auth__aside-body">
            Nothing to install and nothing to pay for — a secure home for the credentials you cannot afford to lose.
          </p>

          <div className="auth__aside-list">
            <span className="auth__aside-item">
              <LockLine size={15} /> AES-256 before it is stored
            </span>
            <span className="auth__aside-item">
              <ShieldLine size={15} /> No trackers, no adverts
            </span>
            <span className="auth__aside-item">
              <Sparkle size={15} /> Free, and always will be
            </span>
          </div>

        </aside>
      </div>
    </div>
  );
}

export default Signup;
