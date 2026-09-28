import React, { useRef, useState } from "react";
import { Modal } from "react-responsive-modal";
import "react-responsive-modal/styles.css";
import { toast } from "react-toastify";
import { rowsToProjects } from "../../lib/projectItems";
import { Upload, Check } from "../../Components/Icons/Icons";

/**
 * Import projects from the project-tracker Excel template (Projects +
 * Databases sheets). Parsed entirely in the browser — the file never
 * leaves your device unencrypted, and env vars aren't read from Excel at
 * all (paste those straight into a project instead).
 */
export default function ProjectImportModal({ open, onClose, onImport }) {
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);

  const reset = () => {
    setFile(null);
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
      const XLSX = await import("xlsx");
      const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: "array" });
      const sheetNamed = (guess) => {
        const name = wb.SheetNames.find((n) => n.toLowerCase().includes(guess));
        return name ? XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "" }) : [];
      };
      const projects = rowsToProjects(sheetNamed("project"), sheetNamed("database"));
      if (!projects.length) {
        toast.error('No rows found under a "name" column on a Projects sheet.');
        reset();
        return;
      }
      setPreview(projects);
    } catch (err) {
      toast.error("We couldn't read that file.");
      reset();
    }
  };

  const run = async () => {
    try {
      setBusy(true);
      const n = await onImport(preview, (done, total) => setProgress({ done, total }));
      toast.success(`${n} project${n === 1 ? "" : "s"} imported and encrypted.`);
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
          <h2 className="sheet__title">Import projects</h2>
          <p className="sheet__sub">The project-tracker Excel template — Projects and Databases sheets. Add env vars afterward with the paste tool on each project.</p>
        </div>

        <label className="dropzone">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={pick} hidden />
          <Upload size={20} />
          <span>{file ? file.name : "Choose an .xlsx file"}</span>
          <small>Nothing leaves your browser unencrypted.</small>
        </label>

        {preview ? (
          <div className="import__preview">
            <p>
              <strong>{preview.length}</strong> project{preview.length === 1 ? "" : "s"} found
              {preview.length ? `: ${preview.slice(0, 4).map((p) => p.name || "Untitled").join(", ")}${preview.length > 4 ? "…" : ""}` : "."}
            </p>
            {progress ? (
              <div className="progress"><span style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
            ) : null}
            <button type="button" className="btn btn--primary btn--block" onClick={run} disabled={!preview.length || busy}>
              <span className="btn__sheen" />
              {busy ? <span className="spinner" /> : <Check size={15} />}
              {busy ? "Encrypting…" : `Import ${preview.length} project${preview.length === 1 ? "" : "s"}`}
            </button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
