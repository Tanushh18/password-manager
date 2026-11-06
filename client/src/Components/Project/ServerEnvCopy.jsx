import React, { useEffect, useMemo, useState } from "react";
import { Modal } from "react-responsive-modal";
import "react-responsive-modal/styles.css";
import { toast } from "react-toastify";
import { syncDeployEnv, getAllDeployServers } from "../../api/client";
import { parseEnvBlock } from "../../lib/projectItems";
import { useVault } from "../../state/vault";
import { errorMessage } from "../../Pages/Render/renderUtils";
import { useDialogs } from "../../Components/UI/Dialogs";

const list = (names) => (names?.length ? names.slice(0, 8).join(", ") + (names.length > 8 ? " +" + (names.length - 8) : "") : "—");

/**
 * Copy variables INTO one server (any hosting provider) from another server of this project or from a Stashr project.
 * Shows names and counts before anything is written. Values never appear here. A variable the host will not reveal
 * (a secret) is listed as unreadable and is never overwritten.
 */
export default function ServerEnvCopy({ projectId, target, targets, open, onClose, onDone }) {
  const { confirm } = useDialogs();
  const { projects } = useVault();
  const [pick, setPick] = useState("");
  const [preview, setPreview] = useState(null);
  const [chosen, setChosen] = useState(() => new Set());
  const [deploy, setDeploy] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);
  const [allServers, setAllServers] = useState([]);
  const [envText, setEnvText] = useState("");
  const others = useMemo(() => (targets || []).filter((t) => t.ref !== target.ref), [targets, target.ref]);
  const withVars = useMemo(() => (projects || []).filter((p) => (p.envVars || []).length), [projects]);

  useEffect(() => { if (open) { setPick(""); setPreview(null); setErr(""); setChosen(new Set()); setResult(null); setEnvText(""); getAllDeployServers().then((d) => setAllServers(d.servers || [])).catch(() => setAllServers([])); } }, [open]);

  // Servers of OTHER projects, on any hosting provider.
  const elsewhere = useMemo(() => allServers.filter((s) => String(s.projectId) !== String(projectId)), [allServers, projectId]);
  const body = (value) => value === "paste"
    ? { sourceVars: parseEnvBlock(envText).map((v) => ({ name: v.name, value: v.value || "" })) }
    : value.startsWith("other:")
    ? (() => { const [, pid, ...ref] = value.split(":"); return { sourceProjectId: pid, sourceRef: ref.join(":") }; })()
    : (value.startsWith("project:")
    ? { sourceVars: (withVars.find((p) => "project:" + p.id === value)?.envVars || []).map((v) => ({ name: v.name, value: v.value || "" })) }
    : { sourceRef: value.replace(/^server:/, "") });

  const choose = async (value, compare = false) => {
    setPick(value); setPreview(null); setErr(""); setResult(null);
    if (!value || (value === "paste" && !compare)) return;
    setBusy(true);
    try {
      const r = await syncDeployEnv(projectId, { apply: false, targetRefs: [target.ref], ...body(value) });
      setPreview(r.targets[0] || null);
      // New variables start ticked; ones that already exist with a different value start unticked (ticking one overwrites it).
      setChosen(new Set(r.targets[0]?.create || []));
      if (r.targets[0]?.error) setErr(r.targets[0].error);
    } catch (e) { setErr(errorMessage(e, "Could not compare the variables.")); }
    finally { setBusy(false); }
  };

  const overwrite = preview ? preview.update.some((n) => chosen.has(n)) : false;
  const count = preview ? [...preview.create, ...preview.update].filter((n) => chosen.has(n)).length : 0;
  const toggle = (name) => setChosen((set) => { const next = new Set(set); if (next.has(name)) next.delete(name); else next.add(name); return next; });
  const setAll = (names, on) => setChosen((set) => { const next = new Set(set); names.forEach((n) => (on ? next.add(n) : next.delete(n))); return next; });
  const apply = async () => {
    if (!count) return;
    if (!(await confirm({ title: `Write ${count} variable${count === 1 ? "" : "s"} to ${target.name}?`, message: `On ${target.label}.${deploy ? " It will then redeploy the latest commit." : " Nothing is redeployed."}`, confirmLabel: deploy ? "Write and deploy" : "Write variables" }))) return;
    setBusy(true); setErr("");
    try {
      const r = await syncDeployEnv(projectId, { apply: true, overwrite, deploy, names: [...chosen], targetRefs: [target.ref], ...body(pick) });
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
            {elsewhere.length ? <optgroup label="All servers (other projects, any host)">{elsewhere.map((s) => <option key={s.projectId + s.ref} value={"other:" + s.projectId + ":" + s.ref}>{s.projectName} › {s.name} · {s.label}</option>)}</optgroup> : null}
            <optgroup label="From env text"><option value="paste">Paste a .env…</option></optgroup>
            {withVars.length ? <optgroup label="Stashr projects">{withVars.map((p) => <option key={p.id} value={"project:" + p.id}>{p.name} ({p.envVars.length})</option>)}</optgroup> : null}
          </select>
        </div>
        {pick === "paste" ? (
          <div className="field">
            <label className="field__label" htmlFor="sec-env">Paste NAME=value lines</label>
            <textarea id="sec-env" className="input" rows={6} spellCheck="false" value={envText} onChange={(e) => setEnvText(e.target.value)} placeholder="CLOUDINARY_CLOUD_NAME_shine=..." />
            <div className="gh-panel__row"><button type="button" className="btn btn--ghost btn--sm" disabled={busy || !envText.trim()} onClick={() => void choose("paste", true)}>Compare</button></div>
          </div>
        ) : null}
        {busy && !preview ? <p className="field__note">Reading…</p> : null}
        {preview && !preview.error ? (
          <div>
            <p className="field__note"><strong>{preview.create.length}</strong> new · <strong>{preview.update.length}</strong> different · {preview.same} already the same{preview.unreadable.length ? " · " + preview.unreadable.length + " hidden by " + target.label : ""}{preview.skipped ? " · " + preview.skipped + " skipped" : ""}</p>
            {preview.create.length ? (
              <fieldset className="field" disabled={busy}>
                <legend className="field__label">New on {target.name} — choose which to add</legend>
                <div className="gh-panel__row">
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setAll(preview.create, true)}>Select all</button>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setAll(preview.create, false)}>None</button>
                </div>
                {preview.create.map((n) => <label key={n} className="field__note" style={{ display: "block" }}><input type="checkbox" checked={chosen.has(n)} onChange={() => toggle(n)} /> {n}</label>)}
              </fieldset>
            ) : null}
            {preview.update.length ? (
              <fieldset className="field" disabled={busy}>
                <legend className="field__label">Already there with a different value — tick to overwrite</legend>
                <div className="gh-panel__row">
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setAll(preview.update, true)}>Select all</button>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setAll(preview.update, false)}>None</button>
                </div>
                {preview.update.map((n) => <label key={n} className="field__note" style={{ display: "block" }}><input type="checkbox" checked={chosen.has(n)} onChange={() => toggle(n)} /> {n}</label>)}
              </fieldset>
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
