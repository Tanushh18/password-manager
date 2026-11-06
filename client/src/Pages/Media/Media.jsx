import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { Arrow, Trash } from "../../Components/Icons/Icons";
import * as api from "../../api/client";
import "./Media.css";

/* ShineOne Estate website photos and videos, per sector / area - the same folders the Tasks app manages. */

const kindOf = (file) => (file.type && file.type.startsWith("video/") ? "video" : "image");

/** Sends one file straight to Cloudinary with the signed parameters the server made. */
function uploadFile(sig, file, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("api_key", sig.apiKey);
    form.append("timestamp", String(sig.timestamp));
    form.append("signature", sig.signature);
    form.append("folder", sig.folder);
    form.append("tags", sig.tags);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", sig.uploadUrl);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = "Upload failed (" + xhr.status + ")";
      try { message = JSON.parse(xhr.responseText).error.message || message; } catch (e) { /* keep generic */ }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error("No connection. Check your internet and try again."));
    xhr.send(form);
  });
}

/** Tries to load one file the way a visitor's browser would; true if it came through. */
const probe = (url) => new Promise((resolve) => {
  const img = new Image();
  const timer = setTimeout(() => resolve(false), 20000);
  img.onload = () => { clearTimeout(timer); resolve(true); };
  img.onerror = () => { clearTimeout(timer); resolve(false); };
  img.src = url;
});

/** { [sectorKey]: { ok, total } } - how many of each sector's files actually load. */
function useLoadCheck(projects) {
  const [result, setResult] = useState({});
  const [checking, setChecking] = useState(false);
  const run = useCallback(async () => {
    if (!projects) return;
    setChecking(true);
    const out = {};
    for (const p of projects) {
      // Videos are checked through their poster thumbnail.
      const oks = await Promise.all(p.items.map((i) => probe(i.thumb || i.url)));
      out[p.key] = { ok: oks.filter(Boolean).length, total: oks.length };
    }
    setResult(out);
    setChecking(false);
  }, [projects]);
  useEffect(() => { run(); }, [run]);
  return { result, checking, recheck: run };
}

const STAGES = ["", "Foundation", "Structure", "Finishing", "Interior Works", "Final Inspection", "Handover"];

/** Progress %, stage and ETA the website shows for one sector / project. */
function StatusEditor({ project, onSaved }) {
  const [form, setForm] = useState({ status: project.status, area: project.area, progress: project.progress, stage: project.stage, eta: project.eta });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { onSaved(await api.updateShineSite(project.key, { ...form, progress: Number(form.progress) })); toast.success("Website status saved."); }
    catch (err) { toast.error(api.errorMessage(err, "Could not save.")); }
    finally { setSaving(false); }
  };
  return (
    <form className="media__status" onSubmit={save}>
      <label>Status<select className="input" value={form.status} onChange={set("status")}><option>Ongoing</option><option>Completed</option></select></label>
      <label>Area<input className="input" value={form.area} onChange={set("area")} maxLength={60} /></label>
      <label>Progress %<input className="input" type="number" min="0" max="100" value={form.status === "Completed" ? 100 : form.progress} onChange={set("progress")} disabled={form.status === "Completed"} /></label>
      <label>Stage<select className="input" value={form.stage} onChange={set("stage")} disabled={form.status === "Completed"}>{STAGES.map((s) => <option key={s} value={s}>{s || "Automatic"}</option>)}</select></label>
      <label>ETA<input className="input" value={form.eta} onChange={set("eta")} maxLength={60} placeholder="June 2027" /></label>
      <button className="btn btn--primary btn--sm" type="submit" disabled={saving}>{saving ? "Saving…" : "Save status"}</button>
    </form>
  );
}

/** Pick or drop many files at once, choose the folder (or make a new one), and watch each file upload. */
function BulkUploader({ projects, configured, onDone }) {
  const [target, setTarget] = useState("");
  const [newName, setNewName] = useState("");
  const [files, setFiles] = useState([]);
  const [rows, setRows] = useState([]);
  const [running, setRunning] = useState(false);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);
  const creating = target === "__new";
  const ready = files.length > 0 && (creating ? newName.trim() : target) && configured && !running;

  const addFiles = (list) => {
    const ok = [...list].filter((f) => /^(image|video)\//.test(f.type));
    if (ok.length < list.length) toast.info("Only photos and videos can be added.");
    setFiles((cur) => [...cur, ...ok]);
  };
  const setRow = (i, patch) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const start = async () => {
    setRunning(true);
    let key = target;
    try {
      if (creating) { const added = await api.addShineProject(newName); key = added.key; setTarget(key); setNewName(""); }
    } catch (err) { toast.error(api.errorMessage(err, "Could not create the folder.")); setRunning(false); return; }
    const queue = files;
    setRows(queue.map((f) => ({ name: f.name, pct: 0, state: "wait" })));
    let done = 0;
    for (let i = 0; i < queue.length; i++) {
      try {
        setRow(i, { state: "up" });
        const sig = await api.signShineUpload(key, kindOf(queue[i]));
        await uploadFile(sig, queue[i], (f) => setRow(i, { pct: Math.round(f * 100) }));
        setRow(i, { state: "ok", pct: 100 });
        done++;
      } catch (err) { setRow(i, { state: "fail", error: err.message }); }
    }
    setFiles([]);
    if (inputRef.current) inputRef.current.value = "";
    if (done) { await api.markShineUploaded().catch(() => {}); await onDone(key); toast.success(done + " of " + queue.length + " uploaded."); }
    else toast.error("Nothing was uploaded.");
    setRunning(false);
  };

  return (
    <section className="card media__bulk" aria-label="Upload many photos and videos">
      <h2>Upload photos / videos</h2>
      <div className="media__bulkrow">
        <label>Folder
          <select className="input" value={target} onChange={(e) => setTarget(e.target.value)} disabled={running}>
            <option value="">Choose a folder…</option>
            {projects.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            <option value="__new">+ New folder…</option>
          </select>
        </label>
        {creating && <label>New folder name<input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={40} placeholder="e.g. Sector 12" disabled={running} /></label>}
      </div>
      <div
        className={"media__drop" + (drag ? " media__drop--on" : "")}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (!running) addFiles(e.dataTransfer.files); }}
      >
        <p>{files.length ? files.length + " file" + (files.length === 1 ? "" : "s") + " ready" : "Drag photos and videos here, or"}</p>
        <label className={"btn btn--ghost btn--sm" + (running ? " is-disabled" : "")}>
          Choose files
          <input ref={inputRef} type="file" accept="image/*,video/*" multiple hidden disabled={running} onChange={(e) => addFiles(e.target.files)} />
        </label>
      </div>
      <div className="media__bulkrow">
        <button type="button" className="btn btn--primary btn--sm" disabled={!ready} onClick={start}>{running ? "Uploading…" : "Upload " + (files.length || "") + (files.length === 1 ? " file" : " files")}</button>
        {files.length > 0 && !running && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setFiles([])}>Clear</button>}
      </div>
      {rows.length > 0 && (
        <ul className="media__queue">
          {rows.map((r, i) => (
            <li key={i} className={"media__q media__q--" + r.state}>
              <span>{r.name}</span>
              <small>{r.state === "ok" ? "✓ Done" : r.state === "fail" ? "✗ " + (r.error || "Failed") : r.state === "up" ? r.pct + "%" : "Waiting"}</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function Media() {
  const [site, setSite] = useState(null);
  const [projects, setProjects] = useState(null);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState("");
  const fileRef = useRef(null);
  const { result: loadStatus, checking, recheck } = useLoadCheck(projects);

  const load = useCallback(() => api.getShineProjects()
    .then((d) => { setProjects(d.projects); setConfigured(d.configured); setError(""); })
    .catch((err) => setError(api.errorMessage(err, "Could not load the photos."))), []);
  useEffect(() => { load(); api.getShineSite().then(setSite).catch(() => {}); }, [load]);

  const addSector = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      const added = await api.addShineProject(newName);
      setNewName("");
      await load();
      setOpen(added.key);
      toast.success(added.label + " added. Now add its photos.");
    } catch (err) { toast.error(api.errorMessage(err, "Could not add it.")); }
  };

  const isVisible = (key) => { const p = site && site.projects.find((x) => x.key === key); return !p || p.visible !== false; };
  const toggleVisible = async (key) => {
    try { setSite(await api.updateShineSite(key, { visible: !isVisible(key) })); toast.success(isVisible(key) ? "Hidden from the website." : "Shown on the website."); }
    catch (err) { toast.error(api.errorMessage(err, "Could not change it.")); }
  };

  const upload = async (files) => {
    if (!files.length || !open) return;
    let done = 0, failed = "";
    for (let i = 0; i < files.length; i++) {
      try {
        setBusy("Uploading " + (i + 1) + " of " + files.length + "…");
        const sig = await api.signShineUpload(open, kindOf(files[i]));
        await uploadFile(sig, files[i], (f) => setBusy("Uploading " + (i + 1) + " of " + files.length + " · " + Math.round(f * 100) + "%"));
        done++;
      } catch (err) { failed = failed || err.message; }
    }
    setBusy("");
    if (fileRef.current) fileRef.current.value = "";
    if (done) { await api.markShineUploaded().catch(() => {}); await load(); toast.success(done + " file" + (done === 1 ? "" : "s") + " added."); }
    if (failed) toast.error(failed);
  };

  const remove = async (item) => {
    if (!window.confirm("Remove this " + item.kind + " from the website?")) return;
    try { await api.deleteShineMedia(item); await load(); toast.success("Removed."); }
    catch (err) { toast.error(api.errorMessage(err, "Could not remove it.")); }
  };

  const current = projects && projects.find((p) => p.key === open);
  return (
    <div className="media page">
      <div className="shell-narrow">
        <header className="settings__top">
          <Link to="/settings" className="proj-back"><Arrow size={14} style={{ transform: "rotate(180deg)" }} /> Settings</Link>
          <h1 className="vault__title">ShineOne Estate Manager</h1>
          <p className="vault__count">Photos and videos you add here appear on the ShineOne Estate website, per sector or area. Same folders as the Tasks app.</p>
        </header>
        {error && <p className="servers__error">{error}</p>}
        {!projects && !error && <p className="servers__hint">Loading…</p>}
        {projects && !configured && <p className="servers__error">The website photo service isn't set up on the server yet (CLOUDINARY_*_shine variables).</p>}
        {projects && (
          <>
            <form className="card media__add" onSubmit={addSector}>
              <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Add a sector or area, e.g. Sector 12" maxLength={40} aria-label="New sector or area name" />
              <button className="btn btn--primary btn--sm" type="submit" disabled={!newName.trim()}>Add sector / area</button>
            </form>
            <BulkUploader projects={projects} configured={configured} onDone={async (key) => { await load(); api.getShineSite().then(setSite).catch(() => {}); setOpen(key); }} />
            <div className="media__grid">
              {projects.map((p) => {
                const cover = p.items[0];
                const st = loadStatus[p.key];
                const live = isVisible(p.key);
                return (
                  <div key={p.key} className={"card media__sector" + (p.key === open ? " media__sector--on" : "") + (live ? "" : " media__sector--hidden")}>
                    <button type="button" className="media__sector-main" onClick={() => setOpen(p.key === open ? "" : p.key)}>
                      {cover ? <img src={cover.thumb} alt="" loading="lazy" /> : <span className="media__empty">No photos</span>}
                      <strong>{p.label}</strong>
                      <small>{p.items.filter((i) => i.kind === "image").length} photos · {p.items.filter((i) => i.kind === "video").length} videos</small>
                    </button>
                    <small className={"media__load" + (st && st.ok < st.total ? " media__load--bad" : "")}>
                      {!st ? "Checking…" : st.total === 0 ? "No files" : st.ok === st.total ? "✓ All " + st.total + " loading" : "✗ " + (st.total - st.ok) + " of " + st.total + " not loading"}
                    </small>
                    <label className="media__toggle">
                      <input type="checkbox" checked={live} onChange={() => toggleVisible(p.key)} />
                      <span>{live ? "Shown on website" : "Hidden from website"}</span>
                    </label>
                  </div>
                );
              })}
            </div>
            <p className="servers__hint">Load check opens each file like a visitor's browser would. <button type="button" className="btn btn--ghost btn--sm" onClick={recheck} disabled={checking}>{checking ? "Checking…" : "Check again"}</button></p>
            {current && (
              <section className="card media__panel" aria-label={current.label + " files"}>
                <div className="servers__head">
                  <h2>{current.label}</h2>
                  <label className={"btn btn--primary btn--sm" + (busy || !configured ? " is-disabled" : "")}>
                    {busy || "Add photos / videos"}
                    <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden disabled={Boolean(busy) || !configured} onChange={(e) => upload([...e.target.files])} />
                  </label>
                </div>
                {site && site.projects.find((p) => p.key === current.key) && (
                  <StatusEditor key={current.key} project={site.projects.find((p) => p.key === current.key)} onSaved={setSite} />
                )}
                {current.items.length === 0 && <p className="servers__hint">Nothing here yet.</p>}
                <div className="media__files">
                  {current.items.map((item) => (
                    <figure key={item.publicId} className="media__file">
                      <a href={item.url} target="_blank" rel="noreferrer"><img src={item.thumb} alt="" loading="lazy" />{item.kind === "video" && <span className="media__badge">Video</span>}</a>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => remove(item)} aria-label="Remove"><Trash size={14} /></button>
                    </figure>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
