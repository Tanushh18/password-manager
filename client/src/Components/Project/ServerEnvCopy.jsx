import React, { useEffect, useMemo, useState } from "react";
import { Modal } from "react-responsive-modal";
import "react-responsive-modal/styles.css";
import { toast } from "react-toastify";
import { syncDeployEnv } from "../../api/client";
import { useVault } from "../../state/vault";
import { errorMessage } from "../../Pages/Render/renderUtils";

const list = (names) => (names?.length ? names.slice(0, 8).join(", ") + (names.length > 8 ? " +" + (names.length - 8) : "") : "—");

/**
 * Copy variables INTO one server (any hosting provider) from another server of this project or from a Stashr project.
 * Shows names and counts before anything is written. Values never appear here. A variable the host will not reveal
 * (a secret) is listed as unreadable and is never overwritten.
 */
export default function ServerEnvCopy({ projectId, target, targets, open, onClose, onDone }) {
  const { projects } = useVault();
  const [pick, setPick] = useState("");
  const [preview, setPreview] = useState(null);
  const [overwrite, setOverwrite] = useState(false);
  const [deploy, setDeploy] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);
  const others = useMemo(() => (targets || []).filter((t) => t.ref !== target.ref), [targets, target.ref]);
  const withVars = useMemo(() => (projects || []).filter((p) => (p.envVars || []).length), [projects]);

  useEffect(() => { if (open) { setPick(""); setPreview(null); setErr(""); setOverwrite(false); setResult(null); } }, [open]);

  const body = (value) => (value.startsWith("project:")
    ? { sourceVars: (withVars.find((p) => "project:" + p.id === value)?.envVars || []).map((v) => ({ name: v.name, value: v.value || "" })) }
    : { sourceRef: value.replace(/^server:/, "") });

  const choose = async (value) => {
    setPick(value); setPreview(null); setErr(""); setResult(null);
    if (!value) return;
    setBusy(true);
    try {
      const r = await syncDeployEnv(projectId, { apply: false, targetRefs: [target.ref], ...body(value) });
      setPreview(r.targets[0] || null);
      if (r.targets[0]?.error) setErr(r.targets[0].error);
    } catch (e) { setErr(errorMessage(e, "Could not compare the variables.")); }
    finally { setBusy(false); }
  };

  const count = preview ? preview.create.length + (overwrite ? preview.update.length : 0) : 0;
  const apply = async () => {
    if (!count) return;
    if (!window.confirm(`Write ${count} variable${count === 1 ? "" : "s"} to ${target.name} on ${target.label}?${deploy ? " It will then redeploy the latest commit." : ""}`)) return;
    setBusy(true); setErr("");
    try {
      const r = await syncDeployEnv(projectId, { apply: true, overwrite, deploy, targetRefs: [target.ref], ...body(pick) });
      const res = r.results[0];
      setResult(res);
      if (res.written) toast.success(`Wrote ${res.written} variable${res.written === 1 ? "" : "s"} to ${target.name}${res.deployed ? " and started a deploy" : ""}.`);
      if (res.error) setErr(res.error);
      onDone?.();
    } catch (e) { setErr(errorMessage(e, "Could not copy the variables.")); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} center classNames={{ modal: "sheet" }}>
      <div className="sheet__body">
        <div className="sheet__head">
          <h2 className="sheet__title">Copy env into {target.name}</h2>
          <p className="sheet__sub">{target.label} · pick where the variables come from. You see the names before anything is written.</p>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="sec-src">Copy from</label>
          <select id="sec-src" className="input" value={pick} onChange={(e) => void choose(e.target.value)} disabled={busy}>
            <option value="">Choose…</option>
            {others.length ? <optgroup label="Servers">{others.map((t) => <option key={t.ref} value={"server:" + t.ref}>{t.name} · {t.label}</option>)}</optgroup> : null}
            {withVars.length ? <optgroup label="Stashr projects">{withVars.map((p) => <option key={p.id} value={"project:" + p.id}>{p.name} ({p.envVars.length})</option>)}</optgroup> : null}
          </select>
        </div>
        {busy && !preview ? <p className="field__note">Reading…</p> : null}
        {preview && !preview.error ? (
          <div>
            <p className="field__note"><strong>{preview.create.length}</strong> new · <strong>{preview.update.length}</strong> different · {preview.same} already the same{preview.unreadable.length ? " · " + preview.unreadable.length + " hidden by " + target.label : ""}{preview.skipped ? " · " + preview.skipped + " skipped" : ""}</p>
            {preview.create.length ? <p className="field__note"><strong>Will add:</strong> {list(preview.create)}</p> : null}
            {preview.update.length ? (
              <label className="field__note" style={{ display: "block" }}>
                <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} disabled={busy} /> Also overwrite {preview.update.length} that differ: {list(preview.update)}
              </label>
            ) : null}
            {preview.unreadable.length ? <p className="field__note">{target.label} does not show these values, so they are left as they are: {list(preview.unreadable)}</p> : null}
          </div>
        ) : null}
        {err ? <div className="notice notice--err" role="alert">{err}</div> : null}
        {result ? <p className="field__note">Written: {result.written}{result.failed.length ? " · failed: " + list(result.failed) : ""}{result.deployed ? " · deploying the latest commit" : ""}</p> : null}
        {preview && !preview.error ? (
          <label className="field__note" style={{ display: "block" }}><input type="checkbox" checked={deploy} onChange={(e) => setDeploy(e.target.checked)} disabled={busy} /> Then deploy the latest commit so the new variables are used</label>
        ) : null}
        <div className="gh-panel__row">
          <button type="button" className="btn btn--primary" disabled={busy || !count} onClick={() => void apply()}>{busy && preview ? "Copying…" : count ? "Copy " + count + " variable" + (count === 1 ? "" : "s") : "Nothing to copy"}</button>
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}
