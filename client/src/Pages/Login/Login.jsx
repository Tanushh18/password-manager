import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import AuthShell from "../../Components/AuthShell/AuthShell";
import Field from "../../Components/Field/Field";
import { Arrow, ShieldCheck } from "../../Components/Icons/Icons";
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

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((x) => ({ ...x, [k]: "" }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (loading) return;
    const found = {};
    if (!EMAIL_RE.test(form.email.trim())) found.email = "That email doesn't look right";
    if (!form.password) found.password = "Enter your master password";
    if (stepTwo && !form.code.trim()) found.code = "Enter the 6-digit code or a recovery code";
    setErrors(found);
    if (Object.keys(found).length) return;

    try {
      setLoading(true);
      setMessage(stepTwo ? "Checking your code…" : "Deriving your key and unlocking the vault…");
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
      toast.error(err.message);
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
            : "Your master password unlocks the vault on this device. It never leaves it unencrypted."}
        </p>

        {message ? <div className="notice auth__message">{message}</div> : null}

        {!stepTwo ? (
          <>
            <Field id="login-email" label="Email address" type="email" value={form.email} onChange={set("email")} placeholder="you@example.com" autoComplete="username" error={errors.email} disabled={loading} />
            <Field id="login-pass" label="Master password" secret value={form.password} onChange={set("password")} placeholder="••••••••••" autoComplete="current-password" error={errors.password} disabled={loading} />
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
          {loading ? "Unlocking…" : stepTwo ? "Verify and unlock" : "Unlock my vault"}
          {!loading && !stepTwo ? <Arrow size={16} /> : null}
        </button>

        {stepTwo ? (
          <button type="button" className="btn btn--quiet btn--block" onClick={() => { setStepTwo(false); setForm((f) => ({ ...f, code: "" })); }}>
            Use a different account
          </button>
        ) : (
          <p className="auth__swap">
            New here? <Link to="/signup">Create your vault</Link>
          </p>
        )}
      </form>
    </AuthShell>
  );
}
