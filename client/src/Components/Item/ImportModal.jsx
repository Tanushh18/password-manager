import React, { useRef, useState } from "react";
import { Modal } from "react-responsive-modal";
import { toast } from "react-toastify";
import Field from "../Field/Field";
import { parseCSV, rowsToItems, normalizeItem } from "../../lib/items";
import { importBackup } from "../../lib/crypto";
import { Upload, Check } from "../Icons/Icons";

/**
 * Import from an Aurelia encrypted backup, CSV (Chrome, Bitwarden, 1Password,
 * LastPass…) or an Excel sheet. Everything is parsed and encrypted in the browser.
 */
export default function ImportModal({ open, onClose, onImport }) {
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [backupText, setBackupText] = useState(null);
  const [backupPassword, setBackupPassword] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);

  const reset = () => {
    setFile(null);
    setBackupText(null);
    setBackupPassword("");
    setPreview(null);
    setProgress(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const close = () => {
    reset();
    onClose();
  };

  const pick = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    reset();
    setFile(f);
    try {
      const name = f.name.toLowerCase();
      if (name.endsWith(".json") || name.endsWith(".aurelia")) {
        setBackupText(await f.text());
        return;
      }
      if (name.endsWith(".csv")) {
        setPreview(rowsToItems(parseCSV(await f.text())));
        return;
      }
      const XLSX = await import("xlsx");
      const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: "array" });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      setPreview(rowsToItems(rows));
    } catch (err) {
      toast.error("We couldn't read that file.");
      reset();
    }
  };

  const unlockBackup = async () => {
    try {
      setBusy(true);
      const items = await importBackup(backupText, backupPassword);
      setPreview(items.map(normalizeItem));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    try {
      setBusy(true);
      const n = await onImport(preview, (done, total) => setProgress({ done, total }));
      toast.success(`${n} item${n === 1 ? "" : "s"} imported and encrypted.`);
      close();
    } catch (err) {
      toast.error(err?.response?.data?.error || err.message || "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={close} center classNames={{ modal: "sheet" }}>
      <div className="sheet__body">
        <span className="card__ribbon" />
        <div className="sheet__head">
          <span className="sheet__seal"><Upload size={22} /></span>
          <h2 className="sheet__title">Import passwords</h2>
          <p className="sheet__sub">Aurelia backups, CSV exports from Chrome, Bitwarden, 1Password or LastPass, or an Excel sheet.</p>
        </div>

        <label className="dropzone">
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.json,.aurelia" onChange={pick} hidden />
          <Upload size={20} />
          <span>{file ? file.name : "Choose a file"}</span>
          <small>Nothing leaves your browser unencrypted.</small>
        </label>

        {backupText && !preview ? (
          <div className="import__backup">
            <Field id="imp-pass" label="Backup password" secret value={backupPassword} onChange={(e) => setBackupPassword(e.target.value)} autoFocus />
            <button type="button" className="btn btn--primary btn--block" onClick={unlockBackup} disabled={!backupPassword || busy}>
              {busy ? <span className="spinner" /> : null} Open backup
            </button>
          </div>
        ) : null}

        {preview ? (
          <div className="import__preview">
            <p>
              <strong>{preview.length}</strong> item{preview.length === 1 ? "" : "s"} found
              {preview.length ? `: ${preview.slice(0, 4).map((i) => i.name || "Untitled").join(", ")}${preview.length > 4 ? "…" : ""}` : "."}
            </p>
            {progress ? (
              <div className="progress"><span style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
            ) : null}
            <button type="button" className="btn btn--primary btn--block" onClick={run} disabled={!preview.length || busy}>
              <span className="btn__sheen" />
              {busy ? <span className="spinner" /> : <Check size={15} />}
              {busy ? "Encrypting…" : `Import ${preview.length} item${preview.length === 1 ? "" : "s"}`}
            </button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
