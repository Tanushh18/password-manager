import React, { useState } from "react";
import { toast } from "react-toastify";
import { getServiceBranches, setServiceBranch } from "../../api/client";
import { AccountPicker } from "../../Components/Project/DeployParts";
import MoveServerWizard from "../../Components/Project/MoveServerWizard";
import { useVault } from "../../state/vault";
import { errorMessage } from "./renderUtils";

/* Branch and account of one Render service, from its overview. The account can only be changed for a service
   that belongs to a Stashr project, because the account is part of that project's link. */
export default function ServiceBranch({ service }) {
  const { projects } = useVault();
  const [info, setInfo] = useState(null);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [moveAccountId, setMoveAccountId] = useState(null); // null = wizard closed
  const linked = (projects || []).find((p) => p.renderServiceId === service.id || (p.renderServices || []).some((s) => s.serviceId === service.id));
  const moveTarget = { ref: "render:" + service.id, provider: "render", accountId: service.accountId, accountName: service.accountName, name: service.name };

  const open = async () => {
    setBusy(true);
    try { const r = await getServiceBranches(service.accountId, service.id); setInfo(r); setChoice(r.current || service.branch || ""); }
    catch (e) { toast.error(errorMessage(e, "Could not read the branches.")); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!window.confirm(`Switch ${service.name} to "${choice}" and deploy it?`)) return;
    setBusy(true);
    try {
      const r = await setServiceBranch(service.accountId, service.id, choice, true);
      toast.success(r.deployed ? "Deploying " + r.branch + "." : r.note || "Branch set to " + r.branch + ".");
      setInfo(null);
    } catch (e) { toast.error(errorMessage(e, "Could not change the branch.")); }
    finally { setBusy(false); }
  };

  return (
    <section className="rd-listbox rd-branch" aria-label="Branch and account">
      <div>
        <strong>Branch</strong>
        <p>{service.branch || "—"}{service.autoDeploy === "yes" ? " · deploys on every push" : service.autoDeploy === "no" ? " · manual deploys" : ""}</p>
      </div>
      {!info ? (
        <button type="button" className="rd-btn rd-btn--quiet" onClick={() => void open()} disabled={busy}>{busy ? "Reading…" : "Change branch"}</button>
      ) : (
        <div className="rd-branch__pick">
          <select className="rd-field" value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Branch to deploy" disabled={busy}>
            {(info.branches || []).map((b) => <option key={b.name} value={b.name}>{b.name}{b.name === info.default ? " (default)" : ""}</option>)}
          </select>
          <button type="button" className="rd-btn rd-btn--primary" onClick={() => void apply()} disabled={busy || !choice}>Switch and deploy</button>
          <button type="button" className="rd-btn rd-btn--quiet" onClick={() => setInfo(null)} disabled={busy}>Cancel</button>
        </div>
      )}
      {linked ? (
        <div>
          <strong>Account</strong>
          <AccountPicker projectId={linked.id} target={moveTarget} onDone={() => {}} onMove={(accountId) => setMoveAccountId(accountId)} />
          <button type="button" className="rd-btn rd-btn--quiet" onClick={() => setMoveAccountId("")}>Move to another account</button>
        </div>
      ) : <p className="rd-note">Link this server to a Stashr project to move it to another account.</p>}
      {linked && moveAccountId !== null ? (
        <MoveServerWizard projectId={linked.id} target={moveTarget} initialTargetAccountId={moveAccountId} open onClose={() => setMoveAccountId(null)} onDone={() => toast.info("Moved. Reopen the server list to see it under the new account.")} />
      ) : null}
    </section>
  );
}
