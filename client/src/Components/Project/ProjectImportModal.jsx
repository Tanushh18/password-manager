import React, { useRef, useState } from "react";
import { Modal } from "react-responsive-modal";
import "react-responsive-modal/styles.css";
import { toast } from "react-toastify";
import { rowsToProjects } from "../../lib/projectItems";
import { parseCSV } from "../../lib/items";
import { Upload, Check, Refresh } from "../../Components/Icons/Icons";

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
  const [projectsUrl, setProjectsUrl] = useState("");
  const [databasesUrl, setDatabasesUrl] = useState("");
  const [syncing, setSyncing] = useState(false);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setProgress(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const syncFromUrls = async () => {
    if (!projectsUrl.trim()) { toast.error("Paste the Projects sheet's published CSV link first."); return; }
    setSyncing(true);
    try {
      const fetchCsv = async (url) => {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`Couldn't fetch that link (${res.status}).`);
        return parseCSV(await res.text());
      };
      const projectRows = await fetchCsv(projectsUrl.trim());
      const databaseRows = databasesUrl.trim() ? await fetchCsv(databasesUrl.trim()) : [];
      const projects = rowsToProjects(projectRows, databaseRows);
      if (!projects.length) {
        toast.error('No rows found under a "name" column. Check the link is the Projects sheet, published as CSV.');
        return;
      }
      setFile(null);
      setPreview(projects);
      toast.success(`Fetched ${projects.length} project${projects.length === 1 ? "" : "s"} from the sheet.`);
    } catch (err) {
      toast.error(err.message || "Couldn't sync from that link. Make sure the sheet is published to the web.");
    } finally {
      setSyncing(false);
    }
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

        <div className="proj-sync">
          <label className="field__label" htmlFor="pi-projects-url">Projects sheet — published CSV link</label>
          <input
            id="pi-projects-url"
            className="input"
            placeholder="https://docs.google.com/spreadsheets/d/e/.../pub?gid=...&single=true&output=csv"
            value={projectsUrl}
            onChange={(e) => setProjectsUrl(e.target.value)}
          />
          <label className="field__label" htmlFor="pi-databases-url" style={{ marginTop: "0.6rem" }}>Databases sheet link (optional)</label>
          <input
            id="pi-databases-url"
            className="input"
            placeholder="Same as above, but for the Databases tab"
            value={databasesUrl}
            onChange={(e) => setDatabasesUrl(e.target.value)}
          />
          <p className="field__note" style={{ margin: "0.5rem 0 0.7rem" }}>
            In Google Sheets: File → Share → Publish to web → pick the sheet tab → CSV → Publish, then copy the link. Fetched fresh from your browser each time you click Sync — nothing is cached on a server.
          </p>
          <button type="button" className="btn btn--ghost btn--block" onClick={syncFromUrls} disabled={syncing}>
            {syncing ? <span className="spinner" /> : <Refresh size={15} />} {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>

        <p className="field__note" style={{ textAlign: "center", margin: "0.9rem 0" }}>— or —</p>

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
