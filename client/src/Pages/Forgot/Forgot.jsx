import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import AuthShell from "../../Components/AuthShell/AuthShell";
import Field from "../../Components/Field/Field";
import { Arrow, ShieldCheck } from "../../Components/Icons/Icons";
import * as api from "../../api/client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Forgot password: email -> 6-digit code -> new password (plus the authenticator code when 2FA is on). */
export default function Forgot() {
  const navigate = useNavigate();
  const [step, setStep] = useState("email"); // email | code
  const [form, setForm] = useState({ email: "", code: "", password: "", confirm: "", twoFactorCode: "" });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [needs2fa, setNeeds2fa] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => { if (!cooldown) return undefined; const t = setTimeout(() => setCooldown((c) => c - 1), 1000); return () => clearTimeout(t); }, [cooldown]);
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: k === "code" ? e.target.value.replace(/\D/g, "").slice(0, 6) : e.target.value })); setErrors((x) => ({ ...x, [k]: "" })); };

  const sendCode = async (e) => {
    e?.preventDefault();
    if (!EMAIL_RE.test(form.email.trim())) { setErrors({ email: "That email doesn't look right" }); return; }
    setLoading(true);
    try {
      const r = await api.forgotPassword(form.email.trim());
      toast.success(r.message || "Check your email for the code.");
      setStep("code"); setCooldown(60);
    } catch (err) { toast.error(api.errorMessage(err, "Could not send the code.")); }
    finally { setLoading(false); }
  };

  const reset = async (e) => {
    e.preventDefault();
    const found = {};
    if (!/^\d{6}$/.test(form.code)) found.code = "Enter the 6-digit code from the email";
    if (form.password.length < 8) found.password = "Use at least 8 characters";
    if (form.confirm !== form.password) found.confirm = "The two passwords don't match";
    if (needs2fa && !form.twoFactorCode.trim()) found.twoFactorCode = "Enter your authenticator or recovery code";
    setErrors(found);
    if (Object.keys(found).length) return;
    setLoading(true);
    try {
      const r = await api.resetPassword({ email: form.email.trim(), code: form.code, newPassword: form.password, ...(needs2fa ? { twoFactorCode: form.twoFactorCode.trim() } : {}) });
      toast.success(r.message || "Password changed.");
      navigate("/signin", { replace: true });
    } catch (err) {
      if (err?.response?.data?.twoFactorRequired) { setNeeds2fa(true); setErrors({ twoFactorCode: err.response.data.error }); }
      else toast.error(api.errorMessage(err, "Could not change the password."));
    } finally { setLoading(false); }
  };

  return (
    <AuthShell loading={loading} stage={{ label: step === "email" ? "Forgot password" : "Enter your code" }}>
      {step === "email" ? (
        <form onSubmit={sendCode} noValidate>
          <h1 className="auth__title">Forgot your <em className="serif-em">password?</em></h1>
          <p className="auth__sub">Enter your account email. We'll send a 6-digit code to reset it. Your saved passwords and projects stay exactly as they are.</p>
          <Field id="forgot-email" label="Email address" type="email" value={form.email} onChange={set("email")} placeholder="you@example.com" autoComplete="username" error={errors.email} disabled={loading} />
          <button type="submit" className="btn btn--primary btn--block auth__submit" disabled={loading}>
            <span className="btn__sheen" />{loading ? <span className="spinner" /> : null}{loading ? "Sending…" : "Send code"}{!loading ? <Arrow size={16} /> : null}
          </button>
          <p className="auth__swap">Remembered it? <Link to="/signin">Sign in</Link></p>
        </form>
      ) : (
        <form onSubmit={reset} noValidate>
          <h1 className="auth__title">Check your <em className="serif-em">email.</em></h1>
          <p className="auth__sub">We sent a 6-digit code to <b>{form.email}</b>. It is valid for 10 minutes.</p>
          <Field id="forgot-code" label="6-digit code" value={form.code} onChange={set("code")} placeholder="123456" inputMode="numeric" autoComplete="one-time-code" autoFocus error={errors.code} disabled={loading} />
          <Field id="forgot-pass" label="New password" secret value={form.password} onChange={set("password")} placeholder="At least 8 characters" autoComplete="new-password" error={errors.password} disabled={loading} />
          <Field id="forgot-confirm" label="Repeat new password" secret value={form.confirm} onChange={set("confirm")} placeholder="Same again" autoComplete="new-password" error={errors.confirm} disabled={loading} />
          {needs2fa && <Field id="forgot-2fa" label="Authenticator or recovery code" value={form.twoFactorCode} onChange={set("twoFactorCode")} placeholder="123 456" autoComplete="one-time-code" error={errors.twoFactorCode} disabled={loading} />}
          <button type="submit" className="btn btn--primary btn--block auth__submit" disabled={loading}>
            <span className="btn__sheen" />{loading ? <span className="spinner" /> : <ShieldCheck size={16} />}{loading ? "Saving…" : "Set new password"}
          </button>
          <button type="button" className="btn btn--quiet btn--block" disabled={loading || cooldown > 0} onClick={() => void sendCode()}>{cooldown > 0 ? "Send a new code in " + cooldown + " s" : "Send a new code"}</button>
          <p className="auth__swap"><Link to="/signin">Back to sign in</Link></p>
        </form>
      )}
    </AuthShell>
  );
}
