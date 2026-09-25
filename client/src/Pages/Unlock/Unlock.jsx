import React, { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import AuthShell from "../../Components/AuthShell/AuthShell";
import Field from "../../Components/Field/Field";
import Splash from "../../Components/Splash/Splash";
import { LockLine } from "../../Components/Icons/Icons";
import { useVault } from "../../state/vault";

/** Shown after a reload or auto-lock: the session is alive, the key is not. */
export default function Unlock() {
  const { status, profile, unlock } = useVault();
  const navigate = useNavigate();
  const location = useLocation();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (status === "checking") return <Splash />;
  if (status === "signedOut") return <Navigate to="/signin" replace />;
  if (status === "ready") return <Navigate to={location.state?.from || "/passwords"} replace />;

  const submit = async (e) => {
    e.preventDefault();
    if (!password || loading) return;
    try {
      setLoading(true);
      setError("");
      const res = await unlock(password, needCode ? code : undefined);
      if (res?.twoFactorRequired) {
        setNeedCode(true);
        if (res.error) setError(res.error);
        return;
      }
      navigate(location.state?.from || "/passwords", { replace: true });
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const first = (profile?.name || "").split(" ")[0];

  return (
    <AuthShell loading={loading} stage={{ label: "Vault locked", tone: "accent" }}>
      <form onSubmit={submit} noValidate>
        <h1 className="auth__title">
          Hi {first || "there"}, <em className="serif-em">unlock.</em>
        </h1>
        <p className="auth__sub">
          Your vault locked itself to keep things safe. Enter your master password for <strong>{profile?.email}</strong>.
        </p>
        <Field id="unlock-pass" label="Master password" secret value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus error={!needCode ? error : ""} disabled={loading} />
        {needCode ? (
          <Field id="unlock-code" label="Authentication code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123 456" autoComplete="one-time-code" error={error} disabled={loading} />
        ) : null}
        <button type="submit" className="btn btn--primary btn--block auth__submit" disabled={loading}>
          <span className="btn__sheen" />
          {loading ? <span className="spinner" /> : <LockLine size={16} />}
          {loading ? "Unlocking…" : "Unlock"}
        </button>
        <p className="auth__swap">
          Not you? <Link to="/logout">Sign out</Link>
        </p>
      </form>
    </AuthShell>
  );
}
