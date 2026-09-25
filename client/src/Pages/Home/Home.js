import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import Ambience from "../../Components/Ambience/Ambience";
import ServiceStatus from "../../Components/ServiceStatus/ServiceStatus";
import { useParallax } from "../../hooks/useReveal";
import Reveal from "../../Components/Reveal/Reveal";
import {
  LockLine,
  ShieldLine,
  KeyLine,
  Sparkle,
  Arrow,
  Flourish,
} from "../../Components/Icons/Icons";
import "./Home.css";

const PROMISES = [
  {
    icon: <LockLine size={26} />,
    title: "Sealed with AES-256",
    body: "Every secret is encrypted before it touches the database, and only your signed-in session can unseal it.",
  },
  {
    icon: <ShieldLine size={26} />,
    title: "Live vault health",
    body: "A real-time score spots weak, reused and stale passwords — and tells you exactly which ones to fix.",
  },
  {
    icon: <Sparkle size={26} />,
    title: "Generator built in",
    body: "One tap creates a strong, unique password with a live strength meter, right where you need it.",
  },
  {
    icon: <KeyLine size={26} />,
    title: "Web + Android",
    body: "The same vault on the web and in the Android app, with fingerprint unlock on your phone.",
  },
];

const STEPS = [
  { n: "01", title: "Create your vault", body: "One account, one master password. That is all you have to remember." },
  { n: "02", title: "Fill it up", body: "Add a password in seconds — or import a whole spreadsheet at once." },
  { n: "03", title: "Watch your score climb", body: "Fix what the health check flags and see your vault glow green." },
];

const GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*";

/** Ciphertext that keeps re-rolling, so the hero card feels alive. */
function Scramble({ length = 12, every = 90 }) {
  const [text, setText] = useState(() => "•".repeat(length));
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    const id = setInterval(() => {
      setText((prev) =>
        prev
          .split("")
          .map((c) => (Math.random() < 0.35 ? GLYPHS[Math.floor(Math.random() * GLYPHS.length)] : c))
          .join("")
      );
    }, every);
    return () => clearInterval(id);
  }, [every]);
  return <span className="keepsake__mask keepsake__mask--live">{text}</span>;
}

const ANDROID_URL =
  process.env.REACT_APP_ANDROID_URL || "https://github.com/tanushh18/password-manager/releases/latest";

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
              <Sparkle size={13} />
              {isAuthenticated ? "Vault unlocked" : "Encrypted · Live · Free"}
            </span>

            {isAuthenticated ? (
              <h1 className="display hero__title">
                Welcome back,
                <br />
                <em>{firstName || "friend"}.</em>
              </h1>
            ) : (
              <h1 className="display hero__title">
                Every password,
                <br />
                <em>glowing and safe.</em>
              </h1>
            )}

            <p className="lede hero__lede">
              {isAuthenticated ? (
                <>
                  Your vault is unlocked and waiting. {count > 0 ? (
                    <>
                      There {count === 1 ? "is" : "are"} <strong>{count}</strong> secret
                      {count === 1 ? "" : "s"} resting safely inside.
                    </>
                  ) : (
                    <>It is empty in there — add your first password and watch your health score light up.</>
                  )}
                </>
              ) : (
                <>
                  Aurelia is a beautiful, private vault for your passwords. AES-256 encryption,
                  a live health score, a built-in generator — on the web and on Android.
                </>
              )}
            </p>

            <div className="hero__actions">
              {isAuthenticated ? (
                <>
                  <Link to="/passwords" className="btn btn--primary btn--lg">
                    <span className="btn__sheen" />
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
                    <span className="btn__sheen" />
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
                <Sparkle size={13} /> free, forever
              </span>
            </div>
          </div>

          {/* ── Romantic visual ── */}
          <div className="hero__visual" ref={visualRef} aria-hidden="true">
            <div className="keepsake">
              <span className="keepsake__halo" />
              <span className="keepsake__ring keepsake__ring--outer" />
              <span className="keepsake__ring keepsake__ring--inner" />

              <div className="keepsake__card card">
                <span className="card__ribbon" />
                <div className="keepsake__seal anim-beat">
                  <ShieldLine size={26} strokeWidth={1.4} />
                </div>
                <p className="keepsake__label eyebrow">Aurelia vault</p>
                <p className="keepsake__line script">
                  {isAuthenticated ? `${firstName || "your"}'s vault` : "encrypting live"}
                </p>

                <div className="keepsake__rows">
                  {["•••••••••••", "••••••••", "•••••••••••••"].map((mask, i) => (
                    <div className="keepsake__row" key={i} style={{ animationDelay: `${0.5 + i * 0.18}s` }}>
                      <span className="keepsake__chip">
                        <KeyLine size={13} />
                      </span>
                      <Scramble length={mask.length} every={110 + i * 40} />
                      <span className="keepsake__lock">
                        <LockLine size={13} />
                      </span>
                    </div>
                  ))}
                </div>

                <div className="keepsake__foot">
                  <span className="dot dot--live" />
                  encrypted just now
                </div>
              </div>

              <span className="keepsake__orbit keepsake__orbit--a">
                <LockLine size={16} />
              </span>
              <span className="keepsake__orbit keepsake__orbit--b">
                <Sparkle size={14} />
              </span>
              <span className="keepsake__orbit keepsake__orbit--c">
                <KeyLine size={16} />
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════ PROMISES ══════════ */}
      <section className="section shell">
        <Reveal as="header" className="section__head">
          <span className="eyebrow">Why Aurelia</span>
          <h2 className="section__title">
            Security that <em className="serif-em">feels alive</em>
          </h2>
          <p className="lede section__lede">
            Strong encryption, live insights and a design you will actually enjoy opening.
          </p>
        </Reveal>

        <div className="promises">
          {PROMISES.map((p, i) => (
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
            Three steps to a <em className="serif-em">glowing vault</em>
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
            Your whole digital life,
            <br />
            <em>one tap away — on every screen.</em>
          </p>
          <div className="closing__cta">
            <Link to={isAuthenticated ? "/passwords" : "/signup"} className="btn btn--primary btn--lg">
              <span className="btn__sheen" />
              {isAuthenticated ? "Open my vault" : "Begin your vault"}
              <Arrow size={16} />
            </Link>
          </div>
          <p className="closing__sign script">sealed with AES-256</p>
        </Reveal>
      </section>

      {/* ══════════ ANDROID ══════════ */}
      <section className="section shell">
        <Reveal className="android card card--hover" variant="reveal--scale">
          <span className="card__ribbon" />
          <div className="android__copy">
            <span className="eyebrow">New · Android app</span>
            <h2 className="section__title">
              Your vault, <em className="serif-em">in your pocket</em>
            </h2>
            <p className="lede">
              Same account, same server, same encryption. Fingerprint unlock, one-tap copy and the live
              health score — built for your phone.
            </p>
            <a className="btn btn--primary btn--lg" href={ANDROID_URL} target="_blank" rel="noopener noreferrer">
              <span className="btn__sheen" />
              Get the Android app
              <Arrow size={16} />
            </a>
          </div>
          <div className="android__phone" aria-hidden="true">
            <div className="android__screen">
              <span className="android__notch" />
              <div className="android__ring">
                <strong>92</strong>
                <span>Excellent</span>
              </div>
              {["Gmail", "GitHub", "Bank"].map((n, i) => (
                <div className="android__row" key={n} style={{ animationDelay: `${0.2 + i * 0.15}s` }}>
                  <span className="android__avatar">{n[0]}</span>
                  <span className="android__name">{n}</span>
                  <span className="android__dot" />
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </section>

      <footer className="foot">
        <span className="foot__mark">
          <ShieldLine size={15} />
          Aurelia
        </span>
        <span className="foot__note">Encrypted with AES-256 · Web &amp; Android</span>
      </footer>
    </div>
  );
}

export default Home;
