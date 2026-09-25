import React, { useEffect, useState } from "react";
import { toast } from "react-toastify";
import ItemAvatar from "./ItemAvatar";
import TotpCode from "./TotpCode";
import "./Item.css";
import { STRENGTH_TONES } from "../StrengthMeter/StrengthMeter";
import { openableUrl, domainOf } from "../../lib/items";
import { Eye, EyeOff, Copy, Check, Pencil, Star, StarFill, External, User, Note, Folder, Alert, Repeat, Clock } from "../Icons/Icons";

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

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast.info(`${label} copied`, { autoClose: 1600 });
    return true;
  } catch (e) {
    toast.error("Couldn't copy — your browser blocked clipboard access.");
    return false;
  }
}

export default function ItemCard({ item, info, icons, onEdit, onFavorite, style }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState("");

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

  return (
    <article className="vault-card card card--hover" style={style}>
      <span className="card__ribbon" />
      <div className="vault-card__head">
        <ItemAvatar name={item.name} url={item.url} icons={icons} />
        <div className="vault-card__id">
          <h3 className="vault-card__name" title={item.name}>{item.name || "Untitled"}</h3>
          <p className="vault-card__email">
            {domain ? (
              <a href={openableUrl(item.url)} target="_blank" rel="noopener noreferrer">
                {domain} <External size={11} />
              </a>
            ) : item.folder ? (
              <span className="vault-card__folder"><Folder size={11} /> {item.folder}</span>
            ) : (
              "—"
            )}
          </p>
        </div>
        <button type="button" className={`icon-btn icon-btn--quiet ${item.favorite ? "is-fav" : ""}`} onClick={onFavorite} aria-label={item.favorite ? "Remove from favourites" : "Add to favourites"}>
          {item.favorite ? <StarFill size={16} /> : <Star size={16} />}
        </button>
        <button type="button" className="icon-btn vault-card__edit" onClick={onEdit} aria-label={`Edit ${item.name}`}>
          <Pencil size={15} />
        </button>
      </div>

      <div className="vault-card__badges">
        {info ? (
          <>
            <span className={`badge badge--${STRENGTH_TONES[info.score]}`}>
              <span className="badge__bars" data-score={info.score}><i /><i /><i /><i /></span>
              {info.label}
            </span>
            {info.breached ? <span className="badge badge--danger"><Alert size={11} /> Breached</span> : null}
            {info.reused ? <span className="badge badge--warn"><Repeat size={11} /> Reused</span> : null}
            {info.old ? <span className="badge badge--cool"><Clock size={11} /> Old</span> : null}
          </>
        ) : null}
        {item.notes ? <span className="badge badge--muted"><Note size={11} /> Note</span> : null}
        <span className="vault-card__time">{timeAgo(item.updatedAt || item.createdAt)}</span>
      </div>

      <hr className="rule vault-card__rule" />

      {item.username ? (
        <div className="secret secret--plain">
          <span className="secret__icon"><User size={14} /></span>
          <span className="secret__text secret__text--plain" title={item.username}>{item.username}</span>
          <button type="button" className={`icon-btn ${copied === "u" ? "is-done" : ""}`} onClick={async () => (await copyText(item.username, "Username")) && flash("u")} aria-label="Copy username">
            {copied === "u" ? <Check size={15} /> : <Copy size={15} />}
          </button>
        </div>
      ) : null}

      {item.password ? (
        <div className={`secret ${shown ? "is-open" : ""}`}>
          <button type="button" className="secret__value" onClick={() => setShown((v) => !v)} title={shown ? "Hide" : "Reveal"}>
            <span className={`secret__text ${shown ? "is-revealed" : ""}`}>{shown ? item.password : "•••••••••••"}</span>
          </button>
          <div className="secret__tools">
            <button type="button" className={`icon-btn ${shown ? "is-on" : ""}`} onClick={() => setShown((v) => !v)} aria-label={shown ? "Hide password" : "Reveal password"}>
              {shown ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
            <button type="button" className={`icon-btn ${copied === "p" ? "is-done" : ""}`} onClick={async () => (await copyText(item.password, "Password")) && flash("p")} aria-label="Copy password">
              {copied === "p" ? <Check size={15} /> : <Copy size={15} />}
            </button>
          </div>
        </div>
      ) : null}

      {item.totp ? (
        <div className="vault-card__totp">
          <span className="field__label">2FA code</span>
          <TotpCode secret={item.totp} onCopy={() => toast.info("2FA code copied", { autoClose: 1400 })} />
        </div>
      ) : null}
    </article>
  );
}
