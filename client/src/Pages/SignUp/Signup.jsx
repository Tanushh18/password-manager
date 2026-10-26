import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import AuthShell from "../../Components/AuthShell/AuthShell";
import Field from "../../Components/Field/Field";
import StrengthMeter from "../../Components/StrengthMeter/StrengthMeter";
import { Alert, Sparkle } from "../../Components/Icons/Icons";
import AuthError from "../../Components/AuthError/AuthError";
import { useVault } from "../../state/vault";
import { estimate } from "../../lib/strength";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Signup() {
  const { register, login } = useVault();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "", cpassword: "" });
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [loading, setLoading] = useState(false);
  const strength = useMemo(() => estimate(form.password), [form.password]);

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((x) => ({ ...x, [k]: "" }));
    setFormError(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (loading) return;
    const found = {};
    if (form.name.trim().length < 2) found.name = "Tell us your name";
    if (!EMAIL_RE.test(form.email.trim())) found.email = "That email doesn't look right";
    if (form.password.length < 8) found.password = "Use at least 8 characters";
    else if (strength.score < 2) found.password = "Make it a little stronger — try a short phrase";
    if (form.password !== form.cpassword) found.cpassword = "These two don't match";
    if (!agree) found.agree = "Please confirm you understand";
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length) return;

    try {
      setLoading(true);
      await register({ name: form.name.trim(), email: form.email.trim(), password: form.password });
      await login(form.email.trim(), form.password);
      toast.success("Your account is ready ✨");
      navigate("/passwords", { replace: true });
    } catch (err) {
      const taken = /already|exist|registered|in use/i.test(err.message);
      setFormError({
        title: err.kind === "network" ? "Can't reach the server" : err.kind === "limited" ? "Too many attempts" : err.kind === "server" ? "The server had a problem" : taken ? "That email already has an account" : "We couldn't create your account",
        message: err.message,
        hint: taken ? "Try signing in instead, or use “Forgot password?” if you can't remember the password." : err.kind === "network" ? "Free servers sleep when idle and take up to a minute to wake." : undefined
      });
      if (taken) setErrors((x) => ({ ...x, email: "This email is already registered" }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell variant="signup" loading={loading} stage={{ label: loading ? "Creating your account…" : "Get started" }}>
      <form onSubmit={submit} noValidate>
        <h1 className="auth__title">
          Create your <em className="serif-em">account.</em>
        </h1>
        <p className="auth__sub">Sign up with your email and a password — you'll use them to sign in and see your saved passwords.</p>
        <AuthError error={formError} />

        <Field id="su-name" label="Name" value={form.name} onChange={set("name")} placeholder="Your name" autoComplete="name" error={errors.name} disabled={loading} />
        <Field id="su-email" label="Email" type="email" value={form.email} onChange={set("email")} placeholder="you@example.com" autoComplete="username" error={errors.email} disabled={loading} />
        <Field id="su-pass" label="Password" secret value={form.password} onChange={set("password")} placeholder="A long, memorable phrase" autoComplete="new-password" error={errors.password} disabled={loading} />
        {form.password ? <StrengthMeter strength={strength} /> : null}
        <Field id="su-cpass" label="Confirm password" secret value={form.cpassword} onChange={set("cpassword")} placeholder="Type it once more" autoComplete="new-password" error={errors.cpassword} disabled={loading} />

        <label className={`consent ${errors.agree ? "is-error" : ""}`}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>
            <Alert size={14} /> I understand that if I forget my password, I can reset it by signing in again — there is no
            separate vault key to lose.
          </span>
        </label>

        <button type="submit" className="btn btn--primary btn--block auth__submit" disabled={loading}>
          <span className="btn__sheen" />
          {loading ? <span className="spinner" /> : <Sparkle size={15} />}
          {loading ? "Creating your account…" : "Create my account"}
        </button>

        <p className="auth__swap">
          Already have one? <Link to="/signin">Sign in</Link> · <Link to="/privacy">Privacy</Link>
        </p>
      </form>
    </AuthShell>
  );
}
