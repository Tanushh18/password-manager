import React from "react";
import { SECTIONS } from "../../lib/vaultView";
import { IcOverview, IcKey, IcStar, IcNote, IcCard, IcIdentity, IcFolder, IcTrash } from "./VaultIcons";

const MAIN = [
  { id: SECTIONS.all, label: "All items", Icon: IcOverview },
  { id: SECTIONS.fav, label: "Favourites", Icon: IcStar },
  { id: SECTIONS.logins, label: "Logins", Icon: IcKey },
  { id: SECTIONS.note, label: "Secure notes", Icon: IcNote },
  { id: SECTIONS.card, label: "Cards", Icon: IcCard },
  { id: SECTIONS.identity, label: "Identities", Icon: IcIdentity },
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
 * Vault sections. A sticky column on desktop; a horizontally scrolling
 * strip of chips on small screens (same markup, CSS decides). App-wide
 * destinations (Generator, Security, Settings) live in the main navigation.
 */
export default function VaultSidebar({ section, onSelect, counts, folders }) {
  return (
    <nav className="vx-nav" aria-label="Vault sections">
      <div className="vx-nav__group">
        <span className="vx-nav__heading">Categories</span>
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
    </nav>
  );
}
