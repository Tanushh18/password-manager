import React, { useEffect, useMemo, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useVault } from "../../state/vault";
import { navGroups, bottomItems, activeEntry } from "../../lib/navigation";
import useMediaQuery, { PHONE } from "../../hooks/useMediaQuery";
import useTheme from "../../hooks/useTheme";
import NavIcon from "../AppShell/NavIcon";
import { DialogFrame } from "../UI/Dialogs";
import "./BottomNav.css";

/** Thumb-reach navigation for signed-in phones; "More" opens every other destination in a sheet. */
export default function BottomNav() {
  const { status, profile, lock } = useVault();
  const narrow = useMediaQuery(PHONE);
  const { pathname } = useLocation();
  const { theme, toggle } = useTheme();
  const [sheet, setSheet] = useState(false);
  const show = status === "ready" && narrow;
  const groups = useMemo(() => navGroups(profile), [profile]);
  const items = useMemo(() => {
    const base = bottomItems(profile);
    const infra = groups.find((g) => g.id === "infra");
    return infra ? [...base, { ...infra.items[0], label: "Control", icon: "tower" }] : base;
  }, [profile, groups]);
  const active = activeEntry(groups, pathname);
  const inBar = items.some((it) => it.to === active?.to);

  useEffect(() => {
    document.body.classList.toggle("has-bottomnav", show);
    return () => document.body.classList.remove("has-bottomnav");
  }, [show]);
  useEffect(() => { setSheet(false); }, [pathname]);

  if (!show) return null;
  return (
    <>
      <nav className="bottomnav" aria-label="Main">
        {items.map((it) => {
          const on = active?.to === it.to;
          return (
            <NavLink key={it.to} to={it.to} aria-current={on ? "page" : undefined} className={`bottomnav__item ${on ? "is-active" : ""}`}>
              <span className="bottomnav__icon"><NavIcon name={it.icon} size={22} /></span>
              <span className="bottomnav__label">{it.label}</span>
            </NavLink>
          );
        })}
        <button type="button" className={`bottomnav__item ${!inBar && pathname !== "/dashboard" ? "is-active" : ""}`} onClick={() => setSheet(true)} aria-haspopup="dialog" aria-expanded={sheet}>
          <span className="bottomnav__icon"><NavIcon name="more" size={22} /></span>
          <span className="bottomnav__label">More</span>
        </button>
      </nav>
      {sheet ? (
        <DialogFrame labelledBy="more-sheet-title" onClose={() => setSheet(false)} size="sheet" className="moresheet">
          <header className="moresheet__head">
            <h2 id="more-sheet-title">All of Stashr</h2>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => setSheet(false)}>Close</button>
          </header>
          <nav aria-label="All destinations">
            {groups.map((g) => (
              <section key={g.id} className="moresheet__group">
                <h3>{g.label}</h3>
                <ul>
                  {g.items.map((it) => (
                    <li key={it.to}>
                      <Link to={it.to} className={`moresheet__link ${active?.to === it.to ? "is-active" : ""}`} aria-current={active?.to === it.to ? "page" : undefined}>
                        <NavIcon name={it.icon} /> {it.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <section className="moresheet__group">
              <h3>Account</h3>
              <ul>
                <li><Link to="/settings" className="moresheet__link"><NavIcon name="gear" /> Settings</Link></li>
                <li><Link to="/apps" className="moresheet__link"><NavIcon name="apps" /> Apps and extension</Link></li>
                <li><button type="button" className="moresheet__link" onClick={toggle}><NavIcon name={theme === "light" ? "moon" : "sun"} /> {theme === "light" ? "Dark theme" : "Light theme"}</button></li>
                <li><button type="button" className="moresheet__link" onClick={() => { setSheet(false); lock(); }}><NavIcon name="lock" /> Lock vault</button></li>
                <li><Link to="/logout" className="moresheet__link is-danger"><NavIcon name="logout" /> Sign out</Link></li>
              </ul>
            </section>
          </nav>
        </DialogFrame>
      ) : null}
    </>
  );
}
