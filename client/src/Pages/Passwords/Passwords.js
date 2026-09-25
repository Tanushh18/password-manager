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
import VaultHealth from "../../Components/VaultHealth/VaultHealth";
import {
  checkAuthenticated,
  getInsights,
  saveNewPassword,
  updateAPassword,
} from "../../axios/instance";
import { estimate, generatePassword } from "../../utils/strength";
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

/* Aurora avatar washes */
const WASHES = [
  "linear-gradient(140deg, #8b5cf6, #ec4899)",
  "linear-gradient(140deg, #22d3ee, #8b5cf6)",
  "linear-gradient(140deg, #f472b6, #f59e0b)",
  "linear-gradient(140deg, #34d399, #0891b2)",
  "linear-gradient(140deg, #6366f1, #22d3ee)",
  "linear-gradient(140deg, #a855f7, #6366f1)",
];

const STRENGTH_TONES = ["danger", "danger", "warn", "ok", "ok"];

const suggestPassword = (length = 18) => generatePassword({ length });

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
  const [insights, setInsights] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("recent");
  const [genLength, setGenLength] = useState(18);
  const fileRef = useRef(null);

  const list = useMemo(() => passwords || [], [passwords]);
  const formStrength = useMemo(() => estimate(form.platPass), [form.platPass]);
  const editStrength = useMemo(() => estimate(newPass), [newPass]);

  /* Live vault health: re-scored whenever the vault changes */
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    let cancelled = false;
    setInsightsLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await getInsights();
        if (!cancelled && res.status === 200) setInsights(res.data);
      } catch (err) {
        // Older servers have no /insights; the panel simply stays in "scanning".
      } finally {
        if (!cancelled) setInsightsLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [list, isAuthenticated]);

  const insightFor = useMemo(() => {
    const map = {};
    (insights?.items || []).forEach((item) => {
      map[item.id] = item;
    });
    return map;
  }, [insights]);

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
        toast.success("Tucked safely away.");
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
        toast.success("Updated, and sealed again.");
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
        toast.success(`${saved} of ${rows.length} rows tucked away.`);
      } catch (err) {
        toast.error("We couldn't read that spreadsheet.");
      } finally {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const filtered = list
    .filter((entry) => {
      const term = searchTerm.trim().toLowerCase();
      if (!term) return true;
      return (
        (entry.platform || "").toLowerCase().includes(term) ||
        (entry.platEmail || "").toLowerCase().includes(term)
      );
    })
    .filter((entry) => {
      if (filter === "all") return true;
      const info = insightFor[entry._id];
      if (!info) return false;
      if (filter === "weak") return info.score <= 1;
      if (filter === "reused") return info.reused;
      if (filter === "old") return info.old;
      if (filter === "strong") return info.score >= 3 && !info.reused;
      return true;
    })
    .sort((a, b) => {
      if (sort === "az") return (a.platform || "").localeCompare(b.platform || "");
      if (sort === "weakest") return (insightFor[a._id]?.score ?? 5) - (insightFor[b._id]?.score ?? 5);
      const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return tb - ta;
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
        <Ambience petals={false} />
        <div className="unlocking anim-fade-up">
          <span className="unlocking__seal anim-beat">
            <KeyLine size={26} />
          </span>
          <p className="unlocking__title">Unlocking your vault…</p>
          <p className="unlocking__body">One moment while we check it is you.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="vault page">
      <Ambience petals={false} />
      <ToastContainer position="top-right" autoClose={3500} newestOnTop closeOnClick pauseOnHover draggable />

      <div className="shell">
        {/* ── Header ── */}
        <header className="vault__head anim-fade-up">
          <span className="pill vault__pill">
            <ShieldLine size={13} />
            Your vault
          </span>

          <h1 className="vault__title">
            Kept for you, <em className="serif-em">{firstName || "love"}</em>
          </h1>

          <p className="vault__count">
            {list.length === 0
              ? "Nothing inside yet — let's change that."
              : `${list.length} secret${list.length === 1 ? "" : "s"} resting safely`}
          </p>

          <div className="vault__status">
            <ServiceStatus />
          </div>
        </header>

        <div className="anim-fade-up d-1">
          <VaultHealth insights={insights} loading={insightsLoading} filter={filter} onFilter={setFilter} />
        </div>

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
            <select
              className="input vault__sort"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              aria-label="Sort passwords"
            >
              <option value="recent">Recently updated</option>
              <option value="az">A → Z</option>
              <option value="weakest">Weakest first</option>
            </select>
            <button className="btn btn--primary" onClick={() => setOpen(true)}>
              <span className="btn__sheen" />
              <Plus size={15} />
              Add a password
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
            <h2 className="empty__title">Nothing kept here yet</h2>
            <p className="empty__body">
              Add the first thing worth remembering. It is encrypted the moment you save it, and
              only ever opened by you.
            </p>
            <button className="btn btn--primary btn--lg" onClick={() => setOpen(true)}>
              <span className="btn__sheen" />
              Add your first password
              <Arrow size={16} />
            </button>
          </Reveal>
        ) : filtered.length === 0 ? (
          <Reveal className="empty empty--slim card">
            <span className="empty__icon">
              <Search size={24} />
            </span>
            <h2 className="empty__title">
              {searchTerm ? <>Nothing matches “{searchTerm}”</> : "Nothing in this filter"}
            </h2>
            <p className="empty__body">
              {filter !== "all" && !searchTerm
                ? "Good news — no passwords need attention here."
                : "Try a shorter word, or clear the filters to see everything."}
            </p>
            <button
              className="btn btn--ghost"
              onClick={() => {
                setSearchTerm("");
                setFilter("all");
              }}
            >
              Show everything
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
                <span className="card__ribbon" />

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

                <div className="vault-card__badges">
                  {insightFor[entry._id] ? (
                    <>
                      <span className={`badge badge--${STRENGTH_TONES[insightFor[entry._id].score]}`}>
                        <span className="badge__bars" data-score={insightFor[entry._id].score}>
                          <i />
                          <i />
                          <i />
                          <i />
                        </span>
                        {insightFor[entry._id].label}
                      </span>
                      {insightFor[entry._id].reused && <span className="badge badge--warn">Reused</span>}
                      {insightFor[entry._id].old && <span className="badge badge--cool">Old</span>}
                    </>
                  ) : (
                    <span className="badge badge--muted">Scanning…</span>
                  )}
                  {(entry.updatedAt || entry.createdAt) && (
                    <span className="vault-card__time">{timeAgo(entry.updatedAt || entry.createdAt)}</span>
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
                        placeholder="Type the new one"
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
                    {newPass && <StrengthMeter strength={editStrength} />}

                    <div className="vault-card__edit-actions">
                      <button
                        className="btn btn--ok btn--sm"
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
            <h2 className="sheet__title">Something new to keep</h2>
            <p className="sheet__sub">Sealed with AES-256 before it ever reaches the vault.</p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="np-platform">Platform</label>
            <input
              id="np-platform"
              className="input"
              type="text"
              placeholder="Instagram, work email, the wifi…"
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
                  setForm((p) => ({ ...p, platPass: suggestPassword(genLength) }));
                  setShowModalPass(true);
                }}
              >
                <Sparkle size={13} /> suggest one
              </button>
            </div>
            <div className="field__wrap">
              <input
                id="np-pass"
                className="input input--icon"
                type={showModalPass ? "text" : "password"}
                placeholder="The secret itself"
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
            {form.platPass && <StrengthMeter strength={formStrength} />}

            <div className="gen">
              <label className="gen__label" htmlFor="np-len">
                Generator length <strong>{genLength}</strong>
              </label>
              <input
                id="np-len"
                className="gen__range"
                type="range"
                min="8"
                max="40"
                value={genLength}
                onChange={(e) => {
                  const len = Number(e.target.value);
                  setGenLength(len);
                  setForm((p) => ({ ...p, platPass: suggestPassword(len) }));
                  setShowModalPass(true);
                }}
              />
            </div>
          </div>

          <button type="submit" className="btn btn--primary btn--block" disabled={saving}>
            <span className="btn__sheen" />
            {saving ? (
              <>
                <span className="spinner" /> Sealing…
              </>
            ) : (
              <>
                Keep it safe <Arrow size={16} />
              </>
            )}
          </button>
        </form>
      </Modal>
    </div>
  );
}

function StrengthMeter({ strength }) {
  return (
    <div className={`strength strength--${STRENGTH_TONES[strength.score]}`} aria-live="polite">
      <div className="meter">
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={`meter__bar ${strength.score >= n ? `on-${strength.score}` : ""}`} />
        ))}
      </div>
      <span className="strength__label">
        {strength.label}
        {strength.bits ? ` · ~${strength.bits} bits` : ""}
      </span>
    </div>
  );
}

export default Passwords;
