import React from "react";
import { Link } from "react-router-dom";
import { useVault } from "../../state/vault";
import ServiceStatus from "../../Components/ServiceStatus/ServiceStatus";
import { LockLine, ShieldLine, KeyLine, Globe, Arrow, Copy } from "../../Components/Icons/Icons";
import "./Home.css";

const FEATURES = [
  {
    icon: <LockLine size={20} />,
    title: "Encrypted storage",
    body: "Every item is sealed with AES-256-GCM using a key unique to your account before it is written to the database.",
  },
  {
    icon: <ShieldLine size={20} />,
    title: "Vault health",
    body: "Spots weak, reused, old and breached passwords (checked with Have I Been Pwned) so you know what to fix first.",
  },
  {
    icon: <Globe size={20} />,
    title: "Projects",
    body: "Keep hosting, databases and env vars for every project in one tree. Search MONGO_URI and get the value.",
  },
  {
    icon: <KeyLine size={20} />,
    title: "Web, Android, Chrome",
    body: "Same account everywhere. Android autofill and a Chrome extension fill logins for you.",
  },
];

const STEPS = [
  { title: "Create an account", body: "One email and one password to remember." },
  { title: "Add or import", body: "Type logins in, or import a CSV from Chrome, Bitwarden, 1Password or LastPass." },
  { title: "Use it anywhere", body: "Open it on the web, on your phone, or let autofill do it." },
];

const PREVIEW = [
  { name: "GitHub", user: "you@example.com", color: "#3b6fd6" },
  { name: "Netflix", user: "you@example.com", color: "#be185d" },
  { name: "HDFC Bank", user: "98•••••210", color: "#7c5cc4" },
];

const ANDROID_URL =
  import.meta.env.VITE_ANDROID_URL || import.meta.env.REACT_APP_ANDROID_URL || "https://github.com/tanushh18/password-manager/releases/latest";

function Home() {
  const { status, profile, items } = useVault();
  const signedIn = status === "ready" || status === "locked";
  const firstName = (profile?.name || "").split(" ")[0];
  const count = status === "ready" ? items.length : 0;

  return (
    <div className="hm">
      <section className="hm-hero shell">
        <div className="hm-hero__copy">
          {signedIn ? (
            <>
              <h1 className="hm-hero__title">Welcome back{firstName ? `, ${firstName}` : ""}.</h1>
              <p className="hm-hero__sub">
                {status === "locked"
                  ? "Your vault is locked on this device. Sign in again to open it."
                  : count > 0
                    ? `${count} item${count === 1 ? "" : "s"} in your vault.`
                    : "Your vault is empty. Add your first login to get started."}
              </p>
              <div className="hm-hero__actions">
                <Link to="/passwords" className="btn btn--primary btn--lg">Open vault <Arrow size={16} /></Link>
                <Link to="/projects" className="btn btn--ghost btn--lg">Projects</Link>
              </div>
            </>
          ) : (
            <>
              <h1 className="hm-hero__title">A simple, private home for your passwords.</h1>
              <p className="hm-hero__sub">
                Stashr keeps your logins, 2FA codes and project secrets encrypted, and fills them in for you on the web and on Android.
              </p>
              <div className="hm-hero__actions">
                <Link to="/signup" className="btn btn--primary btn--lg">Create free account <Arrow size={16} /></Link>
                <Link to="/signin" className="btn btn--ghost btn--lg">Sign in</Link>
              </div>
            </>
          )}
          <div className="hm-hero__meta">
            <ServiceStatus />
            <span>Free · No ads</span>
          </div>
        </div>

        <div className="hm-preview card" aria-hidden="true">
          <div className="hm-preview__bar">
            <span className="hm-preview__search">Search…</span>
          </div>
          {PREVIEW.map((row) => (
            <div className="hm-preview__row" key={row.name}>
              <span className="hm-preview__avatar" style={{ background: row.color }}>{row.name[0]}</span>
              <span className="hm-preview__text">
                <strong>{row.name}</strong>
                <span>{row.user}</span>
              </span>
              <span className="hm-preview__copy"><Copy size={14} /></span>
            </div>
          ))}
          <div className="hm-preview__foot">
            <ShieldLine size={13} /> Encrypted with AES-256-GCM
          </div>
        </div>
      </section>

      <section className="hm-section shell">
        <h2 className="hm-section__title">What you get</h2>
        <div className="hm-features">
          {FEATURES.map((f) => (
            <article className="hm-feature card" key={f.title}>
              <span className="hm-feature__icon">{f.icon}</span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="hm-section shell">
        <h2 className="hm-section__title">How it works</h2>
        <ol className="hm-steps">
          {STEPS.map((s, i) => (
            <li className="hm-step" key={s.title}>
              <span className="hm-step__n">{i + 1}</span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="hm-section shell">
        <div className="hm-android card">
          <div>
            <h2 className="hm-section__title" style={{ marginBottom: "0.35rem" }}>Stashr for Android</h2>
            <p className="hm-android__body">Fingerprint unlock, one-tap copy and autofill in other apps. Same account as the website.</p>
          </div>
          <a className="btn btn--primary" href={ANDROID_URL} target="_blank" rel="noopener noreferrer">
            Get the app <Arrow size={15} />
          </a>
        </div>
      </section>

      <footer className="hm-foot shell">
        <span className="hm-foot__mark"><ShieldLine size={15} /> Stashr</span>
        <span>
          <Link to="/privacy">Privacy</Link> · Web, Android &amp; Chrome
        </span>
      </footer>
    </div>
  );
}

export default Home;
