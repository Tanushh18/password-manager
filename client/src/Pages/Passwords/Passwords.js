import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHistory } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { Modal } from "react-responsive-modal";
import "react-responsive-modal/styles.css";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import * as XLSX from "xlsx";

import Password from "../../Components/Password/Password";
import Ambience from "../../Components/Ambience/Ambience";
import ServiceStatus from "../../Components/ServiceStatus/ServiceStatus";
import Reveal from "../../Components/Reveal/Reveal";
import {
  checkAuthenticated,
  saveNewPassword,
  updateAPassword,
} from "../../axios/instance";
import { setAuth, setPasswords } from "../../redux/actions";
import {
  ShieldLine,
  KeyLine,
  Plus,
  Search,
  Upload,
  Eye,
  EyeOff,
  Pencil,
  Check,
  Close,
  Sparkle,
  Arrow,
} from "../../Components/Icons/Icons";
import "./Passwords.css";

/* Five restrained avatar washes, one per entry, drawn from the palette */
const WASHES = [
  "linear-gradient(140deg, #3b82f6, #1d4ed8)",
  "linear-gradient(140deg, #64748b, #1e293b)",
  "linear-gradient(140deg, #0ea5e9, #0369a1)",
  "linear-gradient(140deg, #6366f1, #4338ca)",
  "linear-gradient(140deg, #10b981, #047857)",
];

const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_";

const suggestPassword = (length = 16) => {
  const bytes = new Uint32Array(length);
  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 4294967296);
  }
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
};

const clean = (val) =>
  !val ? "" : val.toString().replace(/\u00A0/g, "").replace(/\s+/g, " ").trim();

function Passwords() {
  const history = useHistory();
  const dispatch = useDispatch();
  const { isAuthenticated, authChecked, name, email, passwords } = useSelector((state) => state);

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [form, setForm] = useState({ platform: "", platEmail: "", platPass: "" });
  const [showModalPass, setShowModalPass] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [newPass, setNewPass] = useState("");
  const [showNewPass, setShowNewPass] = useState(false);
  const fileRef = useRef(null);

  const list = useMemo(() => passwords || [], [passwords]);

  useEffect(() => {
    // Only send someone away once we actually know they are signed out
    if (authChecked && !isAuthenticated) history.replace("/signin");
  }, [authChecked, isAuthenticated, history]);

  const refresh = useCallback(async () => {
    try {
      const res = await checkAuthenticated();
      if (res.status === 200) {
        dispatch(setPasswords(res.data?.passwords || []));
      } else {
        dispatch(setAuth(false));
      }
    } catch (err) {
      if (err?.response?.status === 400 || err?.response?.status === 401) {
        dispatch(setAuth(false));
      }
    }
  }, [dispatch]);

  /* ── Add ── */
  const addNewPassword = async (e) => {
    if (e) e.preventDefault();
    if (saving) return;

    if (!clean(form.platform) || !clean(form.platPass)) {
      toast.error("A platform and a password, at least.");
      return;
    }

    try {
      setSaving(true);
      const res = await saveNewPassword({
        platform: clean(form.platform),
        userPass: clean(form.platPass),
        platEmail: clean(form.platEmail) || "NA",
        userEmail: clean(email),
      });

      if (res.status === 200) {
        toast.success("Credential saved and encrypted.");
        setForm({ platform: "", platEmail: "", platPass: "" });
        setShowModalPass(false);
        setOpen(false);
        refresh();
      } else {
        toast.error(res.data?.error || "We couldn't save that one.");
      }
    } catch (err) {
      toast.error(err?.response?.data?.error || "We couldn't save that one.");
    } finally {
      setSaving(false);
    }
  };

  /* ── Edit ── */
  const startEdit = (entry) => {
    setEditingId(entry._id);
    setNewPass("");
    setShowNewPass(false);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setNewPass("");
    setShowNewPass(false);
  };

  const saveEdit = async (entry) => {
    if (!clean(newPass)) {
      toast.error("Type the new password first.");
      return;
    }
    try {
      setSaving(true);
      const res = await updateAPassword({
        id: entry._id,
        userPass: clean(newPass),
        platform: clean(entry.platform),
        platEmail: clean(entry.platEmail),
      });

      if (res.status === 200) {
        toast.success("Password updated and re-encrypted.");
        cancelEdit();
        refresh();
      } else {
        toast.error(res.data?.error || "We couldn't update that one.");
      }
    } catch (err) {
      toast.error(err?.response?.data?.error || "We couldn't update that one.");
    } finally {
      setSaving(false);
    }
  };

  /* ── Bulk upload ── */
  const handleExcelUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        setUploading(true);
        const workbook = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet);

        let saved = 0;
        for (const row of rows) {
          const payload = {
            platform: clean(row.platform || row.Platform) || "NA",
            userPass: clean(row.userPass || row.password || row.Password) || "NA",
            platEmail: clean(row.platEmail || row.email || row.Email) || "NA",
            userEmail: clean(email),
          };
          try {
            // eslint-disable-next-line no-await-in-loop
            await saveNewPassword(payload);
            saved += 1;
          } catch (err) {
            console.error("Could not save row", row, err);
          }
        }

        await refresh();
        toast.success(`${saved} of ${rows.length} rows imported.`);
      } catch (err) {
        toast.error("We couldn't read that spreadsheet.");
      } finally {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const filtered = list.filter((entry) => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return true;
    return (
      (entry.platform || "").toLowerCase().includes(term) ||
      (entry.platEmail || "").toLowerCase().includes(term)
    );
  });

  const initial = (platform) =>
    !platform || platform === "NA" ? "•" : platform.trim().charAt(0).toUpperCase();

  const washFor = (platform) => {
    const key = (platform || "?").charCodeAt(0) || 0;
    return WASHES[key % WASHES.length];
  };

  const firstName = (name || "").split(" ")[0];

  if (!authChecked && !isAuthenticated) {
    return (
      <div className="vault page vault--waiting">
        <Ambience grid={false} />
        <div className="unlocking anim-fade-up">
          <span className="unlocking__seal">
            <KeyLine size={26} />
          </span>
          <p className="unlocking__title">Unlocking your vault…</p>
          <p className="unlocking__body">Verifying your session.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="vault page">
      <Ambience grid={false} />
      <ToastContainer position="top-right" autoClose={3500} newestOnTop closeOnClick pauseOnHover draggable />

      <div className="shell">
        {/* ── Header ── */}
        <header className="vault__head anim-fade-up">
          <span className="pill vault__pill">
            <ShieldLine size={13} />
            Your vault
          </span>

          <h1 className="vault__title">
            {firstName ? <>{firstName}&rsquo;s <em className="serif-em">vault</em></> : <>Your <em className="serif-em">vault</em></>}
          </h1>

          <p className="vault__count">
            {list.length === 0
              ? "No credentials stored yet."
              : `${list.length} credential${list.length === 1 ? "" : "s"} stored and encrypted`}
          </p>

          <div className="vault__status">
            <ServiceStatus />
          </div>
        </header>

        {/* ── Toolbar ── */}
        <div className="vault__tools anim-fade-up d-2">
          <div className="vault__search field__wrap">
            <span className="vault__search-icon">
              <Search size={17} />
            </span>
            <input
              className="input vault__search-input"
              type="search"
              placeholder="Search by platform or email…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label="Search your vault"
            />
          </div>

          <div className="vault__actions">
            <button className="btn btn--primary" onClick={() => setOpen(true)}>
              <Plus size={15} />
              Add password
            </button>

            <label className={`btn btn--ghost ${uploading ? "is-busy" : ""}`}>
              {uploading ? <span className="spinner spinner--accent" /> : <Upload size={15} />}
              {uploading ? "Reading…" : "Import sheet"}
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx, .xls, .csv"
                hidden
                onChange={handleExcelUpload}
                disabled={uploading}
              />
            </label>
          </div>
        </div>

        <p className="vault__hint anim-fade-up d-3">
          Spreadsheets are read from the columns <code>platform</code>, <code>email</code> and{" "}
          <code>password</code>.
        </p>

        {/* ── Grid ── */}
        {list.length === 0 ? (
          <Reveal className="empty card" variant="reveal--scale">
            <span className="card__ribbon" />
            <span className="empty__icon">
              <KeyLine size={28} />
            </span>
            <h2 className="empty__title">Your vault is empty</h2>
            <p className="empty__body">
              Add your first credential. It is encrypted the moment you save it, and decrypted
              only when you ask for it.
            </p>
            <button className="btn btn--primary btn--lg" onClick={() => setOpen(true)}>
              Add your first password
              <Arrow size={16} />
            </button>
          </Reveal>
        ) : filtered.length === 0 ? (
          <Reveal className="empty empty--slim card">
            <span className="empty__icon">
              <Search size={24} />
            </span>
            <h2 className="empty__title">Nothing matches “{searchTerm}”</h2>
            <p className="empty__body">Try a shorter term, or clear the search to see everything.</p>
            <button className="btn btn--ghost" onClick={() => setSearchTerm("")}>
              Clear search
            </button>
          </Reveal>
        ) : (
          <div className="vault__grid">
            {filtered.map((entry, i) => (
              <Reveal
                as="article"
                className={`vault-card card card--hover ${editingId === entry._id ? "is-editing" : ""}`}
                key={entry._id}
                delay={Math.min(i, 8) * 0.05}
              >
                <div className="vault-card__head">
                  <span className="vault-card__avatar" style={{ background: washFor(entry.platform) }}>
                    {initial(entry.platform)}
                  </span>
                  <div className="vault-card__id">
                    <h3 className="vault-card__name">{entry.platform}</h3>
                    <p className="vault-card__email">
                      {entry.platEmail && entry.platEmail !== "NA" ? entry.platEmail : "—"}
                    </p>
                  </div>

                  {editingId === entry._id ? (
                    <button className="icon-btn" onClick={cancelEdit} aria-label="Cancel editing">
                      <Close size={15} />
                    </button>
                  ) : (
                    <button
                      className="icon-btn vault-card__edit"
                      onClick={() => startEdit(entry)}
                      aria-label={`Change the password for ${entry.platform}`}
                    >
                      <Pencil size={15} />
                    </button>
                  )}
                </div>

                <hr className="rule vault-card__rule" />

                {editingId === entry._id ? (
                  <div className="vault-card__edit-body">
                    <label className="field__label" htmlFor={`np-${entry._id}`}>
                      New password
                    </label>
                    <div className="field__wrap">
                      <input
                        id={`np-${entry._id}`}
                        className="input input--icon"
                        type={showNewPass ? "text" : "password"}
                        value={newPass}
                        placeholder="Enter the new password"
                        onChange={(e) => setNewPass(e.target.value)}
                        autoFocus
                      />
                      <button
                        type="button"
                        className={`field__affix ${showNewPass ? "is-on" : ""}`}
                        onClick={() => setShowNewPass((v) => !v)}
                        aria-label={showNewPass ? "Hide" : "Show"}
                        tabIndex={-1}
                      >
                        {showNewPass ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>

                    <div className="vault-card__edit-actions">
                      <button
                        className="btn btn--positive btn--sm"
                        onClick={() => saveEdit(entry)}
                        disabled={saving}
                      >
                        {saving ? <span className="spinner" /> : <Check size={15} />}
                        Save
                      </button>
                      <button className="btn btn--ghost btn--sm" onClick={cancelEdit}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn--quiet btn--sm vault-card__suggest"
                        onClick={() => {
                          setNewPass(suggestPassword());
                          setShowNewPass(true);
                        }}
                      >
                        <Sparkle size={14} />
                        Suggest
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="vault-card__body">
                    <span className="field__label">Password</span>
                    <Password id={entry._id} password={entry.password} iv={entry.iv} />
                  </div>
                )}
              </Reveal>
            ))}
          </div>
        )}
      </div>

      {/* ── Add modal ── */}
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          setShowModalPass(false);
        }}
        center
        classNames={{ modal: "sheet" }}
      >
        <form className="sheet__body" onSubmit={addNewPassword}>
          <span className="card__ribbon" />
          <div className="sheet__head">
            <span className="sheet__seal">
              <KeyLine size={22} />
            </span>
            <h2 className="sheet__title">Add a credential</h2>
            <p className="sheet__sub">Encrypted with AES-256 before it reaches the vault.</p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="np-platform">Platform</label>
            <input
              id="np-platform"
              className="input"
              type="text"
              placeholder="GitHub, work email, home wifi…"
              value={form.platform}
              onChange={(e) => setForm((p) => ({ ...p, platform: e.target.value }))}
              autoFocus
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="np-email">Email or username</label>
            <input
              id="np-email"
              className="input"
              type="text"
              placeholder="you@example.com"
              value={form.platEmail}
              onChange={(e) => setForm((p) => ({ ...p, platEmail: e.target.value }))}
            />
          </div>

          <div className="field">
            <div className="field__row">
              <label className="field__label" htmlFor="np-pass">Password</label>
              <button
                type="button"
                className="sheet__suggest"
                onClick={() => {
                  setForm((p) => ({ ...p, platPass: suggestPassword() }));
                  setShowModalPass(true);
                }}
              >
                <Sparkle size={13} /> Generate
              </button>
            </div>
            <div className="field__wrap">
              <input
                id="np-pass"
                className="input input--icon"
                type={showModalPass ? "text" : "password"}
                placeholder="Enter or generate a password"
                value={form.platPass}
                onChange={(e) => setForm((p) => ({ ...p, platPass: e.target.value }))}
              />
              <button
                type="button"
                className={`field__affix ${showModalPass ? "is-on" : ""}`}
                onClick={() => setShowModalPass((v) => !v)}
                aria-label={showModalPass ? "Hide password" : "Show password"}
                tabIndex={-1}
              >
                {showModalPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button type="submit" className="btn btn--primary btn--block" disabled={saving}>
            {saving ? (
              <>
                <span className="spinner" /> Saving…
              </>
            ) : (
              <>
                Save credential <Arrow size={16} />
              </>
            )}
          </button>
        </form>
      </Modal>
    </div>
  );
}

export default Passwords;
