import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { Refresh, Check } from "../Icons/Icons";
import { useVault } from "../../state/vault";
import { getRenderAccounts, getRenderServices, syncProjectRenderEnv } from "../../api/client";

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
  const { updateProject, refreshProfile } = useVault();
  const linked = Boolean(project.renderAccountId && project.renderServiceId);
  const [accounts, setAccounts] = useState(null);
  const [services, setServices] = useState([]);
  const [accountId, setAccountId] = useState(project.renderAccountId || "");
  const [serviceId, setServiceId] = useState("");
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState(null);
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
    try { await updateProject(project.id, { renderAccountId: accountId, renderServiceId: service.id, renderServiceName: service.name || service.id }); toast.success("Linked to " + (service.name || service.id) + "."); }
    catch (e) { setError(errorOf(e, "Could not save the link.")); }
    finally { setBusy(""); }
  };

  const unlink = async () => {
    if (!window.confirm("Unlink this project from Render? Variables already saved here are kept.")) return;
    setBusy("unlink");
    try { await updateProject(project.id, { renderAccountId: "", renderServiceId: "", renderServiceName: "", renderAutoSync: "" }); setPreview(null); setServiceId(""); toast.success("Unlinked."); }
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
      if (!window.confirm("Sync environment variables from Render?\n\n" + (lines.join("\n") || "No variable changes.") + "\n\nRender is only read, never changed.")) return;
      const result = await run({ apply: true, resolveConflicts: true });
      setPreview(result);
      await refreshProfile();
      toast.success("Synced from Render: " + result.added.length + " added, " + result.updated.length + " updated.");
    } catch (e) { setError(errorOf(e, "Sync failed.")); }
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
            <span className="badge badge--ok">Linked</span>
            <span className="badge badge--muted">{project.renderServiceName || project.renderServiceId}</span>
            {accountName ? <span className="badge badge--muted">{accountName}</span> : null}
            <span className="badge badge--muted">Synced {project.renderSyncedAt ? ago(project.renderSyncedAt) : "never"}</span>
          </div>
          <div className="gh-panel__row">
            <button type="button" className="btn btn--primary btn--sm" disabled={Boolean(busy)} onClick={() => void syncNow()}>
              {busy === "sync" ? <span className="spinner" /> : <Refresh size={13} />} {busy === "sync" ? "Syncing…" : "Sync now"}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" disabled={Boolean(busy)} onClick={() => void check()}>{busy === "preview" ? "Checking…" : "Preview changes"}</button>
            <label className="gh-auto"><input type="checkbox" checked={project.renderAutoSync === "on"} onChange={(e) => void toggleAuto(e.target.checked)} /> Keep updated automatically</label>
            <button type="button" className="btn btn--ghost btn--sm" disabled={Boolean(busy)} onClick={() => void unlink()}>Unlink</button>
          </div>
          <p className="field__note">Automatic updates run in the background about every 15 minutes (needs the monitoring scheduler) and never overwrite a value you typed by hand.</p>
        </>
      )}

      {error ? <div className="notice notice--err" role="alert">{error}</div> : null}

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
