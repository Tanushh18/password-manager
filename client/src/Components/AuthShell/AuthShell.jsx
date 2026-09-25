import React from "react";
import Ambience from "../Ambience/Ambience";
import ServiceStatus from "../ServiceStatus/ServiceStatus";
import { LockLine, ShieldCheck, Sparkle } from "../Icons/Icons";
import "../../styles/auth.css";

/** Two-column card used by sign in, sign up and unlock. */
export default function AuthShell({ stage, children, loading, aside }) {
  return (
    <div className="auth page">
      <Ambience petals />
      <div className="auth__card card anim-fade-up">
        {loading && (
          <div className="auth__progress">
            <span className="auth__progress-fill" />
          </div>
        )}
        <div className="auth__form">
          {stage ? (
            <span className={`pill auth__stage auth__stage--${stage.tone || "accent"}`}>
              <span className="dot dot--live" />
              {stage.label}
            </span>
          ) : null}
          {children}
          <div className="auth__status">
            <ServiceStatus compact />
          </div>
        </div>

        <aside className="auth__aside" aria-hidden="true">
          <span className="auth__aside-glow" />
          <span className="auth__aside-ring" />
          <div className="auth__seal anim-beat">
            <LockLine size={26} />
          </div>
          <h2 className="auth__aside-title">
            {aside?.title || (
              <>
                Encrypted on your device,
                <br />
                <em>readable only by you.</em>
              </>
            )}
          </h2>
          <p className="auth__aside-body">
            {aside?.body ||
              "Your master password derives the key that seals every item before it leaves this browser. We never see it — and neither does anyone else."}
          </p>
          <div className="auth__aside-list">
            <span className="auth__aside-item"><ShieldCheck size={15} /> Zero-knowledge AES-256-GCM</span>
            <span className="auth__aside-item"><LockLine size={15} /> Optional two-factor login</span>
            <span className="auth__aside-item"><Sparkle size={15} /> Same vault on web &amp; Android</span>
          </div>
          <p className="auth__aside-sign script">your keys, your vault</p>
        </aside>
      </div>
    </div>
  );
}
