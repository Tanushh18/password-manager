import React from "react";
import Mascot from "./Mascot";
import { useVault } from "../../state/vault";
import "./MascotBanner.css";

/** A page's mascot with its mood line and a few live readouts. Part of the opt-in playful effects (Settings → Appearance). */
export default function MascotBanner({ kind, mood, title, line, stats = [], children }) {
  const { prefs } = useVault();
  if (!prefs?.fx) return null;
  return (
    <section className={"mbn is-" + mood} aria-label={title}>
      <Mascot kind={kind} mood={mood} size={64} />
      <div className="mbn__text">
        <span className="mbn__title">◈ {title}</span>
        <p className="mbn__line">{line}</p>
        {stats.length > 0 && (
          <dl className="mbn__stats">{stats.map(([k, v, tone]) => <div key={k} className={"is-" + (tone || "idle")}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        )}
      </div>
      {children ? <div className="mbn__extra">{children}</div> : null}
    </section>
  );
}
