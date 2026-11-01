import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import AuthShell from "../../Components/AuthShell/AuthShell";
import Field from "../../Components/Field/Field";
import { Arrow, ShieldCheck } from "../../Components/Icons/Icons";
import AuthError from "../../Components/AuthError/AuthError";
import { useVault } from "../../state/vault";
import { readMpin, isPin } from "../../lib/mpin";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* The 4-digit MPIN screen, shown first on a device that has one. Four digits sign in at once. */
function MpinLogin({ onUsePassword }) {
  const { loginWithMpin } = useVault();
  const navigate = useNavigate();
  const location = useLocation();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const box = useRef(null);
  useEffect(() => { box.current?.focus(); }, [busy, error]);

  const submit = async (digits) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await loginWithMpin(digits);
      toast.success("Welcome back ✨");
      navigate(location.state?.from || "/passwords", { replace: true });
    } catch (err) {
      setPin("");
      if (err.kind === "gone") { onUsePassword(err.message); return; }
      setError(err.kind === "network" ? "Can't reach the server. Free servers sleep when idle and take up to a minute to wake." : err.message);
    } finally {
      setBusy(false);
    }
  };

  const change = (e) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
    setPin(digits);
    setError("");
    if (isPin(digits)) submit(digits);
  };

  return (
    <AuthShell variant="signin" loading={busy} stage={{ label: "MPIN sign in" }}>
      <form onSubmit={(e) => { e.preventDefault(); if (isPin(pin)) submit(pin); }} noValidate>
        <h1 className="auth__title">Welcome <em className="serif-em">back.</em></h1>
        <p className="auth__sub">Enter your 4-digit MPIN.</p>
        {error ? <div className="notice auth__message" role="alert">{error}</div> : null}
        <div className="mpin__dots" aria-hidden="true" onClick={() => box.current?.focus()} style={{ display: "flex", gap: ".75rem", justifyContent: "center", margin: "1.25rem 0" }}>
          {[0, 1, 2, 3].map((i) => <span key={i} style={{ width: "1rem", height: "1rem", borderRadius: "50%", border: "2px solid currentColor", background: i < pin.length ? "currentColor" : "transparent" }} />)}
        </div>
        <input ref={box} className="input" type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" maxLength={4} value={pin} onChange={change} disabled={busy} aria-label="4-digit MPIN" style={{ textAlign: "center", letterSpacing: ".5em", fontSize: "1.4rem" }} />
        <button type="button" className="btn btn--quiet btn--block" onClick={() => onUsePassword("")} disabled={busy}>Use email and password instead</button>
      </form>
    </AuthShell>
  );
}

export default function Login() {
  const { login } = useVault();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: "", password: "", code: "" });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [stepTwo, setStepTwo] = useState(false);
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState(null); // stays on screen until the next attempt
  const [usePassword, setUsePassword] = useState(() => !readMpin());

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((x) => ({ ...x, [k]: "" }));
    setFormError(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (loading) return;
    const found = {};
    if (!EMAIL_RE.test(form.email.trim())) found.email = "That email doesn't look right";
    if (!form.password) found.password = "Enter your password";
    if (stepTwo && !form.code.trim()) found.code = "Enter the 6-digit code or a recovery code";
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length) return;

    try {
      setLoading(true);
      setMessage(stepTwo ? "Checking your code…" : "Signing you in…");
      const res = await login(form.email.trim(), form.password, stepTwo ? form.code.trim() : undefined);
      if (res.twoFactorRequired) {
        setStepTwo(true);
        setMessage("");
        if (res.error) setErrors({ code: res.error });
        return;
      }
      toast.success("Welcome back ✨");
      navigate(location.state?.from || "/passwords", { replace: true });
    } catch (err) {
      setMessage("");
      if (err.kind === "credentials") {
        setFormError({ title: stepTwo ? "That code didn't work" : "Email or password is wrong", message: err.message, hint: stepTwo ? "Use the newest code from your authenticator app, or one of your recovery codes." : "Check both fields. Passwords are case-sensitive. New here? Create your vault, or use “Forgot password?”." });
        if (!stepTwo) setErrors({ password: "Email or password is wrong" });
      } else if (err.kind === "limited") setFormError({ title: "Too many attempts", message: err.message, hint: "This protects your account. Wait a few minutes, then try again." });
      else if (err.kind === "network") setFormError({ title: "Can't reach the server", message: err.message, hint: "Free servers sleep when idle and take up to a minute to wake. Your data is safe." });
      else if (err.kind === "server") setFormError({ title: "The server had a problem", message: err.message });
      else setFormError({ title: "Couldn't sign in", message: err.message });
    } finally {
      setLoading(false);
    }
  };

  if (!usePassword) return <MpinLogin onUsePassword={(why) => { if (why) setMessage(why); setUsePassword(true); }} />;

  return (
    <AuthShell variant="signin" loading={loading} stage={{ label: stepTwo ? "Two-factor check" : "Secure sign in" }}>
      <form onSubmit={submit} noValidate>
        <h1 className="auth__title">
          {stepTwo ? (
            <>
              One more <em className="serif-em">step.</em>
            </>
          ) : (
            <>
              Welcome <em className="serif-em">back.</em>
            </>
          )}
        </h1>
        <p className="auth__sub">
          {stepTwo
            ? "Open your authenticator app and enter the current code — or use one of your recovery codes."
            : "Sign in with your email and password to see your saved passwords."}
        </p>

        {message ? <div className="notice auth__message" role="status">{message}</div> : null}
        <AuthError error={formError} />

        {!stepTwo ? (
          <>
            <Field id="login-email" label="Email address" type="email" value={form.email} onChange={set("email")} placeholder="you@example.com" autoComplete="username" error={errors.email} disabled={loading} />
            <Field id="login-pass" label="Password" secret value={form.password} onChange={set("password")} placeholder="••••••••••" autoComplete="current-password" error={errors.password} disabled={loading} />
          </>
        ) : (
          <Field
            id="login-code"
            label="Authentication code"
            value={form.code}
            onChange={set("code")}
            placeholder="123 456"
            autoComplete="one-time-code"
            inputMode="text"
            autoFocus
            error={errors.code}
            disabled={loading}
          />
        )}

        <button type="submit" className="btn btn--primary btn--block auth__submit" disabled={loading}>
          <span className="btn__sheen" />
          {loading ? <span className="spinner" /> : stepTwo ? <ShieldCheck size={16} /> : null}
          {loading ? "Signing in…" : stepTwo ? "Verify and sign in" : "Sign in"}
          {!loading && !stepTwo ? <Arrow size={16} /> : null}
        </button>

        {stepTwo ? (
          <button type="button" className="btn btn--quiet btn--block" onClick={() => { setStepTwo(false); setForm((f) => ({ ...f, code: "" })); }}>
            Use a different account
          </button>
        ) : (
          <p className="auth__swap">
            <Link to="/forgot-password">Forgot password?</Link>
          </p>
        )}
      </form>
    </AuthShell>
  );
}
