import React from "react";
import { Link } from "react-router-dom";
import { useVault } from "../../state/vault";
import ServiceStatus from "../../Components/ServiceStatus/ServiceStatus";
import WorldScene from "../../Components/WorldScene/WorldScene";
import { LockLine, ShieldLine, ShieldCheck, KeyLine, Globe, Arrow, Grid, Folder } from "../../Components/Icons/Icons";
import "./Home.css";

/* Destination cards. `to` is used when signed in; signed-out visitors are
   sent to create an account first (these routes all require a vault). */
const DESTINATIONS = [
  {
    code: "VLT",
    icon: <LockLine size={20} />,
    title: "Vault",
    tag: "Secure destination",
    body: "Logins, 2FA codes and notes, each sealed with AES-256-GCM using a key unique to your account before it is stored.",
    to: "/passwords",
  },
  {
    code: "GEN",
    icon: <KeyLine size={20} />,
    title: "Generator",
    tag: "Secure creation station",
    body: "Create long, random passwords right where you save a login, so a strong one is always the easy choice.",
    to: "/passwords",
  },
  {
    code: "SEC",
    icon: <ShieldCheck size={20} />,
    title: "Security audit",
    tag: "Security checkpoint",
    body: "Spots weak, reused, old and breached passwords (checked with Have I Been Pwned) so you know what to fix first.",
    to: "/passwords",
  },
  {
    code: "PRJ",
    icon: <Folder size={20} />,
    title: "Projects",
    tag: "Every stack, one terminal",
    body: "Keep hosting, databases and env vars for every project in one tree. Search MONGO_URI and get the value.",
    to: "/projects",
  },
  {
    code: "CTL",
    icon: <Grid size={20} />,
    title: "Control Center",
    tag: "Your connected city",
    body: "Services, cron jobs and deploys for your infrastructure, watched from one place.",
    to: "/services",
  },
  {
    code: "APP",
    icon: <Globe size={20} />,
    title: "Web, Android, Chrome",
    tag: "Connections everywhere",
    body: "Same account everywhere. Android autofill and a Chrome extension fill logins for you.",
    to: "/apps",
    open: true,
  },
];

const STEPS = [
  { title: "Create an account", body: "One email and one password to remember." },
  { title: "Add or import", body: "Type logins in, or import a CSV from Chrome, Bitwarden, 1Password or LastPass." },
  { title: "Use it anywhere", body: "Open it on the web, on your phone, or let autofill do it." },
];

const ANDROID_URL =
  import.meta.env.VITE_ANDROID_URL || import.meta.env.REACT_APP_ANDROID_URL || "/apps";

function scrollToSecurity(e) {
  const el = document.getElementById("hm-destinations");
  if (!el) return;
  e.preventDefault();
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  el.focus({ preventScroll: true });
}

function Home() {
  const { status, profile, items } = useVault();
  const signedIn = status === "ready" || status === "locked";
  const firstName = (profile?.name || "").split(" ")[0];
  const count = status === "ready" ? items.length : 0;

  return (
    <div className="hm">
      <section className="hm-hero" aria-labelledby="hm-hero-title">
        <WorldScene variant="hero" className="hm-hero__scene" />
        <div className="hm-hero__scrim" aria-hidden="true" />

        <div className="hm-hero__inner shell">
          <div className="hm-hero__copy">
            <p className="hm-hero__eyebrow">
              {signedIn ? `Welcome back${firstName ? `, ${firstName}` : ""}` : "Stashr · Password manager"}
            </p>
            <h1 className="hm-hero__title" id="hm-hero-title">
              <span>Your Digital World.</span>
              <span className="hm-hero__title-2">One Secure Destination.</span>
            </h1>
            <p className="hm-hero__sub">
              Every password, every account, every connection — protected in one beautifully designed vault.
            </p>
            {signedIn && (
              <p className="hm-hero__state">
                {status === "locked"
                  ? "Your vault is locked on this device. Sign in again to open it."
                  : count > 0
                    ? `${count} item${count === 1 ? "" : "s"} in your vault.`
                    : "Your vault is empty. Add your first login to get started."}
              </p>
            )}
            <div className="hm-hero__actions">
              <Link to={signedIn ? "/passwords" : "/signup"} className="btn btn--primary btn--lg hm-cta">
                Open Your Vault <Arrow size={16} />
              </Link>
              <a href="#hm-destinations" onClick={scrollToSecurity} className="btn btn--ghost btn--lg hm-cta hm-cta--ghost">
                Explore Security
              </a>
            </div>
            <p className="hm-hero__links">
              {signedIn ? (
                <Link to="/projects">Go to Projects</Link>
              ) : (
                <>Already have an account? <Link to="/signin">Sign in</Link></>
              )}
            </p>
            <div className="hm-hero__meta">
              <ServiceStatus />
              <span>Free · No ads</span>
            </div>
            <p className="hm-hero__trust">
              <ShieldLine size={14} /> Your privacy. Your control. Your secure world.
            </p>
          </div>
        </div>
      </section>

      <section className="hm-section shell" id="hm-destinations" tabIndex={-1} aria-labelledby="hm-dest-title">
        <header className="hm-board-head">
          <span className="hm-board-head__label">Destinations</span>
          <h2 className="hm-section__title" id="hm-dest-title">Everything you protect, one terminal away</h2>
          <p className="hm-section__lede">
            Vault items are encrypted on our server with AES-256-GCM, using a per-account key that is itself wrapped by a server key.
          </p>
        </header>
        <ul className="hm-dests">
          {DESTINATIONS.map((d) => (
            <li key={d.code}>
              <Link className="hm-dest" to={signedIn || d.open ? d.to : "/signup"}>
                <span className="hm-dest__top">
                  <span className="hm-dest__code" aria-hidden="true">{d.code}</span>
                  <span className="hm-dest__icon" aria-hidden="true">{d.icon}</span>
                </span>
                <span className="hm-dest__title">{d.title}</span>
                <span className="hm-dest__tag">{d.tag}</span>
                <span className="hm-dest__body">{d.body}</span>
                <span className="hm-dest__go">
                  {signedIn || d.open ? "Go" : "Create account"} <Arrow size={14} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="hm-section shell" aria-labelledby="hm-steps-title">
        <h2 className="hm-section__title" id="hm-steps-title">How it works</h2>
        <ol className="hm-steps">
          {STEPS.map((s, i) => (
            <li className="hm-step" key={s.title}>
              <span className="hm-step__n">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="hm-section shell">
        <div className="hm-android">
          <WorldScene variant="strip" className="hm-android__scene" parallax={false} />
          <div className="hm-android__inner">
            <div>
              <h2 className="hm-section__title hm-android__title">Stashr for Android</h2>
              <p className="hm-android__body">Fingerprint unlock, one-tap copy and autofill in other apps. Same account as the website.</p>
            </div>
            <a className="btn btn--primary hm-cta" href={ANDROID_URL}>
              Get the app <Arrow size={15} />
            </a>
          </div>
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
