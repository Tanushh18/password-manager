import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { Refresh, Check } from "../Icons/Icons";
import { useVault } from "../../state/vault";
import { getRenderAccounts, getRenderServices, syncProjectRenderEnv, pushProjectRenderEnv, triggerRenderDeploy } from "../../api/client";
import { useDialogs } from "../../Components/UI/Dialogs";

const ago = (value) => {
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return "never";
  const m = Math.max(0, Math.floor((Date.now() - t) / 60000));
  return m < 1 ? "just now" : m < 60 ? m + "m ago" : m < 1440 ? Math.floor(m / 60) + "h ago" : Math.floor(m / 1440) + "d ago";
};
const list = (names) => names.slice(0, 8).join(", ") + (names.length > 8 ? " +" + (names.length - 8) + " more" : "");
const errorOf = (e, fallback) => e?.response?.data?.error || fallback;

/**
 * Links a project to a Render service and pulls that service's environment variables into the
 * project's saved (encrypted) variables. One-way: Render is only ever read, never written.
 */
export default function RenderEnvSync({ project }) {
  const { confirm } = useDialogs();
  const { updateProject, refreshProfile } = useVault();
  const linked = Boolean(project.renderAccountId && project.renderServiceId);
  const [accounts, setAccounts] = useState(null);
  const [services, setServices] = useState([]);
  const [accountId, setAccountId] = useState(project.renderAccountId || "");
  const [serviceId, setServiceId] = useState("");
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState(null);
  const [pushed, setPushed] = useState(null); // result of the last push to Render
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    getRenderAccounts().then((r) => { if (live) setAccounts(r.accounts || []); }).catch(() => { if (live) setAccounts([]); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (linked || !accountId) { setServices([]); return undefined; }
    let live = true;
    setBusy("services");
    getRenderServices(accountId)
      .then((r) => { if (live) setServices((r.services || []).map((x) => x?.service || x).filter((s) => s?.id && !String(s.id).startsWith("dpg-"))); })
      .catch((e) => { if (live) { setServices([]); setError(errorOf(e, "Could not load that account's services.")); } })
      .finally(() => { if (live) setBusy(""); });
    return () => { live = false; };
  }, [accountId, linked]);

  const accountName = useMemo(() => (accounts || []).find((a) => a.id === project.renderAccountId)?.name, [accounts, project.renderAccountId]);

  const link = async () => {
    const service = services.find((s) => s.id === serviceId);
    if (!service) return;
    setBusy("link"); setError("");
    try { await updateProject(project.id, { renderAccountId: accountId, renderServiceId: service.id, renderServiceName: service.name || service.id, renderAutoLinked: "" }); toast.success("Linked to " + (service.name || service.id) + "."); }
    catch (e) { setError(errorOf(e, "Could not save the link.")); }
    finally { setBusy(""); }
  };

  const unlink = async () => {
    if (!(await confirm({ title: "Unlink this project from Render?", message: "Variables already saved here are kept, and it will not be linked automatically again.", confirmLabel: "Unlink" }))) return;
    setBusy("unlink");
    try { await updateProject(project.id, { renderAccountId: "", renderServiceId: "", renderServiceName: "", renderAutoSync: "", renderAutoLinked: "off" }); setPreview(null); setServiceId(""); toast.success("Unlinked."); }
    catch (e) { setError(errorOf(e, "Could not unlink.")); }
    finally { setBusy(""); }
  };

  const run = async (options) => syncProjectRenderEnv(project.id, options);

  const check = async () => {
    setBusy("preview"); setError("");
    try { setPreview(await run({ apply: false })); }
    catch (e) { setError(errorOf(e, "Could not read Render's variables.")); }
    finally { setBusy(""); }
  };

  const syncNow = async () => {
    setBusy("sync"); setError("");
    try {
      const plan = await run({ apply: false });
      setPreview(plan);
      if (!plan.changed && project.renderSyncedAt) { toast.info("Already up to date with Render."); return; }
      const lines = [];
      if (plan.added.length) lines.push("Add " + plan.added.length + ": " + list(plan.added));
      if (plan.updated.length) lines.push("Update " + plan.updated.length + ": " + list(plan.updated));
      if (plan.conflicts.length) lines.push("Replace " + plan.conflicts.length + " value" + (plan.conflicts.length === 1 ? "" : "s") + " you entered by hand with Render's: " + list(plan.conflicts));
      if (plan.removed.length) lines.push(plan.removed.length + " no longer in Render (kept, flagged): " + list(plan.removed));
      if (!(await confirm({ title: "Sync environment variables from Render?", details: lines.length ? lines : ["No variable changes."], message: "Render is only read, never changed.", confirmLabel: "Sync from Render" }))) return;
      const result = await run({ apply: true, resolveConflicts: true });
      setPreview(result);
      await refreshProfile();
      toast.success("Synced from Render: " + result.added.length + " added, " + result.updated.length + " updated.");
    } catch (e) { setError(errorOf(e, "Sync failed.")); }
    finally { setBusy(""); }
  };

  /* Stashr -> Render: write the variables you changed here to the service. Only names you approve; nothing is deleted. */
  const pushToRender = async () => {
    setBusy("push"); setError(""); setPushed(null);
    try {
      const plan = await pushProjectRenderEnv(project.id, { apply: false });
      const sendable = [...plan.create, ...plan.update];
      if (!sendable.length && !plan.conflicts.length) { toast.info("Render already has all of this project's variables."); return; }
      const lines = [];
      if (plan.create.length) lines.push("Add to Render " + plan.create.length + ": " + list(plan.create));
      if (plan.update.length) lines.push("Update on Render " + plan.update.length + ": " + list(plan.update));
      if (plan.conflicts.length) lines.push(plan.conflicts.length + " changed in Render since your last sync (skipped unless you choose to overwrite): " + list(plan.conflicts));
      if (plan.onlyInRender.length) lines.push(plan.onlyInRender.length + " exist only in Render (left untouched, never deleted)");
      let overwrite = [];
      if (sendable.length) {
        const targets = (project.renderServiceName || "the Render service") + ((plan.alsoTo || []).length ? " and " + plan.alsoTo.length + " more deployment" + (plan.alsoTo.length === 1 ? "" : "s") + " of this repo (" + plan.alsoTo.join(", ") + ")" : "");
        if (!(await confirm({ title: "Push environment variables to " + targets + "?", details: lines, message: "This changes the live service's variables.", confirmLabel: "Push to Render", tone: "danger" }))) return;
      }
      if (plan.conflicts.length && await confirm({ title: "Overwrite " + plan.conflicts.length + " variable" + (plan.conflicts.length === 1 ? "" : "s") + " changed in Render?", details: plan.conflicts, message: "These were changed in Render since your last sync. Overwriting replaces Render's value with Stashr's.", confirmLabel: "Overwrite with Stashr's", cancelLabel: "Keep Render's", tone: "danger" })) overwrite = plan.conflicts;
      const names = [...sendable, ...overwrite];
      if (!names.length) return;
      const many = (plan.alsoTo || []).length;
      const deploy = await confirm({ title: "Deploy now so the new values go live" + (many ? " on all " + (many + 1) + " services" : "") + "?", message: "Variables are saved either way. Without a deploy they take effect on the next one.", confirmLabel: "Save and deploy", cancelLabel: "Only save" });
      const result = await pushProjectRenderEnv(project.id, { apply: true, names, overwrite, deploy });
      setPushed(result);
      await refreshProfile();
      if (result.failed.length) toast.error(result.failed.length + " variable" + (result.failed.length === 1 ? "" : "s") + " could not be pushed.");
      else toast.success("Pushed " + result.pushed.length + " variable" + (result.pushed.length === 1 ? "" : "s") + " to Render.");
    } catch (e) { setError(errorOf(e, "Could not push to Render.")); }
    finally { setBusy(""); }
  };

  const deployNow = async () => {
    if (!(await confirm({ title: "Deploy " + (project.renderServiceName || "the service") + " now?", message: "The new variables take effect after the deploy.", confirmLabel: "Deploy" }))) return;
    setBusy("deploy");
    try { await triggerRenderDeploy(project.renderAccountId, project.renderServiceId, false); toast.success("Deployment started."); setPushed(null); }
    catch (e) { setError(errorOf(e, "Could not start the deployment.")); }
    finally { setBusy(""); }
  };

  const toggleAuto = async (on) => {
    try { await updateProject(project.id, { renderAutoSync: on ? "on" : "" }); toast.success(on ? "Auto-sync on." : "Auto-sync off."); }
    catch (e) { setError(errorOf(e, "Could not change auto-sync.")); }
  };

  return (
    <section className="card gh-panel" aria-label="Render environment sync">
      <header className="gh-panel__head">
        <div>
          <h2 className="gh-panel__title">Render environment sync</h2>
          <p className="field__note">Pulls this project’s variables from its Render service and saves them here, encrypted. One-way: Render is only read, never changed.</p>
        </div>
      </header>

      {accounts && !accounts.length ? (
        <p className="field__note">No Render account connected yet. <Link to="/render">Connect one on the Render page</Link> to link this project.</p>
      ) : !linked ? (
        <div className="gh-form">
          <div className="gh-panel__row">
            <select className="input" aria-label="Render account" value={accountId} onChange={(e) => { setAccountId(e.target.value); setServiceId(""); setError(""); }}>
              <option value="">Choose a Render account…</option>
              {(accounts || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <select className="input" aria-label="Render service" value={serviceId} onChange={(e) => setServiceId(e.target.value)} disabled={!accountId || busy === "services"}>
              <option value="">{busy === "services" ? "Loading services…" : "Choose a service…"}</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button type="button" className="btn btn--primary btn--sm" disabled={!serviceId || busy === "link"} onClick={() => void link()}>Link service</button>
          </div>
        </div>
      ) : (
        <>
          <div className="vault-card__badges">
            <span className="badge badge--ok">{project.renderAutoLinked === "yes" ? "Linked automatically" : "Linked"}</span>
            <span className="badge badge--muted">{project.renderServiceName || project.renderServiceId}</span>
            {accountName ? <span className="badge badge--muted">{accountName}</span> : null}
            <span className="badge badge--muted">Synced {project.renderSyncedAt ? ago(project.renderSyncedAt) : "never"}</span>
          </div>
          <div className="gh-panel__row">
            <button type="button" className="btn btn--primary btn--sm" disabled={Boolean(busy)} onClick={() => void syncNow()}>
              {busy === "sync" ? <span className="spinner" /> : <Refresh size={13} />} {busy === "sync" ? "Syncing…" : "Sync now"}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" disabled={Boolean(busy)} onClick={() => void check()}>{busy === "preview" ? "Checking…" : "Preview changes"}</button>
            <button type="button" className="btn btn--ghost btn--sm" disabled={Boolean(busy)} onClick={() => void pushToRender()} title="Write the variables you changed in Stashr to the Render service">{busy === "push" ? "Pushing…" : "Push to Render"}</button>
            <label className="gh-auto"><input type="checkbox" checked={project.renderAutoSync === "on"} onChange={(e) => void toggleAuto(e.target.checked)} /> Keep updated automatically</label>
            <button type="button" className="btn btn--ghost btn--sm" disabled={Boolean(busy)} onClick={() => void unlink()}>Unlink</button>
          </div>
          <p className="field__note">Automatic updates run in the background about every 15 minutes (needs the monitoring scheduler) and never overwrite a value you typed by hand.</p>
        </>
      )}

      {error ? <div className="notice notice--err" role="alert">{error}</div> : null}

      {pushed ? (
        <div className="gh-sync" aria-live="polite">
          <strong><Check size={13} /> Pushed to Render</strong>
          <ul>
            <li>{pushed.pushed.length} variable{pushed.pushed.length === 1 ? "" : "s"} written{pushed.pushed.length ? ": " + list(pushed.pushed) : ""}</li>
            {pushed.failed.length ? <li className="gh-sync__warn">{pushed.failed.length} failed: {pushed.failed.map((f) => f.name + " (" + f.error + ")").join(", ")}</li> : null}
            {(pushed.otherServices || []).map((o) => <li key={o.serviceId} className={o.error ? "gh-sync__warn" : ""}>{o.name || o.serviceId}: {o.pushed} written{o.deployed ? ", deploying" : ""}{o.error ? " (" + o.error + ")" : ""}</li>)}
            {pushed.deployed ? <li>Deployment started on {project.renderServiceName || "the main service"}.</li> : null}
            {pushed.skippedConflicts.length ? <li className="gh-sync__warn">{pushed.skippedConflicts.length} skipped because Render has newer values: {list(pushed.skippedConflicts)}</li> : null}
          </ul>
          {pushed.pushed.length && !pushed.deployed ? <div className="gh-panel__row"><button type="button" className="btn btn--primary btn--sm" disabled={Boolean(busy)} onClick={() => void deployNow()}>{busy === "deploy" ? "Deploying…" : "Deploy now to apply"}</button><span className="field__note">Variable changes may need a deploy to take effect.</span></div> : null}
        </div>
      ) : null}

      {preview ? (
        <div className="gh-sync" aria-live="polite">
          <strong>{preview.applied ? <><Check size={13} /> Synced</> : "Preview"}</strong>
          <ul>
            <li>{preview.added.length} new{preview.added.length ? ": " + list(preview.added) : ""}</li>
            <li>{preview.updated.length} changed{preview.updated.length ? ": " + list(preview.updated) : ""}</li>
            <li>{preview.unchanged} unchanged</li>
            {preview.conflicts.length ? <li className="gh-sync__warn">{preview.applied && preview.updated.length >= preview.conflicts.length
              ? preview.conflicts.length + " value" + (preview.conflicts.length === 1 ? "" : "s") + " you entered by hand " + (preview.conflicts.length === 1 ? "was" : "were") + " replaced with Render's: "
              : preview.conflicts.length + " differ from values you entered by hand" + (preview.applied ? " (kept)" : " (replaced only when you confirm Sync now)") + ": "}{list(preview.conflicts)}</li> : null}
            {preview.removed.length ? <li className="gh-sync__warn">{preview.removed.length} no longer in Render (kept here, flagged): {list(preview.removed)}</li> : null}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
