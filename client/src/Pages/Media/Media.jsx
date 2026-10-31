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

export default function Media() {
  const [site, setSite] = useState(null);
  const [projects, setProjects] = useState(null);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState("");
  const fileRef = useRef(null);

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
          <h1 className="vault__title">Website photos</h1>
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
            <div className="media__grid">
              {projects.map((p) => {
                const cover = p.items[0];
                return (
                  <button key={p.key} type="button" className={"card media__sector" + (p.key === open ? " media__sector--on" : "")} onClick={() => setOpen(p.key === open ? "" : p.key)}>
                    {cover ? <img src={cover.thumb} alt="" loading="lazy" /> : <span className="media__empty">No photos</span>}
                    <strong>{p.label}</strong>
                    <small>{p.items.filter((i) => i.kind === "image").length} photos · {p.items.filter((i) => i.kind === "video").length} videos</small>
                  </button>
                );
              })}
            </div>
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
