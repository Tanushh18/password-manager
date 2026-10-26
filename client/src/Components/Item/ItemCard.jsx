import React, { useEffect, useState } from "react";
import { toast } from "react-toastify";
import ItemAvatar from "./ItemAvatar";
import TotpCode from "./TotpCode";
import "./Item.css";
import { STRENGTH_TONES } from "../StrengthMeter/StrengthMeter";
import { openableUrl, domainOf, typeOf, FIELD_DEFS, TYPE_LABELS } from "../../lib/items";
import { Eye, EyeOff, Copy, Check, Pencil, Star, StarFill, External, User, Note, Folder, Alert, Repeat, Clock } from "../Icons/Icons";
import MoreMenu from "../Vault/MoreMenu";
import { IcTrash, IcGlobe, IcUser } from "../Vault/VaultIcons";

const AUTO_HIDE_MS = 20000;

const timeAgo = (date) => {
  if (!date) return "";
  const s = Math.max(1, (Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 2592000) return `${Math.floor(s / 86400)}d ago`;
  if (s < 31536000) return `${Math.floor(s / 2592000)}mo ago`;
  return `${Math.floor(s / 31536000)}y ago`;
};

const CLIPBOARD_CLEAR_MS = 30000;
let clearTimer = null;

/* Secrets are wiped from the clipboard after 30s, but only if the clipboard still holds what we put there. */
function scheduleClipboardClear(text) {
  clearTimeout(clearTimer);
  clearTimer = setTimeout(async () => {
    try {
      if ((await navigator.clipboard.readText()) === text) await navigator.clipboard.writeText("");
    } catch (e) { /* reading needs permission; skip quietly */ }
  }, CLIPBOARD_CLEAR_MS);
}

async function copyText(text, label, secret = false) {
  try {
    await navigator.clipboard.writeText(text);
    if (secret) scheduleClipboardClear(text);
    toast.info(`${label} copied${secret ? " · clears in 30s" : ""}`, { autoClose: 1600 });
    return true;
  } catch (e) {
    toast.error("Couldn't copy — your browser blocked clipboard access.");
    return false;
  }
}

export default function ItemCard({ item, info, icons, onEdit, onFavorite, onTrash, selecting, selected, onSelect, style }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState("");
  const [revealed, setRevealed] = useState({});

  useEffect(() => {
    if (!shown) return undefined;
    const t = setTimeout(() => setShown(false), AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [shown]);

  const flash = (what) => {
    setCopied(what);
    setTimeout(() => setCopied(""), 1400);
  };

  const domain = domainOf(item.url);
  const kind = typeOf(item);
  const name = item.name || "Untitled";
  const copyUser = async () => (await copyText(item.username, "Username")) && flash("u");
  const copyPass = async () => (await copyText(item.password, "Password", true)) && flash("p");

  const menu = [
    item.username ? { key: "user", label: "Copy username", icon: <IcUser size={16} />, onSelect: copyUser } : null,
    domain ? { key: "open", label: "Open website", icon: <IcGlobe size={16} />, onSelect: () => window.open(openableUrl(item.url), "_blank", "noopener,noreferrer") } : null,
    { key: "edit", label: "Edit", icon: <Pencil size={15} />, onSelect: onEdit },
    onTrash ? { key: "trash", label: "Move to Trash", icon: <IcTrash size={16} />, onSelect: onTrash, tone: "danger" } : null,
  ];

  const tone = info ? STRENGTH_TONES[info.score] : null;

  return (
    <article
      className={`vcard vcard--${kind} ${tone ? "vcard--" + tone : ""} ${selected ? "is-selected" : ""} ${selecting ? "is-selecting" : ""}`}
      style={style}
      aria-label={name}
    >
      <div className="vcard__head">
        {selecting ? (
          <label className="vcard__select">
            <input type="checkbox" checked={Boolean(selected)} onChange={onSelect} aria-label={`Select ${name}`} />
          </label>
        ) : null}
        <ItemAvatar name={item.name} url={item.url} icons={icons} size={40} />
        <div className="vcard__id">
          <h3 className="vcard__name" title={name}>{name}</h3>
          <p className="vcard__sub">
            {domain ? (
              <a href={openableUrl(item.url)} target="_blank" rel="noopener noreferrer">{domain} <External size={10} /></a>
            ) : (
              <span>{TYPE_LABELS[kind]}</span>
            )}
            {item.folder ? <span className="vcard__folder"><Folder size={10} /> {item.folder}</span> : null}
          </p>
        </div>
        <div className="vcard__acts">
          <button type="button" className={`icon-btn icon-btn--quiet vcard__fav ${item.favorite ? "is-fav" : ""}`} onClick={onFavorite} aria-pressed={Boolean(item.favorite)} aria-label={item.favorite ? `Remove ${name} from favourites` : `Add ${name} to favourites`}>
            {item.favorite ? <StarFill size={16} /> : <Star size={16} />}
          </button>
          <button type="button" className="icon-btn icon-btn--quiet" onClick={onEdit} aria-label={`Edit ${name}`}>
            <Pencil size={15} />
          </button>
          <MoreMenu label={`More actions for ${name}`} actions={menu} />
        </div>
      </div>

      <div className="vcard__body">
        {kind !== "login" ? (
          <>
            {(FIELD_DEFS[kind] || []).filter((d) => (item.fields || {})[d.key]).map((d) => {
              const value = item.fields[d.key];
              const hide = d.secret && !revealed[d.key];
              return (
                <div className="vrow" key={d.key}>
                  <span className="vrow__label">{d.label}</span>
                  <span className={`vrow__text ${d.secret ? "vrow__text--mono" : ""}`} title={hide ? d.label : value}>{hide ? "•••• " + value.slice(-4) : value}</span>
                  {d.secret ? <button type="button" className="icon-btn" onClick={() => setRevealed((r) => ({ ...r, [d.key]: !r[d.key] }))} aria-label={hide ? "Reveal " + d.label : "Hide " + d.label}>{hide ? <Eye size={15} /> : <EyeOff size={15} />}</button> : null}
                  <button type="button" className={`icon-btn ${copied === d.key ? "is-done" : ""}`} onClick={async () => (await copyText(value, d.label, Boolean(d.secret))) && flash(d.key)} aria-label={"Copy " + d.label}>
                    {copied === d.key ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                </div>
              );
            })}
            {kind === "note" && item.notes ? <p className="vcard__note">{item.notes.length > 160 ? item.notes.slice(0, 160) + "…" : item.notes}</p> : null}
          </>
        ) : null}

        {item.username ? (
          <div className="vrow">
            <span className="vrow__icon"><User size={14} /></span>
            <span className="vrow__text" title={item.username}>{item.username}</span>
            <button type="button" className={`icon-btn ${copied === "u" ? "is-done" : ""}`} onClick={copyUser} aria-label="Copy username">
              {copied === "u" ? <Check size={15} /> : <Copy size={15} />}
            </button>
          </div>
        ) : null}

        {item.password ? (
          <div className={`vrow vrow--secret ${shown ? "is-open" : ""}`}>
            <button type="button" className="vrow__value" onClick={() => setShown((v) => !v)} title={shown ? "Hide" : "Reveal (hides after 20s)"}>
              <span className={`vrow__text vrow__text--mono ${shown ? "is-revealed" : ""}`}>{shown ? item.password : "••••••••••••"}</span>
            </button>
            <button type="button" className={`icon-btn ${shown ? "is-on" : ""}`} onClick={() => setShown((v) => !v)} aria-label={shown ? "Hide password" : "Reveal password"}>
              {shown ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
            <button type="button" className={`icon-btn vrow__copy ${copied === "p" ? "is-done" : ""}`} onClick={copyPass} aria-label="Copy password">
              {copied === "p" ? <Check size={15} /> : <Copy size={15} />}
            </button>
          </div>
        ) : null}

        {item.totp ? (
          <div className="vcard__totp">
            <span className="vrow__label">2FA code</span>
            <TotpCode secret={item.totp} onCopy={() => toast.info("2FA code copied", { autoClose: 1400 })} />
          </div>
        ) : null}
      </div>

      <div className="vcard__foot">
        {info ? (
          <>
            <span className={`badge badge--${tone}`}>
              <span className="badge__bars" data-score={info.score}><i /><i /><i /><i /></span>
              {info.label}
            </span>
            {info.breached ? <span className="badge badge--danger"><Alert size={11} /> Breached</span> : null}
            {info.reused ? <span className="badge badge--warn"><Repeat size={11} /> Reused</span> : null}
            {info.old ? <span className="badge badge--cool"><Clock size={11} /> Old</span> : null}
          </>
        ) : <span className="badge badge--cool">{TYPE_LABELS[kind]}</span>}
        {kind === "login" && item.notes ? <span className="badge badge--muted"><Note size={11} /> Note</span> : null}
        <span className="vcard__time">{timeAgo(item.updatedAt || item.createdAt)}</span>
      </div>
    </article>
  );
}

