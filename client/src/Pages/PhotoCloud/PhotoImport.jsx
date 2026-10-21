import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { createPhotoImport, deletePhotoImport, errorMessage, getPhotoCloudDashboard, getPhotoImport, listPhotoImports, photoImportAction, renamePhotoImport, startPhotoGoogleOAuth } from "../../api/client";
import "./PhotoImport.css";

const size = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n || 0} B`);
const span = (s) => (s == null ? "unknown" : s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);
const ago = (v) => { const m = Math.max(0, Math.round((Date.now() - new Date(v).getTime()) / 60000)); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`; };
const LABEL = { picking: "Waiting for your selection", listing: "Reading your selection", running: "Importing", paused: "Paused", completed: "Finished", cancelled: "Cancelled", expired: "Expired", failed: "Failed" };
const STAGE_LABEL = { downloading: "Downloading from Google Photos", uploading: "Uploading to Drive", verifying: "Checking the copy" };
const TERMINAL = new Set(["completed", "cancelled", "expired", "failed"]);
const freeOf = (a) => (a.limitGb == null ? null : Math.max(0, a.limitGb - (a.usedGb || 0)));

function Pipeline({ stages, total }) {
  const boxes = [["Chosen", total, "chosen"], ["Waiting", stages.pending, "pending"], ["Downloading", stages.downloading, "downloading"], ["Uploading", stages.uploading, "uploading"], ["Checking", stages.verifying, "verifying"], ["In Drive", stages.done, "done"]];
  return (
    <ol className="pi-flow" aria-label="Pipeline stages">
      {boxes.map(([name, n, cls]) => <li key={cls} className={`pi-flow__step pi-flow__step--${cls} ${n > 0 ? "is-live" : ""}`}><span>{name}</span><strong>{n}</strong></li>)}
    </ol>
  );
}

/* Name the folder after the import. Renames it in Stashr and in Drive. */
function FolderName({ batch, onSaved }) {
  const [value, setValue] = useState(batch.label);
  const [saving, setSaving] = useState(false);
  useEffect(() => setValue(batch.label), [batch.label]);
  const save = async () => {
    const next = value.trim();
    if (!next || next === batch.label) return;
    setSaving(true);
    try { await renamePhotoImport(batch.id, next); toast.success("Folder name saved in Stashr and Drive."); onSaved(); }
    catch (e) { toast.error(errorMessage(e, "Could not rename the folder.")); }
    finally { setSaving(false); }
  };
  return (
    <div className="pi-rename">
      <label>Folder name<input value={value} onChange={(e) => setValue(e.target.value)} maxLength={60} /></label>
      <button className="btn btn--ghost btn--sm" disabled={saving || !value.trim() || value.trim() === batch.label} onClick={() => void save()}>{saving ? "Saving…" : "Save name"}</button>
    </div>
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

  const { batch, stages, speed, active, recent, failed, retrying, events, storage, destinations = [] } = view;
  const c = batch.counts;
  const freeTotal = destinations.reduce((n, d) => n + (d.freeGb || 0), 0);
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

      <FolderName batch={batch} onSaved={onChanged} />

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

          <h3>Storage</h3>
          <div className="pi-speed">
            <div><span>Needed</span><strong>{storage?.measured ? `${size(storage.bytes)}${storage.measured < c.total ? "+" : ""}` : "not reported"}</strong></div>
            <div><span>Free in these accounts</span><strong>{freeTotal.toFixed(1)} GB</strong></div>
            <div><span>Accounts</span><strong>{destinations.length}</strong></div>
          </div>
          <p className="pi-muted">{destinations.map((d) => `${d.label}${d.freeGb == null ? " (space unknown)" : ` (${d.freeGb.toFixed(1)} GB free)`}`).join(" · ") || "No account selected."}</p>

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

      {batch.status === "completed" && c.done > 0 ? (
        <div className="pi-note">
          <strong>Before you delete anything in Google Photos</strong>
          <ol>
            <li>Check that Drive has the {c.done} copied file(s) in the folder "{batch.label}".</li>
            <li>Open a few of them in Stashr to make sure they look right.</li>
            <li>Only then delete the originals in Google Photos yourself. Stashr cannot delete them, because Google does not let apps delete Photos items.</li>
          </ol>
          <a className="btn btn--ghost btn--sm" href="https://photos.google.com/" target="_blank" rel="noreferrer">Open Google Photos</a>
        </div>
      ) : null}

      <h3>Log</h3>
      <ul className="pi-log">{events.map((e, i) => <li key={i} className={`pi-log--${e.level}`}><time>{new Date(e.at).toLocaleTimeString()}</time> {e.message}</li>)}</ul>
    </section>
  );
}

export default function PhotoImport() {
  const location = useLocation();
  const [batches, setBatches] = useState(null);
  const [selected, setSelected] = useState("");
  const [accounts, setAccounts] = useState([]);
  const [label, setLabel] = useState("");
  const [source, setSource] = useState("");
  const [parallel, setParallel] = useState(1);
  const [creating, setCreating] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [accountWarning, setAccountWarning] = useState("");
  const [destIds, setDestIds] = useState([]);

  const refresh = useCallback(async () => {
    try { const r = await listPhotoImports(); setBatches(r.batches); setSelected((s) => s || r.batches[0]?.id || ""); }
    catch (e) { toast.error(errorMessage(e, "Could not load imports.")); setBatches([]); }
  }, []);
  useEffect(() => {
    const result = new URLSearchParams(location.search).get("google");
    if (result === "connected") toast.success("Google account connected. Choose photos below to import them into Stashr.");
    else if (result === "missing_scope") { setAccountWarning("Google did not grant the Photos Picker and Drive permissions. Reconnect and approve every requested permission."); toast.error("Google Photos permission is still missing."); }
    else if (result === "error") toast.error("Google reconnect failed. Check the Google OAuth configuration and try again.");
    else if (result === "cancelled") toast.info("Google connection was cancelled.");
    if (result) window.history.replaceState({}, "", location.pathname);
    void refresh();
    getPhotoCloudDashboard().then((d) => { const all = d.connections || []; const ok = all.filter((c) => c.status === "connected" && c.oauthMode === "connected"); setAccounts(ok); setDestIds((d) => (d.length ? d : ok.map((a) => a.id))); setSource((s) => ok.some((a) => a.id === s) ? s : (ok[0]?.id || "")); setAccountWarning(ok.length ? "" : (all.length ? "Your saved Google account needs to be reconnected before importing." : "Connect a Google account to start importing.")); }).catch(() => { setAccountWarning("Could not check Google account status. Reconnect or refresh the page."); });
  }, [refresh, location.pathname, location.search]);
  useEffect(() => { const t = setInterval(() => void refresh(), 10000); return () => clearInterval(t); }, [refresh]);

  const reconnect = async () => {
    setReconnecting(true);
    try { const result = await startPhotoGoogleOAuth("Google Photos import", "/photos/import"); window.location.assign(result.url); }
    catch (e) { toast.error(errorMessage(e, "Could not open Google reconnect. Check that Google OAuth is configured.")); setReconnecting(false); }
  };

  const start = async (event) => {
    event.preventDefault();
    // Reserve the new tab during the user's click. A window.open() after the
    // awaited API request is often blocked by browser popup protection.
    const pickerWindow = window.open("about:blank", "_blank");
    if (pickerWindow) {
      try {
        pickerWindow.document.title = "Opening Google Photos…";
        pickerWindow.document.body.innerHTML = "<p style='font-family:system-ui;padding:24px'>Opening Google Photos picker…</p>";
      } catch {}
    }
    setCreating(true);
    try {
      const { batch } = await createPhotoImport({ label: label.trim(), sourceConnectionId: source, destinationIds: destIds, concurrency: parallel });
      setLabel(""); await refresh(); setSelected(batch.id);
      if (pickerWindow && !pickerWindow.closed) pickerWindow.location.href = batch.pickerUri;
      else toast.warn("Your browser blocked the picker popup. Use the Open Google Photos button in the import panel.");
      toast.info("Select photos/videos in Google Photos and press Done. Return here to watch the import.");
    } catch (e) {
      if (pickerWindow && !pickerWindow.closed) pickerWindow.close();
      const message = errorMessage(e, "Could not start the import.");
      if (/reconnect|permission|pick a connected google account|401|403/i.test(message)) { setAccountWarning("Google needs permission again. Reconnect below, then return here to import."); toast.info("Reconnect your Google account to continue."); }
      else toast.error(message);
    }
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
        <p className="pi-muted pi-lede">Google does not allow apps to silently display your entire existing library. Open Google Photos, select photos/videos, and press Done. Stashr then copies only those selected items into your connected Drive and adds them to this library. Reconnect alone does not import media.</p>
      </header>

      <div className="pi-layout">
        <aside className="pi-side">
          <form className="card pi-new" onSubmit={start}>
            <div className="pi-new__title"><span className="pi-icon" aria-hidden="true">↗</span><div><h2>New import</h2><p className="pi-muted">Choose a destination folder, then pick photos.</p></div></div>
            <label>Folder name (optional)<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Leave empty, name it after the import" maxLength={60} /></label>
            <label>Google account
              <select value={source} onChange={(e) => setSource(e.target.value)} required disabled={!accounts.length}>
                {accounts.length === 0 ? <option value="">No connected account</option> : accounts.map((a) => <option key={a.id} value={a.id}>{a.label} ({a.email})</option>)}
              </select>
            </label>
            <fieldset className="pi-dest">
              <legend>Import into these accounts</legend>
              {accounts.length === 0 ? <p className="pi-muted">Connect a Google account first.</p> : accounts.map((a) => (
                <label key={a.id} className="pi-dest__row">
                  <input type="checkbox" checked={destIds.includes(a.id)} onChange={(e) => setDestIds((d) => (e.target.checked ? [...d, a.id] : d.filter((x) => x !== a.id)))} />
                  <span>{a.label} <small className="pi-muted">{freeOf(a) == null ? "space unknown" : `${freeOf(a).toFixed(1)} GB free`}</small></span>
                </label>
              ))}
              <p className="pi-muted">When one account is full, the next checked account is used automatically.</p>
            </fieldset>
            {accountWarning ? <div className="pi-connect-notice" role="status"><strong>Google account needs attention</strong><p>{accountWarning}</p><button type="button" className="btn btn--primary btn--full" onClick={() => void reconnect()} disabled={reconnecting}>{reconnecting ? "Opening Google…" : "Reconnect Google account"}</button></div> : null}
            <label>Speed
              <select value={parallel} onChange={(e) => setParallel(Number(e.target.value))}>
                <option value={1}>One file at a time (gentlest)</option>
                <option value={2}>Two at a time</option>
                <option value={3}>Three at a time</option>
              </select>
            </label>
            <button className="btn btn--primary btn--full" disabled={creating || !source || !destIds.length}>{creating ? "Opening…" : "Choose photos in Google Photos"} <span aria-hidden="true">→</span></button>
            <p className="pi-muted">Google opens its own secure photo picker. Your Google password is never shared with Stashr.</p>
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
