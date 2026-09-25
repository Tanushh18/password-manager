import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import QRCode from "qrcode";
import Ambience from "../../Components/Ambience/Ambience";
import Field from "../../Components/Field/Field";
import StrengthMeter from "../../Components/StrengthMeter/StrengthMeter";
import ThemeToggle from "../../Components/ThemeToggle/ThemeToggle";
import ImportModal from "../../Components/Item/ImportModal";
import { ShieldCheck, LockLine, User, Globe, Timer, Download, Upload, Trash, Copy, Check, Logout, Arrow, Alert, KeyLine } from "../../Components/Icons/Icons";
import * as api from "../../api/client";
import { exportBackup } from "../../lib/crypto";
import { toCSV } from "../../lib/items";
import { estimate } from "../../lib/strength";
import { useVault } from "../../state/vault";
import "./Settings.css";

const download = (name, text, type) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const stamp = () => new Date().toISOString().slice(0, 10);

function Section({ icon, title, sub, children, danger }) {
  return (
    <section className={`settings__section card ${danger ? "settings__section--danger" : ""}`}>
      <span className="card__ribbon" />
      <header className="settings__head">
        <span className="settings__icon">{icon}</span>
        <div>
          <h2>{title}</h2>
          {sub ? <p>{sub}</p> : null}
        </div>
      </header>
      {children}
    </section>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch__track"><span className="switch__thumb" /></span>
      <span className="switch__label">{label}</span>
    </label>
  );
}

function RecoveryCodes({ codes, onDone }) {
  const text = codes.join("\n");
  return (
    <div className="recovery">
      <p className="notice notice--ok">
        <Check size={15} /> Save these one-time recovery codes somewhere safe. Each one gets you in once if you lose your phone.
      </p>
      <div className="recovery__grid">
        {codes.map((c) => <code key={c}>{c}</code>)}
      </div>
      <div className="settings__row">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigator.clipboard.writeText(text).then(() => toast.info("Codes copied"))}>
          <Copy size={14} /> Copy
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => download(`aurelia-recovery-codes-${stamp()}.txt`, `Aurelia recovery codes\n\n${text}\n`, "text/plain")}>
          <Download size={14} /> Download
        </button>
        <button type="button" className="btn btn--primary btn--sm" onClick={onDone}>I've saved them</button>
      </div>
    </div>
  );
}

function TwoFactor() {
  const { profile, refreshProfile } = useVault();
  const enabled = profile?.twoFactorEnabled;
  const [step, setStep] = useState("idle"); // idle | password | scan | codes | disable | regen
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState(null);
  const [qr, setQr] = useState("");
  const [codes, setCodes] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (setup?.otpauthUrl) {
      QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 220, color: { dark: "#1e1b4b", light: "#ffffff" } }).then(setQr);
    }
  }, [setup]);

  const reset = () => {
    setStep("idle");
    setPassword("");
    setCode("");
    setSetup(null);
    setQr("");
  };

  const run = async (fn) => {
    try {
      setBusy(true);
      await fn();
    } catch (err) {
      toast.error(api.errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (step === "codes") {
    return (
      <RecoveryCodes
        codes={codes}
        onDone={() => {
          setCodes([]);
          reset();
          refreshProfile();
        }}
      />
    );
  }

  if (enabled) {
    return (
      <div>
        <p className="settings__status settings__status--on">
          <ShieldCheck size={16} /> Two-factor login is on · {profile.recoveryCodesLeft} recovery code{profile.recoveryCodesLeft === 1 ? "" : "s"} left
        </p>
        {step === "disable" || step === "regen" ? (
          <form
            className="settings__form"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                if (step === "disable") {
                  await api.twoFactorDisable({ password, code });
                  toast.success("Two-factor login turned off.");
                  reset();
                  refreshProfile();
                } else {
                  const res = await api.twoFactorRecoveryCodes({ password, code });
                  setCodes(res.data.recoveryCodes);
                  setStep("codes");
                }
              });
            }}
          >
            <Field id="tf-pass" label="Master password" secret value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            <Field id="tf-code" label="Authenticator or recovery code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" />
            <div className="settings__row">
              <button type="button" className="btn btn--ghost btn--sm" onClick={reset}>Cancel</button>
              <button type="submit" className={`btn btn--sm ${step === "disable" ? "btn--danger" : "btn--primary"}`} disabled={busy || !password || !code}>
                {busy ? <span className="spinner" /> : null} {step === "disable" ? "Turn off 2FA" : "New recovery codes"}
              </button>
            </div>
          </form>
        ) : (
          <div className="settings__row">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setStep("regen")}>New recovery codes</button>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => setStep("disable")}>Turn off</button>
          </div>
        )}
      </div>
    );
  }

  if (step === "idle") {
    return (
      <div>
        <p className="settings__status">Add a second step to sign-in with Google Authenticator, Aegis, Authy or 1Password.</p>
        <button type="button" className="btn btn--primary btn--sm" onClick={() => setStep("password")}>
          <ShieldCheck size={14} /> Turn on two-factor login
        </button>
      </div>
    );
  }

  if (step === "password") {
    return (
      <form
        className="settings__form"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const res = await api.twoFactorSetup(password);
            setSetup(res.data);
            setStep("scan");
          });
        }}
      >
        <Field id="tf-setup-pass" label="Confirm your master password" secret value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="current-password" />
        <div className="settings__row">
          <button type="button" className="btn btn--ghost btn--sm" onClick={reset}>Cancel</button>
          <button type="submit" className="btn btn--primary btn--sm" disabled={busy || !password}>
            {busy ? <span className="spinner" /> : null} Continue
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      className="settings__form twofa"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const res = await api.twoFactorEnable(code);
          setCodes(res.data.recoveryCodes);
          setStep("codes");
          toast.success("Two-factor login is on 🔐");
        });
      }}
    >
      <div className="twofa__scan">
        {qr ? <img src={qr} alt="QR code for your authenticator app" width="180" height="180" /> : <span className="spinner spinner--accent" />}
        <div>
          <p>1. Scan this with your authenticator app, or enter the key:</p>
          <code className="twofa__secret">{setup?.secret?.match(/.{1,4}/g)?.join(" ")}</code>
          <p>2. Enter the 6-digit code it shows.</p>
        </div>
      </div>
      <Field id="tf-enable-code" label="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" autoFocus />
      <div className="settings__row">
        <button type="button" className="btn btn--ghost btn--sm" onClick={reset}>Cancel</button>
        <button type="submit" className="btn btn--primary btn--sm" disabled={busy || code.replace(/\s/g, "").length !== 6}>
          {busy ? <span className="spinner" /> : null} Verify and turn on
        </button>
      </div>
    </form>
  );
}

function ChangeMasterPassword() {
  const { changeMasterPassword, profile } = useVault();
  const [form, setForm] = useState({ current: "", next: "", confirm: "", code: "" });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const strength = estimate(form.next);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (form.next.length < 8) return toast.error("Use at least 8 characters.");
    if (strength.score < 2) return toast.error("Choose a stronger master password.");
    if (form.next !== form.confirm) return toast.error("The new passwords don't match.");
    try {
      setBusy(true);
      await changeMasterPassword({ current: form.current, next: form.next, code: form.code });
      toast.success("Master password changed. Every item was re-encrypted and other devices were signed out.");
      setForm({ current: "", next: "", confirm: "", code: "" });
      setOpen(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(true)}>
        <KeyLine size={14} /> Change master password
      </button>
    );
  }

  return (
    <form className="settings__form settings__form--full" onSubmit={submit}>
      <Field id="mp-current" label="Current master password" secret value={form.current} onChange={set("current")} autoComplete="current-password" />
      <Field id="mp-next" label="New master password" secret value={form.next} onChange={set("next")} autoComplete="new-password" />
      {form.next ? <StrengthMeter strength={strength} /> : null}
      <Field id="mp-confirm" label="Confirm new master password" secret value={form.confirm} onChange={set("confirm")} autoComplete="new-password" />
      {profile?.twoFactorEnabled ? <Field id="mp-code" label="Authenticator code" value={form.code} onChange={set("code")} autoComplete="one-time-code" /> : null}
      <p className="field__note">Every item is decrypted and re-encrypted with the new key on this device, then saved in one step.</p>
      <div className="settings__row">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(false)}>Cancel</button>
        <button type="submit" className="btn btn--primary btn--sm" disabled={busy || !form.current || !form.next}>
          {busy ? <span className="spinner" /> : null} {busy ? "Re-encrypting…" : "Change password"}
        </button>
      </div>
    </form>
  );
}

function ExportData() {
  const { items } = useVault();
  const [mode, setMode] = useState(null); // backup | csv
  const [pass, setPass] = useState({ a: "", b: "" });
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  const backup = async (e) => {
    e.preventDefault();
    if (pass.a.length < 8) return toast.error("Use at least 8 characters for the backup password.");
    if (pass.a !== pass.b) return toast.error("Passwords don't match.");
    try {
      setBusy(true);
      const clean = items.map(({ id, createdAt, updatedAt, ...rest }) => rest);
      download(`aurelia-backup-${stamp()}.aurelia`, await exportBackup(clean, pass.a), "application/json");
      toast.success("Encrypted backup downloaded.");
      setMode(null);
      setPass({ a: "", b: "" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="settings__row">
        <button type="button" className="btn btn--primary btn--sm" onClick={() => setMode("backup")} disabled={!items.length}>
          <Download size={14} /> Encrypted backup
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setMode("csv")} disabled={!items.length}>
          <Download size={14} /> Plain CSV
        </button>
      </div>
      {mode === "backup" ? (
        <form className="settings__form" onSubmit={backup}>
          <p className="field__note">The file is encrypted with a separate password. You'll need it to import the backup.</p>
          <Field id="bk-a" label="Backup password" secret value={pass.a} onChange={(e) => setPass((p) => ({ ...p, a: e.target.value }))} autoComplete="new-password" />
          <Field id="bk-b" label="Confirm backup password" secret value={pass.b} onChange={(e) => setPass((p) => ({ ...p, b: e.target.value }))} autoComplete="new-password" />
          <div className="settings__row">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setMode(null)}>Cancel</button>
            <button type="submit" className="btn btn--primary btn--sm" disabled={busy}>
              {busy ? <span className="spinner" /> : null} Download backup
            </button>
          </div>
        </form>
      ) : null}
      {mode === "csv" ? (
        <div className="settings__form">
          <label className="consent">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>
              <Alert size={14} /> A CSV is <strong>not encrypted</strong>. Anyone who gets the file can read every password. Delete it once you've used it.
            </span>
          </label>
          <div className="settings__row">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setMode(null)}>Cancel</button>
            <button
              type="button"
              className="btn btn--danger btn--sm"
              disabled={!ack}
              onClick={() => {
                download(`aurelia-export-${stamp()}.csv`, toCSV(items), "text/csv");
                setMode(null);
                setAck(false);
              }}
            >
              Download CSV
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DeleteAccount() {
  const { profile, logout } = useVault();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ password: "", code: "", confirm: "" });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    try {
      setBusy(true);
      await api.deleteAccount({ password: form.password, code: form.code || undefined });
      await logout();
      toast.success("Your account and vault were deleted.");
      navigate("/", { replace: true });
    } catch (err) {
      toast.error(api.errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="btn btn--quiet btn--sm settings__danger-btn" onClick={() => setOpen(true)}>
        <Trash size={14} /> Delete my account
      </button>
    );
  }
  return (
    <form className="settings__form" onSubmit={submit}>
      <p className="notice notice--err">
        <Alert size={15} /> This permanently deletes your account and every item in your vault. It can't be undone.
      </p>
      <Field id="del-pass" label="Master password" secret value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} autoComplete="current-password" />
      {profile?.twoFactorEnabled ? (
        <Field id="del-code" label="Authenticator code" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
      ) : null}
      <Field id="del-confirm" label='Type "DELETE" to confirm' value={form.confirm} onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))} />
      <div className="settings__row">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(false)}>Cancel</button>
        <button type="submit" className="btn btn--danger btn--sm" disabled={busy || form.confirm !== "DELETE" || !form.password}>
          {busy ? <span className="spinner" /> : <Trash size={14} />} Delete forever
        </button>
      </div>
    </form>
  );
}

export default function Settings() {
  const { profile, prefs, setPrefs, lock, importItems, setProfileName, refreshProfile } = useVault();
  const [name, setName] = useState(profile?.name || "");
  const [importing, setImporting] = useState(false);

  const saveName = async (e) => {
    e.preventDefault();
    try {
      await api.updateProfile(name.trim());
      setProfileName(name.trim());
      toast.success("Name updated.");
    } catch (err) {
      toast.error(api.errorMessage(err));
    }
  };

  const signOutOthers = async () => {
    try {
      await api.logoutEverywhere();
      await refreshProfile();
      toast.success("Signed out of every other device.");
    } catch (err) {
      toast.error(api.errorMessage(err));
    }
  };

  return (
    <div className="settings page">
      <Ambience petals={false} />
      <div className="shell-narrow">
        <header className="settings__top anim-fade-up">
          <Link to="/passwords" className="btn btn--quiet btn--sm">
            <Arrow size={14} style={{ transform: "rotate(180deg)" }} /> Back to vault
          </Link>
          <h1 className="vault__title">Settings</h1>
          <p className="vault__count">{profile?.email}</p>
        </header>

        <div className="settings__grid">
          <Section icon={<User size={18} />} title="Profile" sub="How Aurelia greets you.">
            <form className="settings__inline" onSubmit={saveName}>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" maxLength={80} />
              <button type="submit" className="btn btn--ghost btn--sm" disabled={!name.trim() || name.trim() === profile?.name}>Save</button>
            </form>
          </Section>

          <Section icon={<Globe size={18} />} title="Appearance" sub="Make it yours.">
            <div className="settings__line">
              <span>Theme</span>
              <ThemeToggle />
            </div>
            <Toggle
              checked={prefs.icons}
              onChange={(v) => setPrefs({ icons: v })}
              label="Show website icons. Icons are fetched from DuckDuckGo, which can see which sites you have saved."
            />
          </Section>

          <Section icon={<ShieldCheck size={18} />} title="Two-factor login" sub="Protect your account even if your master password leaks.">
            <TwoFactor />
          </Section>

          <Section icon={<LockLine size={18} />} title="Security" sub="Your master password never leaves this device.">
            <div className="settings__line">
              <span><Timer size={14} /> Auto-lock after inactivity</span>
              <select className="input settings__select" value={prefs.autoLock} onChange={(e) => setPrefs({ autoLock: Number(e.target.value) })}>
                <option value={1}>1 minute</option>
                <option value={5}>5 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={60}>1 hour</option>
                <option value={0}>Never</option>
              </select>
            </div>
            <div className="settings__row">
              <ChangeMasterPassword />
              <button type="button" className="btn btn--ghost btn--sm" onClick={lock}><LockLine size={14} /> Lock now</button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={signOutOthers}>
                <Logout size={14} /> Sign out other devices ({Math.max(0, (profile?.sessions || 1) - 1)})
              </button>
            </div>
          </Section>

          <Section icon={<Download size={18} />} title="Your data" sub="Take it anywhere. Bring it back anytime.">
            <ExportData />
            <div className="settings__row" style={{ marginTop: "0.8rem" }}>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setImporting(true)}><Upload size={14} /> Import</button>
              <Link to="/privacy" className="btn btn--quiet btn--sm">Privacy policy</Link>
            </div>
          </Section>

          <Section icon={<Trash size={18} />} title="Danger zone" sub="Permanent actions." danger>
            <DeleteAccount />
          </Section>
        </div>
      </div>
      <ImportModal open={importing} onClose={() => setImporting(false)} onImport={importItems} />
    </div>
  );
}
