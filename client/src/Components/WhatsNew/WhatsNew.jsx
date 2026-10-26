import React, { useEffect, useState } from "react";
import { Modal } from "react-responsive-modal";
import "react-responsive-modal/styles.css";
import { APP_VERSION, WHATS_NEW } from "../../lib/appVersion";
import { Sparkle } from "../Icons/Icons";
import "./WhatsNew.css";

const SEEN_KEY = "stashr_seen_version";
const read = () => { try { return localStorage.getItem(SEEN_KEY); } catch { return null; } };
const write = (v) => { try { localStorage.setItem(SEEN_KEY, v); } catch { /* private mode */ } };

/** Version chip for the navbar. Opens the release notes; opens itself once after an upgrade. */
export default function VersionBadge({ autoOpen = false }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (autoOpen && read() !== APP_VERSION) setOpen(true); }, [autoOpen]);
  const close = () => { write(APP_VERSION); setOpen(false); };
  return (
    <>
      <button type="button" className="ver-badge" onClick={() => setOpen(true)} title="What’s new in this version" aria-label={"Stashr version " + APP_VERSION + ", what’s new"}>v{APP_VERSION}</button>
      <Modal open={open} onClose={close} center classNames={{ modal: "whatsnew" }} aria-labelledby="whatsnew-title">
        <div className="whatsnew__head">
          <span className="whatsnew__icon"><Sparkle size={20} /></span>
          <div><h2 id="whatsnew-title">Stashr {APP_VERSION}</h2><p>Faster sync, Trash and bulk actions.</p></div>
        </div>
        <ul className="whatsnew__list">{WHATS_NEW.map(([title, body]) => <li key={title}><strong>{title}</strong><span>{body}</span></li>)}</ul>
        <button type="button" className="btn btn--primary" onClick={close}>Got it</button>
      </Modal>
    </>
  );
}
