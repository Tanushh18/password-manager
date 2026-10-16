import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import QRCode from "qrcode";
import Field from "../../Components/Field/Field";
import StrengthMeter from "../../Components/StrengthMeter/StrengthMeter";
import ThemeToggle from "../../Components/ThemeToggle/ThemeToggle";
import ImportModal from "../../Components/Item/ImportModal";
import { ShieldCheck, LockLine, User, Globe, Download, Upload, Trash, Copy, Check, Logout, Arrow, Alert, KeyLine } from "../../Components/Icons/Icons";
import * as api from "../../api/client";
import { exportBackup } from "../../lib/crypto";
import { toCSV } from "../../lib/items";
import { estimate } from "../../lib/strength";
import { useVault } from "../../state/vault";
import "./Settings.css";

import MascotBanner from "../../Components/Robot/MascotBanner";
import { accountMood } from "../../lib/pageMoods";
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
const ADMIN_EMAIL = "tanushchawla16@gmail.com";

/* Grouped list: a small heading, then a card of rows split by dividers. */
function Group({ title, children, danger }) {
  return (
    <section className="sgroup">
      <h2 className={`sgroup__title ${danger ? "is-danger" : ""}`}>{title}</h2>
      <div className={`sgroup__card card ${danger ? "sgroup__card--danger" : ""}`}>{children}</div>
    </section>
  );
}

/* One row: label (+ hint) on the left, control on the right. `block` puts the control underneath. */
function Row({ icon, label, hint, children, block }) {
  return (
    <div className={`srow ${block ? "srow--block" : ""}`}>
      <div className="srow__text">
        <span className="srow__label">{icon}{label}</span>
        {hint ? <span className="srow__hint">{hint}</span> : null}
      </div>
      {children ? <div className="srow__control">{children}</div> : null}
    </div>
  );
}

/* Where users say which of their variables belong to which service (and see what Stashr guessed). */
function ServiceMapCard() {
  return (
    <Group title="Services & usage mapping">
      <Row label="Tell Stashr which variable is which service" hint="Stashr guesses from variable names, values and your code. If it gets one wrong, or can’t tell, set it yourself: usage is then read from your choice, on every device.">
        <Link className="btn btn--ghost btn--sm" to="/services/map">Open mapping →</Link>
      </Row>
    </Group>
  );
}

/* Admin only: services users have that Stashr cannot read usage for yet. Built from what each user's own Services
   page found, so nothing scans anyone's servers; counts only, never identities, values or service names. */
function AdminNeedsPanel() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setBusy(true); setError("");
    try { setData(await api.getUsageNeeds()); }
    catch (e) { setError(api.errorMessage(e) || "Could not load the list."); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const list = data?.services || [];

  return (
    <Group title="Admin · Services that need a usage reader">
      <div className="settings-admin">
        <div className="settings-admin__head">
          <div><strong>Add a reader for these</strong><p className="srow__hint">Only services users actually have, found automatically or mapped by hand, where no usage reader exists yet. Your own account is left out. Variable and package names are what you need to write the reader.</p></div>
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void load()}>{busy ? "Loading…" : "↻ Refresh"}</button>
        </div>
        {error && <p className="settings-admin__error" role="alert">{error}</p>}
        {data && !list.length && <p className="settings-admin__empty">Nothing waiting: every service users have already has a usage reader (or nothing to track).</p>}
        {list.map((item) => (
          <article className="settings-admin__service" key={item.key}>
            <div className="settings-admin__service-title">
              <div><strong>{item.label}</strong><small>{item.category} · {item.userCount} user{item.userCount === 1 ? "" : "s"} · last seen {new Date(item.lastSeenAt).toLocaleDateString()}</small></div>
            </div>
            {item.vars?.length > 0 && <div className="settings-admin__vars">{item.vars.map((name) => <code key={name}>{name}</code>)}</div>}
            {item.packages?.length > 0 && <small className="srow__hint">Packages: {item.packages.join(", ")}</small>}
          </article>
        ))}
        <h3>Services that already have a usage reader</h3>
        <div className="settings-admin__providers">{(data?.usageReaders || []).map((provider) => <span className="settings-admin__provider" key={provider.key}><strong>{provider.label}</strong><small>{provider.category}</small></span>)}</div>
      </div>
    </Group>
  );
}

/* Telegram bot: paste the token, press Start in the bot, done. */
function TelegramBot() {
  const [state, setState] = useState(null);
  const [token, setToken] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => { try { setState(await api.getTelegram()); } catch { setState({ connected: false }); } }, []);
  useEffect(() => { void load(); }, [load]);
  // While waiting for "Start" in Telegram, check every few seconds.
  useEffect(() => {
    if (!state?.linkUrl || state.connected) return undefined;
    const t = window.setInterval(() => { void load(); }, 4000);
    return () => window.clearInterval(t);
  }, [state?.linkUrl, state?.connected, load]);
  const run = async (key, fn, ok) => {
    setBusy(key);
    try { const r = await fn(); if (r && typeof r === "object" && "connected" in r) setState(r); if (ok) toast.success(ok); }
    catch (e) { toast.error(api.errorMessage(e, "That did not work.")); }
    finally { setBusy(""); }
  };
  if (!state) return <Row label="Telegram bot" hint="Loading…" />;
  if (!state.connected && !state.linkUrl) return (
    <Row icon={<Alert size={15} />} label="Connect your Telegram bot" hint="Create a bot with @BotFather, paste its token here. You get server alerts, a status update every 10 minutes and answers to /status, /servers, /projects, /pass." block>
      <form className="settings__inline" onSubmit={(e) => { e.preventDefault(); void run("connect", () => api.connectTelegram(token), "Bot connected — now press Start in Telegram."); }}>
        <input className="input" type="password" autoComplete="off" placeholder="123456789:AA…" value={token} onChange={(e) => setToken(e.target.value)} aria-label="Bot token" />
        <button className="btn btn--primary btn--sm" disabled={!token.trim() || Boolean(busy)}>{busy === "connect" ? "Connecting…" : "Connect"}</button>
      </form>
    </Row>
  );
  if (!state.connected) return (
    <Row icon={<Alert size={15} />} label={"Last step: open @" + state.botUsername + " and press Start"} hint="This links the bot to your Telegram chat. Only that chat will ever be answered." block>
      <div className="settings__inline">
        <a className="btn btn--primary btn--sm" href={state.linkUrl} target="_blank" rel="noopener noreferrer">Open Telegram and press Start</a>
        <span className="srow__hint">Waiting… this page updates by itself.</span>
      </div>
    </Row>
  );
  return (
    <>
      <Row icon={<Alert size={15} />} label={"Connected to @" + state.botUsername} hint={"Chat: " + (state.chatName || "you") + (state.updates === "timer" && state.lastDigestAt ? " · last update " + new Date(state.lastDigestAt).toLocaleTimeString() : "")}>
        <div className="settings__inline">
          <button type="button" className="btn btn--ghost btn--sm" disabled={Boolean(busy)} onClick={() => void run("test", api.testTelegramBot, "Status sent to Telegram.")}>Send status now</button>
          <button type="button" className="btn btn--ghost btn--sm" disabled={Boolean(busy)} onClick={() => { if (window.confirm("Disconnect the Telegram bot? Alerts stop.")) void run("off", api.disconnectTelegram, "Disconnected."); }}>Disconnect</button>
        </div>
      </Row>
      <Row label="When should the bot message me?" hint="Off by default: it stays quiet unless you ask. You can always ask in Telegram with the menu buttons under the chat box, or /updates." block>
        <div className="settings__modes" role="radiogroup" aria-label="When the bot messages you">
          {[
            ["ask", "🔕 Only when I ask", "No automatic messages at all, not even alerts."],
            ["alerts", "🚨 Alerts only", "A message when something breaks. No timed updates."],
            ["timer", "⏱ Alerts + a timed update", "A short status every few minutes (you choose how often)."]
          ].map(([id, title, text]) => (
            <label key={id} className={"settings__mode" + (state.updates === id ? " is-on" : "")}>
              <input type="radio" name="tg-updates" checked={state.updates === id} disabled={Boolean(busy)} onChange={() => void run("u", () => api.saveTelegram({ updates: id }), id === "ask" ? "The bot only answers when you ask." : id === "alerts" ? "Alerts only." : "Timed updates on.")} />
              <span><strong>{title}</strong><small>{text}</small></span>
            </label>
          ))}
        </div>
        {state.updates === "timer" && (
          <div className="settings__inline settings__modes-more">
            <select className="input settings__select" value={state.digestMinutes} onChange={(e) => void run("d", () => api.saveTelegram({ digestMinutes: Number(e.target.value) }))} aria-label="How often">
              {[5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>Every {m} min</option>)}
            </select>
            <label className="srow__hint"><input type="checkbox" checked={state.digestQuietWhenOk} onChange={(e) => void run("q", () => api.saveTelegram({ digestQuietWhenOk: e.target.checked }))} /> Only when something is wrong</label>
          </div>
        )}
      </Row>
      <Row label="Passwords over Telegram" hint="Off by default. When on, /pass name PIN returns a login; the reply and your PIN message are deleted after 60 seconds. Telegram chats are not end-to-end encrypted.">
        <Toggle checked={state.passwordsAllowed} onChange={(v) => void run("p", () => api.saveTelegram({ passwordsAllowed: v }), v ? "Passwords on — keep your PIN private." : "Passwords off.")} label="" />
      </Row>
      <Row label={state.pinSet ? "Change PIN" : "Set a PIN (needed for passwords)"} hint="4 to 8 digits. 5 wrong tries lock passwords for 15 minutes.">
        <form className="settings__inline" onSubmit={(e) => { e.preventDefault(); void run("pin", () => api.saveTelegram({ pin }), "PIN saved."); setPin(""); }}>
          <input className="input" type="password" inputMode="numeric" pattern="[0-9]{4,8}" placeholder="••••" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} aria-label="PIN" style={{ width: "7rem" }} />
          <button className="btn btn--ghost btn--sm" disabled={pin.length < 4 || Boolean(busy)}>Save PIN</button>
        </form>
      </Row>
    </>
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
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => download(`aurelia-recovery-codes-${stamp()}.txt`, `Stashr recovery codes\n\n${text}\n`, "text/plain")}>
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
  const { changePassword, profile } = useVault();
  const [form, setForm] = useState({ current: "", next: "", confirm: "", code: "" });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const strength = estimate(form.next);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (form.next.length < 8) return toast.error("Use at least 8 characters.");
    if (strength.score < 2) return toast.error("Choose a stronger password.");
    if (form.next !== form.confirm) return toast.error("The new passwords don't match.");
    try {
      setBusy(true);
      await changePassword({ current: form.current, next: form.next, code: form.code });
      toast.success("Password changed. Other devices were signed out.");
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
        <KeyLine size={14} /> Change password
      </button>
    );
  }

  return (
    <form className="settings__form settings__form--full" onSubmit={submit}>
      <Field id="mp-current" label="Current password" secret value={form.current} onChange={set("current")} autoComplete="current-password" />
      <Field id="mp-next" label="New password" secret value={form.next} onChange={set("next")} autoComplete="new-password" />
      {form.next ? <StrengthMeter strength={strength} /> : null}
      <Field id="mp-confirm" label="Confirm new password" secret value={form.confirm} onChange={set("confirm")} autoComplete="new-password" />
      {profile?.twoFactorEnabled ? <Field id="mp-code" label="Authenticator code" value={form.code} onChange={set("code")} autoComplete="one-time-code" /> : null}
      <div className="settings__row">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(false)}>Cancel</button>
        <button type="submit" className="btn btn--primary btn--sm" disabled={busy || !form.current || !form.next}>
          {busy ? <span className="spinner" /> : null} {busy ? "Saving…" : "Change password"}
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
      <div className="shell-narrow">
        <header className="settings__top">
          <Link to="/passwords" className="proj-back">
            <Arrow size={14} style={{ transform: "rotate(180deg)" }} /> Vault
          </Link>
          <h1 className="vault__title">Settings</h1>
          <p className="vault__count">{profile?.email}</p>
        </header>

        <MascotBanner kind="gear" {...accountMood(profile)} />
        <Group title="Account">
          <Row icon={<User size={15} />} label="Name" hint="How Stashr greets you.">
            <form className="settings__inline" onSubmit={saveName}>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" maxLength={80} />
              <button type="submit" className="btn btn--ghost btn--sm" disabled={!name.trim() || name.trim() === profile?.name}>Save</button>
            </form>
          </Row>
          <Row icon={<LockLine size={15} />} label="Master password" hint="Changing it signs out your other devices." block>
            <ChangeMasterPassword />
          </Row>
          <Row icon={<Logout size={15} />} label="Other devices" hint={`${Math.max(0, (profile?.sessions || 1) - 1)} other signed-in session(s).`}>
            <button type="button" className="btn btn--ghost btn--sm" onClick={signOutOthers}>Sign out others</button>
          </Row>
        </Group>

        <Group title="Two-factor login">
          <Row icon={<ShieldCheck size={15} />} label="Authenticator app" hint="Protects your account even if your password leaks." block>
            <TwoFactor />
          </Row>
        </Group>

        

        <Group title="Telegram">
          <TelegramBot />
        </Group>

        <ServiceMapCard />
        {(profile?.isAdmin || String(profile?.email || "").trim().toLowerCase() === ADMIN_EMAIL) && <AdminNeedsPanel />}

        <Group title="Security">
          <Row icon={<LockLine size={15} />} label="Lock now" hint="Sign out of this device now. You stay signed in otherwise, until you lock or sign out yourself.">
            <button type="button" className="btn btn--ghost btn--sm" onClick={lock}>Lock</button>
          </Row>
          <Row label="Show values in project search" hint="When off, matching secret values stay hidden (••••) until you tap the eye.">
            <Toggle checked={prefs.searchValues} onChange={(v) => setPrefs({ searchValues: v })} label="" />
          </Row>
        </Group>

        <Group title="Appearance">
          <Row icon={<Globe size={15} />} label="Theme">
            <ThemeToggle />
          </Row>
          <Row label="Website icons" hint="Fetched from DuckDuckGo, which can see which sites you have saved.">
            <Toggle checked={prefs.icons} onChange={(v) => setPrefs({ icons: v })} label="" />
          </Row>
        </Group>

        <Group title="Your data">
          <Row icon={<Download size={15} />} label="Export" hint="Take it anywhere." block>
            <ExportData />
          </Row>
          <Row icon={<Upload size={15} />} label="Import" hint="From a backup, CSV or another password manager.">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setImporting(true)}>Import</button>
          </Row>
          <Row label="Privacy policy">
            <Link to="/privacy" className="btn btn--quiet btn--sm">Open</Link>
          </Row>
        </Group>

        <Group title="Danger zone" danger>
          <Row icon={<Trash size={15} />} label="Delete account" hint="Permanently deletes your account and vault." block>
            <DeleteAccount />
          </Row>
        </Group>
      </div>
      <ImportModal open={importing} onClose={() => setImporting(false)} onImport={importItems} />
    </div>
  );
}
