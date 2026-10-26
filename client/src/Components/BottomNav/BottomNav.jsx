import React, { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useVault } from "../../state/vault";
import "./BottomNav.css";

const QUERY = "(max-width: 759px)";

const Svg = ({ children }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>
);

const ICONS = {
  key: <Svg><circle cx="8" cy="15" r="4" /><path d="M10.8 12.2 20 3m-3 3 2.5 2.5M14.5 8.5 17 11" /></Svg>,
  spark: <Svg><path d="M4 7h10M4 12h16M4 17h7" /><circle cx="18" cy="7" r="2" /><circle cx="15" cy="17" r="2" /></Svg>,
  shield: <Svg><path d="M12 3 5 6v5c0 4.4 3 8.3 7 10 4-1.7 7-5.6 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></Svg>,
  tower: <Svg><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M7 20h10M12 16v4M7 9h4M7 12h7" /></Svg>,
  gear: <Svg><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></Svg>,
};

const ITEMS = [
  { to: "/passwords", label: "Passwords", icon: "key" },
  { to: "/generator", label: "Generator", icon: "spark" },
  { to: "/security-center", label: "Security", icon: "shield" },
  { to: "/render", label: "Control", icon: "tower", aria: "Control Center", also: ["/services", "/cron"] },
  { to: "/settings", label: "Settings", icon: "gear" },
];

function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(QUERY).matches);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(QUERY);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => (mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on));
  }, []);
  return narrow;
}

/** Thumb-reach navigation for signed-in phones. Sits above the jungle grass. */
export default function BottomNav() {
  const { status } = useVault();
  const narrow = useNarrow();
  const { pathname } = useLocation();
  const show = status === "ready" && narrow;

  useEffect(() => {
    document.body.classList.toggle("has-bottomnav", show);
    return () => document.body.classList.remove("has-bottomnav");
  }, [show]);

  if (!show) return null;
  return (
    <nav className="bottomnav" aria-label="Main">
      {ITEMS.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          aria-label={it.aria}
          className={({ isActive }) => `bottomnav__item ${isActive || (it.also || []).some((p) => pathname.startsWith(p)) ? "is-active" : ""}`}
        >
          <span className="bottomnav__icon">{ICONS[it.icon]}</span>
          <span className="bottomnav__label">{it.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
