import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useVault } from "../../state/vault";
import { buildEntries, rank } from "../../lib/palette";
import "./CommandPalette.css";

/* Ctrl/Cmd+K opens a jump-to box for pages, projects and vault items. */
export default function CommandPalette() {
  const { status, items, projects, profile } = useVault();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);

  const entries = useMemo(() => buildEntries({ items, projects: projects || [], profile, signedIn: status === "ready" }), [items, projects, profile, status]);
  const results = useMemo(() => rank(entries, query), [entries, query]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        if (status !== "ready") return;
        e.preventDefault();
        setOpen((o) => !o);
        setQuery("");
        setActive(0);
      } else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status]);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => { setActive(0); }, [query]);

  if (!open) return null;
  const go = (entry) => { if (!entry) return; setOpen(false); navigate(entry.to); };
  const onInputKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); go(results[active]); }
  };

  return (
    <div className="cmdk__scrim" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="cmdk card" role="dialog" aria-modal="true" aria-label="Command palette">
        <input ref={inputRef} className="input cmdk__input" placeholder="Jump to a page, project or login…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onInputKey} aria-label="Search commands" />
        <ul className="cmdk__list" role="listbox">
          {results.map((r, i) => (
            <li key={r.kind + r.to + i} role="option" aria-selected={i === active} className={i === active ? "is-active" : ""} onMouseEnter={() => setActive(i)} onClick={() => go(r)}>
              <span className="cmdk__kind">{r.kind}</span><strong>{r.label}</strong><small>{r.hint}</small>
            </li>
          ))}
          {!results.length && <li className="cmdk__empty">Nothing matches “{query}”.</li>}
        </ul>
      </div>
    </div>
  );
}
