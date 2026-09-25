import React, { useEffect, useMemo, useState } from "react";
import { Modal } from "react-responsive-modal";
import "react-responsive-modal/styles.css";
import { toast } from "react-toastify";
import Field from "../Field/Field";
import StrengthMeter from "../StrengthMeter/StrengthMeter";
import TotpCode from "./TotpCode";
import ItemAvatar from "./ItemAvatar";
import { emptyItem } from "../../lib/items";
import { estimate, generatePassword } from "../../lib/strength";
import { parseTotp } from "../../lib/crypto";
import { Sparkle, Trash, Check, Star, StarFill } from "../Icons/Icons";

/** Create or edit an item. `item` null = new. */
export default function ItemEditor({ open, item, folders, icons, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(emptyItem());
  const [gen, setGen] = useState({ length: 20, symbols: true, digits: true, upper: true });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(item ? { ...emptyItem(), ...item } : emptyItem());
      setConfirmDelete(false);
    }
  }, [open, item]);

  const strength = useMemo(() => estimate(form.password), [form.password]);
  const totpValid = !form.totp || Boolean(parseTotp(form.totp));
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const generate = (opts = gen) => setForm((f) => ({ ...f, password: generatePassword(opts) }));

  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Give it a name.");
    if (!totpValid) return toast.error("That 2FA secret isn't valid. Paste the setup key or otpauth:// link.");
    try {
      setSaving(true);
      await onSave(form);
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.error || err.message || "Couldn't save that.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirmDelete) return setConfirmDelete(true);
    try {
      setSaving(true);
      await onDelete();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.error || "Couldn't delete that.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} center classNames={{ modal: "sheet sheet--wide" }}>
      <form className="sheet__body editor" onSubmit={save}>
        <span className="card__ribbon" />
        <div className="editor__head">
          <ItemAvatar name={form.name || "?"} url={form.url} icons={icons} size={52} />
          <div>
            <h2 className="sheet__title">{item ? "Edit item" : "New item"}</h2>
            <p className="sheet__sub">Encrypted on this device with AES-256-GCM before it's saved.</p>
          </div>
          <button type="button" className={`icon-btn icon-btn--quiet editor__fav ${form.favorite ? "is-fav" : ""}`} onClick={() => setForm((f) => ({ ...f, favorite: !f.favorite }))} aria-label="Favourite">
            {form.favorite ? <StarFill size={18} /> : <Star size={18} />}
          </button>
        </div>

        <div className="editor__grid">
          <Field id="it-name" label="Name" value={form.name} onChange={set("name")} placeholder="GitHub, Bank, Wi-Fi…" autoFocus />
          <Field id="it-url" label="Website" value={form.url} onChange={set("url")} placeholder="github.com" inputMode="url" />
          <Field id="it-user" label="Username or email" value={form.username} onChange={set("username")} placeholder="you@example.com" autoComplete="off" />
          <div className="field">
            <label className="field__label" htmlFor="it-folder">Folder</label>
            <input id="it-folder" className="input" list="folder-list" value={form.folder} onChange={set("folder")} placeholder="Work, Personal, Finance…" />
            <datalist id="folder-list">
              {folders.map((f) => <option key={f} value={f} />)}
            </datalist>
          </div>
        </div>

        <Field id="it-pass" label="Password" secret value={form.password} onChange={set("password")} placeholder="The secret itself" autoComplete="new-password" />
        {form.password ? <StrengthMeter strength={strength} /> : null}

        <div className="gen">
          <div className="gen__label">
            <span>Generator · length <strong>{gen.length}</strong></span>
            <span className="gen__opts">
              {[["upper", "A-Z"], ["digits", "0-9"], ["symbols", "!@#"]].map(([k, l]) => (
                <label key={k} className="gen__opt">
                  <input type="checkbox" checked={gen[k]} onChange={(e) => { const next = { ...gen, [k]: e.target.checked }; setGen(next); generate(next); }} />
                  {l}
                </label>
              ))}
            </span>
          </div>
          <div className="gen__row">
            <input className="gen__range" type="range" min="8" max="48" value={gen.length} onChange={(e) => { const next = { ...gen, length: Number(e.target.value) }; setGen(next); generate(next); }} aria-label="Password length" />
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => generate()}>
              <Sparkle size={14} /> Generate
            </button>
          </div>
        </div>

        <Field
          id="it-totp"
          label="2FA secret (optional)"
          value={form.totp}
          onChange={set("totp")}
          placeholder="Setup key or otpauth://… link"
          error={!totpValid ? "Not a valid 2FA secret" : ""}
          hint="Store an authenticator secret here and Aurelia shows the live code."
          autoComplete="off"
        />
        {form.totp && totpValid ? (
          <div className="editor__totp"><TotpCode secret={form.totp} /></div>
        ) : null}

        <div className="field">
          <label className="field__label" htmlFor="it-notes">Notes</label>
          <textarea id="it-notes" className="input textarea" rows={3} value={form.notes} onChange={set("notes")} placeholder="Security questions, PINs, recovery info…" />
        </div>

        <div className="editor__actions">
          {item ? (
            <button type="button" className={`btn btn--sm ${confirmDelete ? "btn--danger" : "btn--quiet"}`} onClick={remove} disabled={saving}>
              <Trash size={14} /> {confirmDelete ? "Tap again to delete" : "Delete"}
            </button>
          ) : <span />}
          <div className="editor__right">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              <span className="btn__sheen" />
              {saving ? <span className="spinner" /> : <Check size={15} />}
              {item ? "Save changes" : "Save to vault"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
