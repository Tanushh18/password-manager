import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import Ambience from "../../Components/Ambience/Ambience";
import ServiceStatus from "../../Components/ServiceStatus/ServiceStatus";
import { useParallax } from "../../hooks/useReveal";
import Reveal from "../../Components/Reveal/Reveal";
import {
  HeartLine,
  LockLine,
  ShieldLine,
  KeyLine,
  Sparkle,
  Leaf,
  Arrow,
  Flourish,
} from "../../Components/Icons/Icons";
import "./Home.css";

const PROMISES = [
  {
    icon: <LockLine size={26} />,
    title: "Sealed with AES-256",
    body: "Every secret is encrypted before it ever reaches the vault, with a key that never leaves the server.",
  },
  {
    icon: <ShieldLine size={26} />,
    title: "Yours alone",
    body: "No trackers, no adverts, no selling. Just a quiet room where the things you keep stay kept.",
  },
  {
    icon: <Leaf size={26} />,
    title: "Calm by design",
    body: "Soft type, generous space and gentle motion — a password manager that feels like a keepsake.",
  },
];

const STEPS = [
  { n: "01", title: "Create your vault", body: "One account, one password to remember. That is all it asks of you." },
  { n: "02", title: "Tuck things away", body: "Add a platform, an email, a password — or bring them all at once from a spreadsheet." },
  { n: "03", title: "Come back anytime", body: "Reveal a password with a tap, from any device you carry." },
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
              <HeartLine size={13} />
              {isAuthenticated ? "Welcome home" : "A place for what you hold dear"}
            </span>

            {isAuthenticated ? (
              <h1 className="display hero__title">
                Hello again,
                <br />
                <em>{firstName || "love"}.</em>
              </h1>
            ) : (
              <h1 className="display hero__title">
                All you hold dear,
                <br />
                <em>kept safely close.</em>
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
                    <>It is quiet in there — add the first thing worth keeping.</>
                  )}
                </>
              ) : (
                <>
                  Aurelia is a gentle home for your passwords. Encrypted the moment you write
                  them down, and never shared with anyone — not even with us.
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
                  <HeartLine size={26} strokeWidth={1.2} />
                </div>
                <p className="keepsake__label eyebrow">Aurelia vault</p>
                <p className="keepsake__line script">
                  {isAuthenticated ? `${firstName || "you"}'s little secrets` : "kept close, kept safe"}
                </p>

                <div className="keepsake__rows">
                  {["•••••••••••", "••••••••", "•••••••••••••"].map((mask, i) => (
                    <div className="keepsake__row" key={i} style={{ animationDelay: `${0.5 + i * 0.18}s` }}>
                      <span className="keepsake__chip">
                        <KeyLine size={13} />
                      </span>
                      <span className="keepsake__mask">{mask}</span>
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
                <HeartLine size={16} />
              </span>
              <span className="keepsake__orbit keepsake__orbit--b">
                <Sparkle size={14} />
              </span>
              <span className="keepsake__orbit keepsake__orbit--c">
                <Leaf size={16} />
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
            Small promises, <em className="serif-em">kept quietly</em>
          </h2>
          <p className="lede section__lede">
            The things worth protecting deserve somewhere beautiful to live.
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
            Three small steps, <em className="serif-em">then peace of mind</em>
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
            “Some things are worth keeping.
            <br />
            <em>We just make sure they stay kept.</em>”
          </p>
          <div className="closing__cta">
            <Link to={isAuthenticated ? "/passwords" : "/signup"} className="btn btn--primary btn--lg">
              <span className="btn__sheen" />
              {isAuthenticated ? "Open my vault" : "Begin your vault"}
              <Arrow size={16} />
            </Link>
          </div>
          <p className="closing__sign script">with care, always</p>
        </Reveal>
      </section>

      <footer className="foot">
        <span className="foot__mark">
          <HeartLine size={15} />
          Aurelia
        </span>
        <span className="foot__note">Encrypted with AES-256 · Built with love</span>
      </footer>
    </div>
  );
}

export default Home;
