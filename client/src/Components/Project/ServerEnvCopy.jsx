import React, { useEffect, useMemo, useState } from "react";
import { Modal } from "react-responsive-modal";
import "react-responsive-modal/styles.css";
import { toast } from "react-toastify";
import { getRenderAccounts, getRenderEnvVars, getRenderServices, updateRenderEnvVar } from "../../api/client";
import { useVault } from "../../state/vault";
import { errorMessage } from "../../Pages/Render/renderUtils";

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Copy environment variables INTO a deployed Render server from another server or a Stashr project. Names only are shown; nothing is written until you confirm. */
export default function ServerEnvCopy({ server, open, onClose, onDone }) {
  const { projects } = useVault();
  const [servers, setServers] = useState(null);
  const [pick, setPick] = useState("");
  const [plan, setPlan] = useState(null); // { add, differ, same, rows }
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const withVars = useMemo(() => (projects || []).filter((p) => (p.envVars || []).length), [projects]);

  useEffect(() => {
    if (!open) return;
    setPick(""); setPlan(null); setErr(""); setOverwrite(false);
    getRenderAccounts().then((r) => Promise.all((r.accounts || []).map((a) => getRenderServices(a.id).then((d) => (d.services || []).map((s) => ({ accountId: a.id, accountName: a.name, id: s.id, name: s.name || s.id }))).catch(() => []))))
      .then((lists) => setServers(lists.flat().filter((s) => !(s.accountId === server.accountId && s.id === server.id))))
      .catch(() => setServers([]));
  }, [open, server.accountId, server.id]);

  const preview = async (value) => {
    setPick(value); setPlan(null); setErr("");
    if (!value) return;
    setBusy(true);
    try {
      let source;
      if (value.startsWith("project:")) source = (withVars.find((p) => "project:" + p.id === value)?.envVars || []).map((v) => ({ name: v.name, value: v.value || "" }));
      else { const s = (servers || []).find((x) => "render:" + x.accountId + ":" + x.id === value); source = ((await getRenderEnvVars(s.accountId, s.id)).envVars || []).map((v) => ({ name: v.key, value: typeof v.value === "string" ? v.value : "" })); }
      const target = new Map(((await getRenderEnvVars(server.accountId, server.id)).envVars || []).map((v) => [v.key, v.value]));
      const rows = source.filter((r) => ENV_NAME.test(r.name) && r.value);
      const skipped = source.length - rows.length;
      setPlan({
        add: rows.filter((r) => !target.has(r.name)), differ: rows.filter((r) => target.has(r.name) && target.get(r.name) !== r.value),
        same: rows.filter((r) => target.get(r.name) === r.value).length, skipped
      });
    } catch (e) { setErr(errorMessage(e, "Could not read the variables.")); }
    finally { setBusy(false); }
  };

  const apply = async () => {
    const rows = [...plan.add, ...(overwrite ? plan.differ : [])];
    if (!rows.length) return;
    if (!window.confirm("Write " + rows.length + " variable" + (rows.length === 1 ? "" : "s") + " to " + server.name + " on Render? Render may redeploy the service.")) return;
    setBusy(true); setErr("");
    let ok = 0;
    try {
      for (const r of rows) { await updateRenderEnvVar(server.accountId, server.id, r.name, r.value); ok += 1; }
      toast.success("Copied " + ok + " variable" + (ok === 1 ? "" : "s") + " to " + server.name + ".");
      onDone?.(); onClose();
    } catch (e) { setErr("Stopped after " + ok + " of " + rows.length + ". " + errorMessage(e, "Render refused a variable.")); if (ok) onDone?.(); }
    finally { setBusy(false); }
  };

  const count = plan ? plan.add.length + (overwrite ? plan.differ.length : 0) : 0;
  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} center classNames={{ modal: "sheet" }}>
      <div className="sheet__body">
        <span className="card__ribbon" />
        <div className="sheet__head">
          <h2 className="sheet__title">Copy env into {server.name}</h2>
          <p className="sheet__sub">Pick another server or a Stashr project. You will see which variable names would be added or changed before anything is written.</p>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="sec-src">Copy from</label>
          <select id="sec-src" className="input" value={pick} onChange={(e) => void preview(e.target.value)} disabled={busy || servers === null}>
            <option value="">{servers === null ? "Loading…" : "Choose…"}</option>
            {(servers || []).length ? <optgroup label="Render servers">{servers.map((s) => <option key={s.accountId + s.id} value={"render:" + s.accountId + ":" + s.id}>{s.name} · {s.accountName}</option>)}</optgroup> : null}
            {withVars.length ? <optgroup label="Stashr projects">{withVars.map((p) => <option key={p.id} value={"project:" + p.id}>{p.name} ({p.envVars.length})</option>)}</optgroup> : null}
          </select>
        </div>
        {busy && !plan ? <p className="field__note">Reading…</p> : null}
        {plan ? (
          <div>
            <p className="field__note"><strong>{plan.add.length}</strong> new · <strong>{plan.differ.length}</strong> different · {plan.same} already the same{plan.skipped ? " · " + plan.skipped + " skipped (empty or invalid)" : ""}</p>
            {plan.add.length ? <p className="field__note"><strong>Will add:</strong> {plan.add.map((r) => r.name).join(", ")}</p> : null}
            {plan.differ.length ? (
              <label className="field__note" style={{ display: "block" }}>
                <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} disabled={busy} /> Also overwrite {plan.differ.length} that differ: {plan.differ.map((r) => r.name).join(", ")}
              </label>
            ) : null}
          </div>
        ) : null}
        {err ? <div className="notice notice--err" role="alert">{err}</div> : null}
        <div className="gh-panel__row">
          <button type="button" className="btn btn--primary" disabled={busy || !count} onClick={() => void apply()}>{busy && plan ? "Copying…" : count ? "Copy " + count + " variable" + (count === 1 ? "" : "s") : "Nothing to copy"}</button>
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
