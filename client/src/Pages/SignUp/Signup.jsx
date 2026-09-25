import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import AuthShell from "../../Components/AuthShell/AuthShell";
import Field from "../../Components/Field/Field";
import StrengthMeter from "../../Components/StrengthMeter/StrengthMeter";
import { Alert, Sparkle } from "../../Components/Icons/Icons";
import { useVault } from "../../state/vault";
import { estimate } from "../../lib/strength";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Signup() {
  const { register, login } = useVault();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "", cpassword: "" });
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const strength = useMemo(() => estimate(form.password), [form.password]);

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((x) => ({ ...x, [k]: "" }));
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
    if (Object.keys(found).length) return;

    try {
      setLoading(true);
      await register({ name: form.name.trim(), email: form.email.trim(), password: form.password });
      await login(form.email.trim(), form.password);
      toast.success("Your vault is ready ✨");
      navigate("/passwords", { replace: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell loading={loading} stage={{ label: loading ? "Creating your key…" : "Begin your vault" }}>
      <form onSubmit={submit} noValidate>
        <h1 className="auth__title">
          Create your <em className="serif-em">vault.</em>
        </h1>
        <p className="auth__sub">One master password to remember. It encrypts everything — so choose it well.</p>

        <Field id="su-name" label="Name" value={form.name} onChange={set("name")} placeholder="Your name" autoComplete="name" error={errors.name} disabled={loading} />
        <Field id="su-email" label="Email" type="email" value={form.email} onChange={set("email")} placeholder="you@example.com" autoComplete="username" error={errors.email} disabled={loading} />
        <Field id="su-pass" label="Master password" secret value={form.password} onChange={set("password")} placeholder="A long, memorable phrase" autoComplete="new-password" error={errors.password} disabled={loading} />
        {form.password ? <StrengthMeter strength={strength} /> : null}
        <Field id="su-cpass" label="Confirm master password" secret value={form.cpassword} onChange={set("cpassword")} placeholder="Type it once more" autoComplete="new-password" error={errors.cpassword} disabled={loading} />

        <label className={`consent ${errors.agree ? "is-error" : ""}`}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>
            <Alert size={14} /> I understand Aurelia <strong>cannot reset or recover</strong> my master password. If I forget it,
            my vault can't be opened.
          </span>
        </label>

        <button type="submit" className="btn btn--primary btn--block auth__submit" disabled={loading}>
          <span className="btn__sheen" />
          {loading ? <span className="spinner" /> : <Sparkle size={15} />}
          {loading ? "Creating your vault…" : "Create my vault"}
        </button>

        <p className="auth__swap">
          Already have one? <Link to="/signin">Sign in</Link> · <Link to="/privacy">Privacy</Link>
        </p>
      </form>
    </AuthShell>
  );
}
