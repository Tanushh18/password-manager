import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { createPhotoImport, deletePhotoImport, errorMessage, getPhotoCloudDashboard, getPhotoImport, listPhotoImports, photoImportAction } from "../../api/client";
import "./PhotoImport.css";

const size = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n || 0} B`);
const span = (s) => (s == null ? "unknown" : s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);
const ago = (v) => { const m = Math.max(0, Math.round((Date.now() - new Date(v).getTime()) / 60000)); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`; };
const LABEL = { picking: "Waiting for your selection", listing: "Reading your selection", running: "Importing", paused: "Paused", completed: "Finished", cancelled: "Cancelled", expired: "Expired", failed: "Failed" };
const STAGE_LABEL = { downloading: "Downloading from Google Photos", uploading: "Uploading to Drive", verifying: "Checking the copy" };
const TERMINAL = new Set(["completed", "cancelled", "expired", "failed"]);

function Pipeline({ stages, total }) {
  const boxes = [["Chosen", total, "chosen"], ["Waiting", stages.pending, "pending"], ["Downloading", stages.downloading, "downloading"], ["Uploading", stages.uploading, "uploading"], ["Checking", stages.verifying, "verifying"], ["In Drive", stages.done, "done"]];
  return (
    <ol className="pi-flow" aria-label="Pipeline stages">
      {boxes.map(([name, n, cls]) => <li key={cls} className={`pi-flow__step pi-flow__step--${cls} ${n > 0 ? "is-live" : ""}`}><span>{name}</span><strong>{n}</strong></li>)}
    </ol>
  );
}

function Detail({ id, onChanged }) {
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState("");
  const timer = useRef(null);

  const load = useCallback(async () => {
    try { const v = await getPhotoImport(id); setView(v); return v; }
    catch (e) { toast.error(errorMessage(e, "Could not load this import.")); return null; }
  }, [id]);
  useEffect(() => {
    setView(null);
    let stop = false;
    const loop = async () => { const v = await load(); if (!stop && !(v && TERMINAL.has(v.batch.status))) timer.current = setTimeout(loop, 3000); };
    void loop();
    return () => { stop = true; clearTimeout(timer.current); };
  }, [id, load]);

  const act = async (action) => {
    setBusy(action);
    try { await photoImportAction(id, action); await load(); onChanged(); }
    catch (e) { toast.error(errorMessage(e, "That did not work.")); }
    finally { setBusy(""); }
  };
  if (!view) return <section className="card pi-detail"><p className="pi-muted">Loading…</p></section>;

  const { batch, stages, speed, active, recent, failed, retrying, events } = view;
  const c = batch.counts;
  const finished = c.done + c.skipped + c.failed;
  const pct = c.total ? Math.round((finished / c.total) * 100) : 0;

  return (
    <section className="card pi-detail">
      <header className="pi-detail__head">
        <div>
          <h2>{batch.label}</h2>
          <p className="pi-muted">Started {batch.startedAt ? ago(batch.startedAt) : "after you choose photos"} · {batch.concurrency === 1 ? "one file at a time" : `${batch.concurrency} files at a time`}</p>
        </div>
        <span className={`pi-chip pi-chip--${batch.status}`}>{LABEL[batch.status] || batch.status}</span>
      </header>

      {batch.pauseReason && batch.status === "paused" ? <p className="pi-note pi-note--warn">{batch.pauseReason}</p> : null}

      {batch.status === "picking" ? (
        <div className="pi-picking">
          <p>Google Photos is open in another tab. Choose the albums or photos you want (up to 2,000 per round), then press <b>Done</b> there. This page notices and starts the import by itself.</p>
          <div className="pi-actions">
            <a className="btn btn--primary" href={batch.pickerUri} target="_blank" rel="noreferrer">Open Google Photos</a>
            <button className="btn btn--ghost" disabled={busy === "check"} onClick={() => void act("check")}>I have finished choosing</button>
            <button className="btn btn--ghost" disabled={busy === "cancel"} onClick={() => void act("cancel")}>Cancel</button>
          </div>
          <p className="pi-muted">For a library of 50,000 photos, repeat this about 25 times; each round is its own import. Rounds can run one after another.</p>
        </div>
      ) : (
        <>
          <div className="pi-tiles">
            <div><span>In Drive</span><strong>{c.done}</strong></div>
            <div><span>Left</span><strong>{speed.remainingItems}</strong></div>
            <div><span>Already had</span><strong>{c.skipped}</strong></div>
            <div className={c.failed ? "is-bad" : ""}><span>Failed</span><strong>{c.failed}</strong></div>
          </div>
          <div className="pi-bar" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100"><i style={{ width: `${pct}%` }} /></div>
          <p className="pi-muted">{finished} of {c.total} handled ({pct}%) · {size(c.bytesDone)} copied</p>

          <h3>Speed</h3>
          <div className="pi-speed">
            <div><span>Throughput</span><strong>{speed.bytesPerSec ? `${size(speed.bytesPerSec)}/s` : "–"}</strong></div>
            <div><span>Files per minute</span><strong>{speed.itemsPerMin || "–"}</strong></div>
            <div><span>Time left</span><strong>{batch.status === "running" ? span(speed.etaSeconds) : "–"}</strong></div>
          </div>

          <h3>Pipeline</h3>
          <Pipeline stages={stages} total={c.total} />
          <p className="pi-muted">Each file is downloaded from Google Photos, streamed to Drive in 8 MB pieces (nothing is saved on the server), then checked by size and checksum before it counts.</p>

          <h3>In progress now</h3>
          {active.length === 0 ? <p className="pi-muted">{batch.status === "running" ? "Waiting for the next file…" : "Nothing is moving."}</p> : (
            <ul className="pi-list">
              {active.map((a) => {
                const p = a.bytes ? Math.min(100, Math.round((a.bytesDone / a.bytes) * 100)) : null;
                return (
                  <li key={a.id}>
                    <div className="pi-row"><strong>{a.filename}</strong><span className={`pi-stage pi-stage--${a.stage}`}>{STAGE_LABEL[a.stage]}</span></div>
                    {p !== null ? <div className="pi-bar pi-bar--thin"><i style={{ width: `${p}%` }} /></div> : null}
                    <small>{a.bytes ? `${size(a.bytesDone)} of ${size(a.bytes)}` : "size not reported yet"}{a.attempt > 1 ? ` · attempt ${a.attempt}` : ""}{a.server ? ` · on ${a.server}` : ""}{a.since ? ` · ${ago(a.since)}` : ""}</small>
                  </li>
                );
              })}
            </ul>
          )}

          {retrying.length ? (
            <>
              <h3>Waiting to retry ({retrying.length})</h3>
              <ul className="pi-list">{retrying.map((r) => <li key={r.id}><div className="pi-row"><strong>{r.filename}</strong><span className="pi-muted">attempt {r.attempts}{r.retryAt ? ` · again ${ago(r.retryAt) === "just now" ? "now" : "soon"}` : ""}</span></div><small>{r.error}</small></li>)}</ul>
            </>
          ) : null}

          {failed.length ? (
            <>
              <h3>Failed ({c.failed})</h3>
              <ul className="pi-list">{failed.map((f) => <li key={f.id}><div className="pi-row"><strong>{f.filename}</strong><span className="pi-muted">{f.attempts} tries</span></div><small className="pi-bad">{f.error}</small></li>)}</ul>
              <button className="btn btn--ghost btn--sm" disabled={busy === "retry-failed"} onClick={() => void act("retry-failed")}>Retry all failed</button>
            </>
          ) : null}

          {recent.length ? (
            <>
              <h3>Recently finished</h3>
              <ul className="pi-list pi-list--compact">{recent.map((r) => <li key={r.id}><div className="pi-row"><strong>{r.filename}</strong><span className="pi-muted">{r.status === "skipped" ? r.note : `${size(r.bytes)}${r.seconds != null ? ` in ${r.seconds} s` : ""}${r.destination ? ` → ${r.destination}` : ""}`}</span></div></li>)}</ul>
            </>
          ) : null}

          <div className="pi-actions">
            {batch.status === "running" ? <button className="btn btn--ghost" disabled={!!busy} onClick={() => void act("pause")}>Pause</button> : null}
            {batch.status === "paused" ? <button className="btn btn--primary" disabled={!!busy} onClick={() => void act("resume")}>Resume</button> : null}
            {["running", "paused"].includes(batch.status) ? <button className="btn btn--ghost" disabled={!!busy} onClick={() => { if (window.confirm("Cancel this import? Files already in Drive stay there.")) void act("cancel"); }}>Cancel</button> : null}
          </div>
        </>
      )}

      <h3>Log</h3>
      <ul className="pi-log">{events.map((e, i) => <li key={i} className={`pi-log--${e.level}`}><time>{new Date(e.at).toLocaleTimeString()}</time> {e.message}</li>)}</ul>
    </section>
  );
}

export default function PhotoImport() {
  const [batches, setBatches] = useState(null);
  const [selected, setSelected] = useState("");
  const [accounts, setAccounts] = useState([]);
  const [label, setLabel] = useState("");
  const [source, setSource] = useState("");
  const [parallel, setParallel] = useState(1);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    try { const r = await listPhotoImports(); setBatches(r.batches); setSelected((s) => s || r.batches[0]?.id || ""); }
    catch (e) { toast.error(errorMessage(e, "Could not load imports.")); setBatches([]); }
  }, []);
  useEffect(() => {
    void refresh();
    getPhotoCloudDashboard().then((d) => { const ok = (d.connections || []).filter((c) => c.status === "connected" && c.oauthMode === "connected"); setAccounts(ok); setSource((s) => s || ok[0]?.id || ""); }).catch(() => {});
  }, [refresh]);
  useEffect(() => { const t = setInterval(() => void refresh(), 10000); return () => clearInterval(t); }, [refresh]);

  const start = async (event) => {
    event.preventDefault();
    setCreating(true);
    try {
      const { batch } = await createPhotoImport({ label: label.trim(), sourceConnectionId: source, concurrency: parallel });
      setLabel(""); await refresh(); setSelected(batch.id);
      window.open(batch.pickerUri, "_blank", "noopener");
      toast.info("Google Photos opened in a new tab. Choose your photos there.");
    } catch (e) { toast.error(errorMessage(e, "Could not start the import.")); }
    finally { setCreating(false); }
  };
  const remove = async (b) => {
    if (!window.confirm(`Remove "${b.label}" from this list? Files already in Drive are not touched.`)) return;
    try { await deletePhotoImport(b.id); setSelected(""); await refresh(); } catch (e) { toast.error(errorMessage(e, "Could not remove it.")); }
  };

  return (
    <main className="pi page"><div className="shell">
      <header className="pi-head">
        <Link to="/photos" className="proj-back">← Photos</Link>
        <p className="eyebrow">Admin pipeline</p>
        <h1>Import from Google Photos</h1>
        <p className="pi-muted pi-lede">Google does not let apps read a whole Google Photos library, so you choose photos with Google's own picker (up to 2,000 at a time). Stashr then copies them into your Drive one after another, in the background, and files them in a folder you name. You can close this page; the work continues on the server.</p>
      </header>

      <div className="pi-layout">
        <aside className="pi-side">
          <form className="card pi-new" onSubmit={start}>
            <h2>New import</h2>
            <label>Folder name in Drive<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Holidays 2019" maxLength={60} required /></label>
            <label>Google Photos account
              <select value={source} onChange={(e) => setSource(e.target.value)} required>
                {accounts.length === 0 ? <option value="">No connected account</option> : accounts.map((a) => <option key={a.id} value={a.id}>{a.label} ({a.email})</option>)}
              </select>
            </label>
            <label>Speed
              <select value={parallel} onChange={(e) => setParallel(Number(e.target.value))}>
                <option value={1}>One file at a time (gentlest)</option>
                <option value={2}>Two at a time</option>
                <option value={3}>Three at a time</option>
              </select>
            </label>
            <button className="btn btn--primary" disabled={creating || !label.trim() || !source}>{creating ? "Opening…" : "Choose photos in Google Photos"}</button>
            <p className="pi-muted">If Google says it needs permission, reconnect the account on the Photos page first. The picker needs a new permission.</p>
          </form>

          <div className="card pi-batches">
            <h2>Imports</h2>
            {!batches ? <p className="pi-muted">Loading…</p> : batches.length === 0 ? <p className="pi-muted">None yet.</p> : (
              <ul>
                {batches.map((b) => (
                  <li key={b.id} className={b.id === selected ? "is-selected" : ""}>
                    <button type="button" onClick={() => setSelected(b.id)}>
                      <strong>{b.label}</strong>
                      <span className={`pi-chip pi-chip--${b.status}`}>{LABEL[b.status] || b.status}</span>
                      <small>{b.counts.done + b.counts.skipped + b.counts.failed} of {b.counts.total || "?"} · {ago(b.createdAt)}</small>
                    </button>
                    {!["running", "listing"].includes(b.status) ? <button type="button" className="pi-x" aria-label={`Remove ${b.label}`} onClick={() => void remove(b)}>×</button> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
        <div>{selected ? <Detail id={selected} onChanged={() => void refresh()} /> : <section className="card pi-detail"><p className="pi-muted">Start an import, or pick one from the list.</p></section>}</div>
      </div>
    </div></main>
  );
}
