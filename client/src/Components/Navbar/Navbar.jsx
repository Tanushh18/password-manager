import React, { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useVault } from "../../state/vault";
import { ShieldLine, Menu, Close, Arrow } from "../Icons/Icons";
import ThemeToggle from "../ThemeToggle/ThemeToggle";

function Navbar() {
  const { status, profile } = useVault();
  const isAuthenticated = status === "ready" || status === "locked";
  const name = profile?.name;
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => { setOpen(false); }, [location.pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const links = isAuthenticated
    ? [
        { to: "/", label: "Home" },
        { to: "/passwords", label: "Passwords" },
        { to: "/projects", label: "Projects" },
        { to: "/settings", label: "Settings" },
      ]
    : [
        { to: "/", label: "Home" },
      ];

  const cta = isAuthenticated
    ? { to: "/passwords", label: "My vault" }
    : { to: "/signup", label: "Create your vault" };

  return (
    <>
      <header className={`sticky top-0 z-50 bg-white dark:bg-dark-surface border-b border-gray-200 dark:border-dark-surface-light transition-all duration-300 ${scrolled ? "shadow-lg" : ""}`}>
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 no-underline group" aria-label="Stashr home">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg text-white" style={{ background: 'linear-gradient(135deg, #31AAA9 0%, #2a9a9a 100%)' }}>
              <ShieldLine size={18} strokeWidth={1.8} />
            </div>
            <div className="hidden sm:block">
              <div className="font-bold text-gray-900 dark:text-white text-lg">Stashr</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 -mt-1">Secure Vault</div>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1" aria-label="Primary">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `px-4 py-2 rounded-lg transition-colors font-medium ${
                    isActive
                      ? "text-teal-300 dark:text-teal-300"
                      : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                  }`
                }
                end
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          {/* Right Actions */}
          <div className="flex items-center gap-4">
            <ThemeToggle />
            {isAuthenticated && name && (
              <span className="hidden lg:inline-block text-sm text-gray-600 dark:text-gray-400">
                Hello, <span className="font-medium text-gray-900 dark:text-white">{name.split(" ")[0]}</span>
              </span>
            )}
            <Link to={cta.to} className="btn btn-primary hidden sm:flex">
              {cta.label}
              <Arrow size={14} />
            </Link>
            {isAuthenticated && (
              <Link to="/logout" className="btn btn-ghost hidden sm:flex text-sm">
                Sign out
              </Link>
            )}
            <button
              className="md:hidden p-2 hover:bg-gray-100 dark:hover:bg-dark-surface-light rounded-lg transition-colors"
              onClick={() => setOpen(true)}
              aria-label="Open menu"
              aria-expanded={open}
            >
              <Menu size={20} />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 md:hidden ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setOpen(false)}
      />
      <div
        className={`fixed top-0 right-0 h-screen w-80 bg-white dark:bg-dark-surface z-40 md:hidden transform transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-dark-surface-light">
          <span className="flex items-center gap-2 font-bold">
            <ShieldLine size={18} />
            Stashr
          </span>
          <button onClick={() => setOpen(false)} aria-label="Close menu" className="p-1">
            <Close size={20} />
          </button>
        </div>

        <nav className="flex flex-col p-6 gap-2">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `px-4 py-3 rounded-lg transition-colors font-medium ${
                  isActive
                    ? "text-teal-300 dark:text-teal-300"
                    : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-dark-surface-light"
                }`
              }
              style={({ isActive }) => isActive ? { backgroundColor: 'rgba(49, 170, 169, 0.1)' } : {}}
              end
            >
              {link.label}
            </NavLink>
          ))}
          <Link to={cta.to} className="btn btn-primary w-full justify-center">
            {cta.label}
          </Link>
          {isAuthenticated && (
            <Link to="/logout" className="btn btn-secondary w-full justify-center">
              Sign out
            </Link>
          )}
        </nav>

        <p className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-dark-surface-light">
          Passwords, projects, everything — kept safe.
        </p>
      </div>
    </>
  );
}

export default Navbar;
