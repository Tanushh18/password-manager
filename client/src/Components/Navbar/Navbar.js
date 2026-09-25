import React, { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useSelector } from "react-redux";
import { ShieldLine, Menu, Close, Arrow } from "../Icons/Icons";
import ThemeToggle from "../ThemeToggle/ThemeToggle";
import "./Navbar.css";

function Navbar() {
  const isAuthenticated = useSelector((state) => state.isAuthenticated);
  const name = useSelector((state) => state.name);
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const location = useLocation();

  /* Sticky nav condenses once the page moves */
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* Close the drawer on navigation + lock body scroll while it is open */
  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const links = isAuthenticated
    ? [
        { to: "/", label: "Home" },
        { to: "/logout", label: "Sign out" },
      ]
    : [
        { to: "/", label: "Home" },
        { to: "/signin", label: "Sign in" },
      ];

  const cta = isAuthenticated
    ? { to: "/passwords", label: "My vault" }
    : { to: "/signup", label: "Create your vault" };

  return (
    <>
      <header className={`nav ${scrolled ? "is-scrolled" : ""}`}>
        <div className="nav__inner">
          <Link to="/" className="nav__brand" aria-label="Aurelia home">
            <span className="nav__mark">
              <ShieldLine size={19} strokeWidth={1.8} />
            </span>
            <span className="nav__wordmark">
              <span className="nav__name">Aurelia</span>
              <span className="nav__tag">aurora vault</span>
            </span>
          </Link>

          <nav className="nav__links" aria-label="Primary">
            {links.map((link) => (
              <NavLink key={link.to} exact to={link.to} className="nav__link" activeClassName="is-active">
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="nav__actions">
            <ThemeToggle />
            {isAuthenticated && name && (
              <span className="nav__greeting">
                Hello, <em>{name.split(" ")[0]}</em>
              </span>
            )}
            <Link to={cta.to} className="btn btn--primary btn--sm nav__cta">
              <span className="btn__sheen" />
              {cta.label}
              <Arrow size={14} />
            </Link>
            <button
              className="nav__burger"
              onClick={() => setOpen(true)}
              aria-label="Open menu"
              aria-expanded={open}
            >
              <Menu size={20} />
            </button>
          </div>
        </div>
      </header>

      {/* ── Mobile drawer ── */}
      <div className={`drawer ${open ? "is-open" : ""}`} role="dialog" aria-hidden={!open}>
        <div className="drawer__top">
          <span className="drawer__brand">
            <ShieldLine size={18} />
            Aurelia
          </span>
          <button className="drawer__close" onClick={() => setOpen(false)} aria-label="Close menu">
            <Close size={18} />
          </button>
        </div>

        <nav className="drawer__links">
          {links.map((link, i) => (
            <NavLink
              key={link.to}
              exact
              to={link.to}
              className="drawer__link"
              activeClassName="is-active"
              style={{ transitionDelay: `${0.06 + i * 0.06}s` }}
            >
              {link.label}
            </NavLink>
          ))}
          <NavLink
            to={cta.to}
            className="drawer__link drawer__link--cta"
            style={{ transitionDelay: `${0.06 + links.length * 0.06}s` }}
          >
            {cta.label}
            <Arrow size={15} />
          </NavLink>
        </nav>

        <p className="drawer__note">
          <span className="script">Your secrets, lit by the aurora.</span>
        </p>
      </div>
      <div className={`drawer__scrim ${open ? "is-open" : ""}`} onClick={() => setOpen(false)} />
    </>
  );
}

export default Navbar;
