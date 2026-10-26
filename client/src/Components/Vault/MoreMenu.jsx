import React, { useEffect, useId, useRef, useState } from "react";
import { IcMore } from "./VaultIcons";

/**
 * Small accessible actions menu (menu button pattern).
 * actions: [{ key, label, icon, onSelect, tone }] — falsy entries are skipped.
 */
export default function MoreMenu({ label = "More actions", actions = [] }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const btn = useRef(null);
  const id = useId();
  const list = actions.filter(Boolean);

  const focusItem = (i) => {
    const els = wrap.current?.querySelectorAll('[role="menuitem"]');
    if (els && els.length) els[(i + els.length) % els.length].focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    requestAnimationFrame(() => focusItem(0));
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const close = (refocus = true) => { setOpen(false); if (refocus) btn.current?.focus(); };

  const onKeyDown = (e) => {
    const els = [...(wrap.current?.querySelectorAll('[role="menuitem"]') || [])];
    const at = els.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); focusItem(at + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusItem(at - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusItem(0); }
    else if (e.key === "End") { e.preventDefault(); focusItem(els.length - 1); }
    else if (e.key === "Tab") setOpen(false);
  };

  return (
    <div className="vx-menu" ref={wrap} onKeyDown={open ? onKeyDown : undefined}>
      <button
        ref={btn}
        type="button"
        className={`icon-btn icon-btn--quiet vx-menu__btn ${open ? "is-on" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); setOpen(true); } }}
      >
        <IcMore size={18} />
      </button>
      {open ? (
        <ul className="vx-menu__list" role="menu" id={id} aria-label={label}>
          {list.map((a) => (
            <li key={a.key} role="none">
              <button type="button" role="menuitem" tabIndex={-1} className={`vx-menu__item ${a.tone ? "is-" + a.tone : ""}`} onClick={() => { close(a.key !== "edit"); a.onSelect(); }}>
                {a.icon}<span>{a.label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
