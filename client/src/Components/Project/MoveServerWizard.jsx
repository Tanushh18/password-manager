import React, { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "react-responsive-modal";
import "react-responsive-modal/styles.css";
import { toast } from "react-toastify";
import { getRenderAccounts, moveCreate, moveDeleteOld, moveFrontends, movePlan, moveRelink, moveStatus } from "../../api/client";
import { errorMessage } from "../../Pages/Render/renderUtils";
import "./MoveServerWizard.css";

const STEPS = [
  ["plan", "Check the plan"],
  ["create", "Create the new server"],
  ["live", "Wait until it is live"],
  ["frontends", "Point the frontends at it"],
  ["verify", "Check it yourself"],
  ["relink", "Move the project link"],
  ["delete", "Delete the old server"]
];

/**
 * Moves one Render server to another connected account, step by step. Every step is a button you press; the old
 * server is only deleted at the very end, after the project points at the new one, and only when you type its name.
 */
export default function MoveServerWizard({ projectId, target, open, onClose, onDone }) {
  const serviceId = target.ref.replace(/^render:/, "");
  const [accounts, setAccounts] = useState([]);
  const [targetAccountId, setTargetAccountId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [plan, setPlan] = useState(null);
  const [step, setStep] = useState("plan");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);
  const [live, setLive] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [redeployFront, setRedeployFront] = useState(true);
  const [frontResult, setFrontResult] = useState(null);
  const [verified, setVerified] = useState(false);
  const [typed, setTyped] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [name, setName] = useState("");
  const timer = useRef(null);

  useEffect(() => {
    if (!open) return;
    getRenderAccounts().then((r) => setAccounts((r.accounts || []).filter((a) => a.id !== target.accountId))).catch(() => setAccounts([]));
  }, [open, target.accountId]);

  const run = async (fn) => {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(errorMessage(e, "That step failed.")); } finally { setBusy(false); }
  };

  const doPlan = () => run(async () => {
    const p = await movePlan(projectId, { serviceId, targetAccountId, ownerId });
    setPlan(p); setOwnerId(p.target.ownerId); setName(p.source.name);
    setPicked(new Set(p.frontends.map((f) => f.serviceId + ":" + f.key)));
  });

  const doCreate = () => run(async () => {
    const c = await moveCreate(projectId, { serviceId, targetAccountId, ownerId, name });
    setCreated(c); setStep("live");
  });

  // While the new server builds, ask Render every few seconds.
  const poll = useCallback(async () => {
    if (!created) return;
    try {
      const s = await moveStatus(projectId, { accountId: created.accountId, serviceId: created.serviceId });
      setLive(s);
      if (s.ready) setStep((cur) => (cur === "live" ? "frontends" : cur));
      else if (/fail|cancel/.test(s.deploy?.status || "")) setError("The new server's deploy failed. Check it in Render; the old server is untouched.");
    } catch (e) { setError(errorMessage(e, "Could not read the new server.")); }
  }, [created, projectId]);
  useEffect(() => {
    if (step !== "live" || !created) return undefined;
    void poll();
    timer.current = setInterval(() => void poll(), 8000);
    return () => clearInterval(timer.current);
  }, [step, created, poll]);

  const newUrl = live?.url || created?.url || "";
  const doFrontends = () => run(async () => {
    const targets = plan.frontends.filter((f) => picked.has(f.serviceId + ":" + f.key)).map((f) => ({ accountId: f.accountId, serviceId: f.serviceId, key: f.key }));
    if (targets.length) setFrontResult(await moveFrontends(projectId, { fromUrl: plan.source.url, toUrl: newUrl, targets, deploy: redeployFront }));
    setStep("verify");
  });
  const doRelink = () => run(async () => {
    await moveRelink(projectId, { oldServiceId: serviceId, newAccountId: created.accountId, newServiceId: created.serviceId, newName: live?.name || created.name, newUrl });
    setStep("delete");
    onDone?.();
  });
  const doDelete = () => run(async () => {
    await moveDeleteOld(projectId, { serviceId, accountId: target.accountId, confirmName: typed });
    toast.success("Moved. The old server is deleted.");
    setStep("done");
    onDone?.();
  });

  const order = STEPS.map((s) => s[0]);
  const state = (id) => (step === "done" || order.indexOf(id) < order.indexOf(step) ? "done" : id === step ? "active" : "todo");

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} center classNames={{ modal: "mv-modal" }}>
      <h2 className="mv__title">Move {target.name} to another account</h2>
      <p className="field__note">The new server is built first, and the old one is deleted last. You can stop at any step: nothing is deleted until the final one.</p>
      <ol className="mv__steps">
        {STEPS.map(([id, label]) => <li key={id} className={"is-" + state(id)}><span className="mv__dot">{state(id) === "done" ? "✓" : ""}</span>{label}</li>)}
      </ol>
      {error ? <div className="notice notice--err" role="alert">{error}</div> : null}

      {step === "plan" ? (
        <div className="mv__panel">
          <div className="field">
            <label className="field__label" htmlFor="mv-acc">Move to this account</label>
            <select id="mv-acc" className="input" value={targetAccountId} disabled={busy} onChange={(e) => { setTargetAccountId(e.target.value); setPlan(null); }}>
              <option value="">Choose…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          {!plan ? <button type="button" className="btn btn--primary" disabled={busy || !targetAccountId} onClick={() => void doPlan()}>{busy ? "Checking…" : "Check the plan"}</button> : (
            <>
              <dl className="mv__facts">
                <div><dt>Server</dt><dd>{plan.source.name} · {plan.source.accountName}</dd></div>
                <div><dt>Address</dt><dd>{plan.source.url || "—"}</dd></div>
                <div><dt>Branch · plan · region</dt><dd>{[plan.source.branch, plan.source.plan, plan.source.region].filter(Boolean).join(" · ") || "—"}</dd></div>
                <div><dt>Variables copied</dt><dd>{plan.source.envCount}</dd></div>
                <div><dt>Frontend variables to update</dt><dd>{plan.frontends.length}</dd></div>
              </dl>
              {plan.warnings.map((w) => <div key={w} className="notice" role="status">{w}</div>)}
              {plan.target.owners.length > 1 ? (
                <div className="field"><label className="field__label" htmlFor="mv-owner">Workspace in {plan.target.accountName}</label>
                  <select id="mv-owner" className="input" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}><option value="">Choose…</option>{plan.target.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
              ) : null}
              <div className="field"><label className="field__label" htmlFor="mv-name">Name of the new server</label>
                <input id="mv-name" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></div>
              <button type="button" className="btn btn--primary" disabled={busy || !ownerId || !name.trim()} onClick={() => { setStep("create"); }}>Continue</button>
            </>
          )}
        </div>
      ) : null}

      {step === "create" ? (
        <div className="mv__panel">
          <p>This creates <b>{name}</b> in <b>{plan?.target.accountName}</b> from the same repository and branch, with all {plan?.source.envCount} variables. The old server keeps running.</p>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void doCreate()}>{busy ? "Creating…" : "Create the new server"}</button>
        </div>
      ) : null}

      {step === "live" ? (
        <div className="mv__panel">
          <p>Building <b>{created?.name}</b>… {live?.deploy ? <span className="pdep__pill is-mid">{live.deploy.status.replace(/_/g, " ")}</span> : "starting"}</p>
          <p className="field__note">This page checks every few seconds and moves on by itself when the server is live.</p>
        </div>
      ) : null}

      {step === "frontends" ? (
        <div className="mv__panel">
          <p>New address: <a href={newUrl} target="_blank" rel="noopener noreferrer">{newUrl || "—"}</a></p>
          {plan.frontends.length ? (
            <>
              <p className="field__note">These variables still hold the old address. Untick any you want to leave.</p>
              <ul className="mv__refs">
                {plan.frontends.map((f) => {
                  const key = f.serviceId + ":" + f.key;
                  return <li key={key}><label><input type="checkbox" checked={picked.has(key)} onChange={() => setPicked((old) => { const n = new Set(old); if (n.has(key)) n.delete(key); else n.add(key); return n; })} /> <b>{f.serviceName}</b> · <code>{f.key}</code> <small>{f.accountName}</small></label></li>;
                })}
              </ul>
              <label className="field__note"><input type="checkbox" checked={redeployFront} onChange={(e) => setRedeployFront(e.target.checked)} /> Redeploy these frontends after the change</label>
            </>
          ) : <p className="field__note">No other service holds the old address, so there is nothing to change.</p>}
          <button type="button" className="btn btn--primary" disabled={busy || !newUrl} onClick={() => void doFrontends()}>{busy ? "Updating…" : plan.frontends.length ? "Update the frontends" : "Continue"}</button>
        </div>
      ) : null}

      {step === "verify" ? (
        <div className="mv__panel">
          {frontResult ? <p className="field__note">Changed {frontResult.changed} variable{frontResult.changed === 1 ? "" : "s"}.</p> : null}
          <p>Open the new address and a frontend, and use one feature that calls the server.</p>
          <p><a href={newUrl} target="_blank" rel="noopener noreferrer">{newUrl}</a></p>
          <label className="field__note"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} /> I checked it and the new server answers</label>
          <button type="button" className="btn btn--primary" disabled={!verified} onClick={() => setStep("relink")}>Continue</button>
        </div>
      ) : null}

      {step === "relink" ? (
        <div className="mv__panel">
          <p>The project will point at <b>{live?.name || created?.name}</b> instead of the old server. Nothing is deleted yet.</p>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void doRelink()}>{busy ? "Saving…" : "Move the project link"}</button>
        </div>
      ) : null}

      {step === "delete" ? (
        <div className="mv__panel mv__danger">
          <p>The last step. This permanently deletes <b>{plan?.source.name}</b> from {plan?.source.accountName}. Keep it a day first if you want a fallback. Its variables are all on the new server.</p>
          <div className="field"><label className="field__label" htmlFor="mv-type">Type <code>{plan?.source.name}</code> to confirm</label>
            <input id="mv-type" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></div>
          <label className="field__note"><input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} /> I understand this cannot be undone</label>
          <div className="gh-panel__row">
            <button type="button" className="btn btn--danger" disabled={busy || typed !== plan?.source.name || !understood} onClick={() => void doDelete()}>{busy ? "Deleting…" : "Delete the old server"}</button>
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={onClose}>Keep it for now</button>
          </div>
        </div>
      ) : null}

      {step === "done" ? (
        <div className="mv__panel">
          <p><b>Done.</b> {created?.name} is the project’s server in {plan?.target.accountName}.</p>
          <button type="button" className="btn btn--primary" onClick={onClose}>Close</button>
        </div>
      ) : null}
    </Modal>
  );
}
