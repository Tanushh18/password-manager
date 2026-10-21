import React, { useEffect, useState } from "react";
import { Modal } from "react-responsive-modal";
import "react-responsive-modal/styles.css";
import { toast } from "react-toastify";
import { syncProjectServers } from "../../api/client";
import { errorMessage } from "../../Pages/Render/renderUtils";

const list = (names) => (names?.length ? names.slice(0, 6).join(", ") + (names.length > 6 ? " +" + (names.length - 6) : "") : "—");

/**
 * Copies one server's variables onto the other servers that run the same branch, in one go.
 * Shows names and counts only; nothing is written until "Sync now" is pressed. Redeploys the changed servers
 * on their latest commit when that is ticked (the default).
 */
export default function EnvGroupSync({ projectId, servers, initialSource, open, onClose, onDone }) {
  const [source, setSource] = useState(initialSource);
  const [preview, setPreview] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [overwrite, setOverwrite] = useState(false);
  const [deploy, setDeploy] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const loadPreview = async (sourceId) => {
    setBusy(true); setError(""); setResult(null);
    try {
      const r = await syncProjectServers(projectId, { apply: false, sourceServiceId: sourceId, allServers: true });
      setPreview(r);
      // Same branch as the source is picked by default; servers on other branches can be ticked too.
      setPicked(new Set(r.targets.filter((t) => !t.error && t.branch === r.source.branch).map((t) => t.serviceId)));
    } catch (e) { setPreview(null); setError(errorMessage(e, "Could not compare the servers.")); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (open) { setSource(initialSource); void loadPreview(initialSource); } }, [open, initialSource]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id) => setPicked((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const targets = (preview?.targets || []).filter((t) => picked.has(t.serviceId));
  const willWrite = targets.reduce((n, t) => n + t.create.length + (overwrite ? t.update.length : 0), 0);

  const apply = async () => {
    if (!targets.length) return;
    setBusy(true); setError("");
    try {
      const r = await syncProjectServers(projectId, { apply: true, overwrite, deploy, sourceServiceId: source, targetServiceIds: [...picked] });
      setResult(r);
      const written = r.results.reduce((n, x) => n + x.written, 0);
      toast.success(written ? "Wrote " + written + " variable" + (written === 1 ? "" : "s") + "." : "Nothing needed changing.");
      onDone?.();
    } catch (e) { setError(errorMessage(e, "Could not sync the variables.")); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} center classNames={{ modal: "sync-modal" }}>
      <h2 className="sync-modal__title">Sync environment variables</h2>
      <p className="field__note">Copies variables from one server onto others. Servers on the source’s branch are ticked by default; tick any other branch’s server to sync it too. Only names and counts are shown, never values.</p>

      <div className="field">
        <label className="field__label" htmlFor="sync-source">Copy from</label>
        <select id="sync-source" className="input" value={source} disabled={busy} onChange={(e) => { setSource(e.target.value); void loadPreview(e.target.value); }}>
          {servers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.branch ? " · " + s.branch : ""}{s.isMain ? " (main)" : ""}</option>)}
        </select>
      </div>

      {busy && !preview ? <p className="field__note">Reading every server from Render…</p> : null}
      {error ? <div className="notice notice--err" role="alert">{error}</div> : null}

      {preview ? (
        <>
          <div className="sync-modal__targets" role="group" aria-label="Servers to sync">
            {preview.targets.length === 0 ? <p className="field__note">This project has no other server.</p> : null}
            {preview.targets.map((t) => (
              <label key={t.serviceId} className={"sync-modal__row" + (t.error ? " is-error" : "")}>
                <input type="checkbox" checked={picked.has(t.serviceId)} disabled={Boolean(t.error) || busy} onChange={() => toggle(t.serviceId)} />
                <span className="sync-modal__name"><strong>{t.name}</strong><small>branch {t.branch || "—"}{t.branch === preview.source.branch ? " · same branch" : ""}{t.suspended ? " · suspended" : ""}</small></span>
                {t.error ? <span className="sync-modal__err">{t.error}</span> : (
                  <span className="sync-modal__counts">
                    <b className="is-add">+{t.create.length}</b> new <b className="is-change">~{t.update.length}</b> different <b>{t.same}</b> same
                    <small>new: {list(t.create)}{t.update.length ? " · different: " + list(t.update) : ""}{t.extra.length ? " · only here: " + list(t.extra) : ""}</small>
                  </span>
                )}
              </label>
            ))}
          </div>

          <div className="sync-modal__opts">
            <label><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} disabled={busy} /> Also replace values that differ from the source</label>
            <label><input type="checkbox" checked={deploy} onChange={(e) => setDeploy(e.target.checked)} disabled={busy} /> Redeploy the latest commit on each changed server</label>
            <p className="field__note">Variables that exist only on a target are never deleted.</p>
          </div>

          {result ? (
            <ul className="sync-modal__result">
              {result.results.map((r) => (
                <li key={r.serviceId} className={r.error || r.failed.length ? "is-bad" : ""}>
                  <strong>{r.name}</strong>: wrote {r.written}{r.deployed ? ", redeploying" : ""}{r.failed.length ? ", failed: " + r.failed.join(", ") : ""}{r.error ? " · " + r.error : ""}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="gh-panel__row">
            <button type="button" className="btn btn--primary" disabled={busy || !targets.length || (willWrite === 0 && !deploy)} onClick={() => void apply()}>
              {busy ? "Working…" : willWrite || deploy ? "Sync now" : "Nothing to sync"}
            </button>
            <button type="button" className="btn btn--ghost" onClick={onClose}>{result ? "Done" : "Cancel"}</button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
