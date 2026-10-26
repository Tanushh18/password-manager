import React from "react";
import { Link } from "react-router-dom";
import { SECTIONS } from "../../lib/vaultView";
import { IcOverview, IcKey, IcStar, IcNote, IcCard, IcIdentity, IcFolder, IcTrash, IcWand, IcShield, IcGear } from "./VaultIcons";

const MAIN = [
  { id: SECTIONS.all, label: "Overview", Icon: IcOverview },
  { id: SECTIONS.logins, label: "All Passwords", Icon: IcKey },
  { id: SECTIONS.fav, label: "Favorites", Icon: IcStar },
  { id: SECTIONS.note, label: "Secure Notes", Icon: IcNote },
  { id: SECTIONS.card, label: "Credit Cards", Icon: IcCard },
  { id: SECTIONS.identity, label: "Identity", Icon: IcIdentity },
];

const TOOLS = [
  { to: "/generator", label: "Password Generator", Icon: IcWand },
  { to: "/security-center", label: "Security Audit", Icon: IcShield },
  { to: "/settings", label: "Settings", Icon: IcGear },
];

function Entry({ id, label, Icon, count, active, onSelect }) {
  return (
    <li>
      <button type="button" className={`vx-nav__item ${active ? "is-active" : ""}`} aria-current={active ? "page" : undefined} onClick={() => onSelect(id)}>
        <Icon size={18} />
        <span className="vx-nav__label">{label}</span>
        <span className="vx-nav__count" aria-label={`${count} item${count === 1 ? "" : "s"}`}>{count}</span>
      </button>
    </li>
  );
}

/**
 * Vault navigation. A sticky column on desktop; a horizontally scrolling
 * strip of chips on small screens (same markup, CSS decides).
 */
export default function VaultSidebar({ section, onSelect, counts, folders }) {
  return (
    <nav className="vx-nav" aria-label="Vault sections">
      <div className="vx-nav__group">
        <span className="vx-nav__heading">Vault</span>
        <ul className="vx-nav__list">
          {MAIN.map((m) => <Entry key={m.id} {...m} count={counts[m.id] ?? 0} active={section === m.id} onSelect={onSelect} />)}
        </ul>
      </div>
      {folders.length ? (
        <div className="vx-nav__group">
          <span className="vx-nav__heading">Folders</span>
          <ul className="vx-nav__list">
            {folders.map((f) => <Entry key={f} id={f} label={f} Icon={IcFolder} count={counts.folders[f] ?? 0} active={section === f} onSelect={onSelect} />)}
          </ul>
        </div>
      ) : null}
      <div className="vx-nav__group">
        <ul className="vx-nav__list">
          <Entry id={SECTIONS.trash} label="Trash" Icon={IcTrash} count={counts.__trash} active={section === SECTIONS.trash} onSelect={onSelect} />
        </ul>
      </div>
      <div className="vx-nav__group vx-nav__group--tools">
        <span className="vx-nav__heading">Tools</span>
        <ul className="vx-nav__list">
          {TOOLS.map(({ to, label, Icon }) => (
            <li key={to}>
              <Link to={to} className="vx-nav__item vx-nav__item--link"><Icon size={18} /><span className="vx-nav__label">{label}</span></Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
