import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import AuthShell from "../../Components/AuthShell/AuthShell";
import Field from "../../Components/Field/Field";
import { Arrow, ShieldCheck } from "../../Components/Icons/Icons";
import AuthError from "../../Components/AuthError/AuthError";
import { useVault } from "../../state/vault";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  return (
    <AuthShell loading={loading} stage={{ label: stepTwo ? "Two-factor check" : "Secure sign in" }}>
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
            <Link to="/forgot-password">Forgot password?</Link> · New here? <Link to="/signup">Create your vault</Link>
          </p>
        )}
      </form>
    </AuthShell>
  );
}
