import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import Ambience from "../../Components/Ambience/Ambience";
import ServiceStatus from "../../Components/ServiceStatus/ServiceStatus";
import { useParallax } from "../../hooks/useReveal";
import Reveal from "../../Components/Reveal/Reveal";
import {
  ShieldLine,
  LockLine,
  KeyLine,
  Sparkle,
  Arrow,
  Flourish,
} from "../../Components/Icons/Icons";
import "./Home.css";

const PRINCIPLES = [
  {
    icon: <LockLine size={24} />,
    title: "AES-256 encryption",
    body: "Every credential is encrypted before it reaches the database, with a key that never leaves the server.",
  },
  {
    icon: <ShieldLine size={24} />,
    title: "Yours alone",
    body: "No trackers, no adverts, no third-party sharing. Your vault is readable by you and nobody else.",
  },
  {
    icon: <KeyLine size={24} />,
    title: "On every device",
    body: "Install it as an app, import an existing spreadsheet, and reach your vault from anywhere you work.",
  },
];

const STEPS = [
  { n: "01", title: "Create an account", body: "One account and one master password — the only credential you need to remember." },
  { n: "02", title: "Add your credentials", body: "Save a platform, an email and a password, or import an entire spreadsheet in one go." },
  { n: "03", title: "Access them anywhere", body: "Reveal or copy any password in a tap, from any device you are signed in on." },
];

function Home() {
  const { name, isAuthenticated, passwords } = useSelector((state) => state);
  const [mounted, setMounted] = useState(false);
  const visualRef = useRef(null);

  useParallax(visualRef, 0.05);

  useEffect(() => {
    const id = window.setTimeout(() => setMounted(true), 60);
    return () => window.clearTimeout(id);
  }, []);

  const firstName = (name || "").split(" ")[0];
  const count = passwords?.length || 0;

  return (
    <div className="home">
      <Ambience />

      {/* ══════════ HERO ══════════ */}
      <section className="hero">
        <div className="hero__inner shell">
          <div className={`hero__copy ${mounted ? "anim-fade-up" : ""}`}>
            <span className="hero__eyebrow pill">
              <ShieldLine size={13} />
              {isAuthenticated ? "Vault unlocked" : "Encrypted password manager"}
            </span>

            {isAuthenticated ? (
              <h1 className="display hero__title">
                Welcome back,
                <br />
                <em>{firstName || "there"}.</em>
              </h1>
            ) : (
              <h1 className="display hero__title">
                Every password,
                <br />
                <em>encrypted end to end.</em>
              </h1>
            )}

            <p className="lede hero__lede">
              {isAuthenticated ? (
                <>
                  Your vault is unlocked. {count > 0 ? (
                    <>
                      <strong>{count}</strong> credential{count === 1 ? " is" : "s are"} stored and
                      encrypted.
                    </>
                  ) : (
                    <>It is empty for now — add your first credential to get started.</>
                  )}
                </>
              ) : (
                <>
                  Aurelia stores your credentials behind AES-256 encryption. Encrypted the moment
                  you save them, decrypted only when you ask — never shared, never sold.
                </>
              )}
            </p>

            <div className="hero__actions">
              {isAuthenticated ? (
                <>
                  <Link to="/passwords" className="btn btn--primary btn--lg">
                    Open my vault
                    <Arrow size={16} />
                  </Link>
                  <Link to="/logout" className="btn btn--ghost btn--lg">
                    Sign out
                  </Link>
                </>
              ) : (
                <>
                  <Link to="/signup" className="btn btn--primary btn--lg">
                    Create your vault
                    <Arrow size={16} />
                  </Link>
                  <Link to="/signin" className="btn btn--ghost btn--lg">
                    I already have one
                  </Link>
                </>
              )}
            </div>

            <div className="hero__meta">
              <ServiceStatus />
              <span className="hero__meta-note">
                <Sparkle size={13} /> Free · no tracking
              </span>
            </div>
          </div>

          {/* ── Vault preview ── */}
          <div className="hero__visual" ref={visualRef} aria-hidden="true">
            <div className="vault-preview">
              <span className="vault-preview__halo" />

              <div className="vault-preview__card card">
                <span className="card__ribbon" />

                <div className="vault-preview__head">
                  <span className="vault-preview__seal">
                    <LockLine size={18} strokeWidth={1.4} />
                  </span>
                  <span className="vault-preview__heading">
                    <span className="vault-preview__label eyebrow">Aurelia vault</span>
                    <span className="vault-preview__line">
                      {isAuthenticated ? `${count} credential${count === 1 ? "" : "s"} secured` : "AES-256 · encrypted at rest"}
                    </span>
                  </span>
                </div>

                <div className="vault-preview__rows">
                  {[
                    { label: "github.com", mask: "•••••••••••" },
                    { label: "mail.google.com", mask: "••••••••" },
                    { label: "aws.amazon.com", mask: "•••••••••••••" },
                  ].map((row, i) => (
                    <div className="vault-preview__row" key={row.label} style={{ animationDelay: `${0.3 + i * 0.12}s` }}>
                      <span className="vault-preview__chip">
                        <KeyLine size={13} />
                      </span>
                      <span className="vault-preview__entry">
                        <span className="vault-preview__site">{row.label}</span>
                        <span className="vault-preview__mask">{row.mask}</span>
                      </span>
                      <span className="vault-preview__lock">
                        <LockLine size={13} />
                      </span>
                    </div>
                  ))}
                </div>

                <div className="vault-preview__foot">
                  <span className="dot dot--live" />
                  encrypted just now
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════ PRINCIPLES ══════════ */}
      <section className="section shell">
        <Reveal as="header" className="section__head">
          <span className="eyebrow">Why Aurelia</span>
          <h2 className="section__title">
            Security you can <em className="serif-em">actually verify</em>
          </h2>
          <p className="lede section__lede">
            No dark patterns and no surprises — just the guarantees a password manager owes you.
          </p>
        </Reveal>

        <div className="promises">
          {PRINCIPLES.map((p, i) => (
            <Reveal as="article" className="promise card card--hover" key={p.title} delay={i * 0.09}>
              <span className="promise__icon">{p.icon}</span>
              <h3 className="promise__title">{p.title}</h3>
              <p className="promise__body">{p.body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ══════════ STEPS ══════════ */}
      <section className="section shell">
        <Reveal as="header" className="section__head">
          <span className="eyebrow">How it works</span>
          <h2 className="section__title">
            Set up in <em className="serif-em">three steps</em>
          </h2>
        </Reveal>

        <ol className="steps">
          {STEPS.map((s, i) => (
            <Reveal as="li" className="step" key={s.n} delay={i * 0.1}>
              <span className="step__n">{s.n}</span>
              <h3 className="step__title">{s.title}</h3>
              <p className="step__body">{s.body}</p>
            </Reveal>
          ))}
        </ol>
      </section>

      {/* ══════════ CLOSING ══════════ */}
      <section className="section shell">
        <Reveal className="closing card" variant="reveal--scale">
          <span className="card__ribbon" />
          <div className="ornament closing__ornament">
            <Flourish width={150} />
          </div>
          <p className="closing__quote">
            Strong, unique passwords everywhere —<br />
            <em>without memorising a single one.</em>
          </p>
          <div className="closing__cta">
            <Link to={isAuthenticated ? "/passwords" : "/signup"} className="btn btn--primary btn--lg">
              {isAuthenticated ? "Open my vault" : "Create your vault"}
              <Arrow size={16} />
            </Link>
          </div>
        </Reveal>
      </section>

      <footer className="foot">
        <span className="foot__mark">
          <ShieldLine size={15} />
          Aurelia
        </span>
        <span className="foot__note">Encrypted with AES-256 · No tracking, no adverts</span>
      </footer>
    </div>
  );
}

export default Home;
