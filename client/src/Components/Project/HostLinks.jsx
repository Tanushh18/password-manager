import React, { useCallback, useEffect, useState } from "react";
import { Modal } from "react-responsive-modal";
import "react-responsive-modal/styles.css";
import { toast } from "react-toastify";
import { getHostAccounts, getHostLinkBranches, getHostSites, getProjectHostLinks, linkHostSite, redeployHostLink, unlinkHostSite } from "../../api/client";
import { usePolling } from "../../Pages/Render/renderHooks";
import { timeAgo, safeUrl, errorMessage } from "../../Pages/Render/renderUtils";
import { useVault } from "../../state/vault";
import { hostById } from "../../lib/hostGuides";
import HostConnectModal from "./HostConnectModal";
import "./ProjectDeployments.css";

const LABEL = { live: "Live", building: "Building", failed: "Failed", unknown: "Unknown" };

/** Pick a site you already have on a connected host and link it to this project. */
function LinkModal({ open, onClose, projectId, onLinked, onConnect }) {
  const [accounts, setAccounts] = useState(null);
  const [accountId, setAccountId] = useState("");
  const [sites, setSites] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setError(""); setSites(null);
    getHostAccounts().then((r) => { const list = r.accounts || []; setAccounts(list); setAccountId((id) => id && list.some((a) => a.id === id) ? id : list[0]?.id || ""); }).catch(() => setAccounts([]));
  }, [open]);
  useEffect(() => {
    if (!open || !accountId) { setSites(null); return undefined; }
    let live = true;
    setSites(null); setError("");
    getHostSites(accountId).then((r) => { if (live) setSites(r.sites || []); }).catch((e) => { if (live) { setSites([]); setError(errorMessage(e, "Could not list the sites.")); } });
    return () => { live = false; };
  }, [open, accountId]);

  const link = async (site) => {
    setBusy(site.id);
    try { await linkHostSite(projectId, { hostAccountId: accountId, remoteId: site.id }); toast.success("Linked " + site.name + "."); await onLinked(); onClose(); }
    catch (e) { toast.error(errorMessage(e, "Could not link this site.")); }
    finally { setBusy(""); }
  };
  const shown = (sites || []).filter((s) => !query.trim() || (s.name + " " + s.repo).toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <Modal open={open} onClose={onClose} center classNames={{ modal: "sheet" }}>
      <div className="sheet__body">
        <span className="card__ribbon" />
        <div className="sheet__head">
          <h2 className="sheet__title">Link an existing server</h2>
          <p className="sheet__sub">Choose a site or project you already have on Vercel, Netlify, Railway or Cloudflare Pages. Linking only reads it; nothing is changed on the host.</p>
        </div>
        {accounts && !accounts.length ? <p className="field__note">No hosting account is connected yet.</p> : (
          <div className="field">
            <label className="field__label" htmlFor="hl-acc">Hosting account</label>
            <select id="hl-acc" className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={!accounts?.length}>
              {(accounts || []).map((a) => <option key={a.id} value={a.id}>{(hostById(a.provider)?.label || a.provider) + ": " + a.name}</option>)}
            </select>
          </div>
        )}
        <div className="gh-panel__row"><button type="button" className="btn btn--ghost btn--sm" onClick={onConnect}>Connect another account</button></div>
        {error ? <div className="notice notice--err" role="alert">{error}</div> : null}
        {accountId && sites === null ? <p className="field__note">Reading your sites…</p> : null}
        {sites && sites.length > 8 ? <input className="input" placeholder="Search…" aria-label="Search sites" value={query} onChange={(e) => setQuery(e.target.value)} /> : null}
        {sites && !sites.length && !error ? <p className="field__note">No sites found on this account.</p> : null}
        <ul className="gh-accounts" aria-label="Sites on this account">
          {shown.map((s) => (
            <li key={s.id}>
              <div><strong>{s.name}</strong><small>{[s.repo, s.branch].filter(Boolean).join(" · ") || s.url || "—"}</small></div>
              <button type="button" className="btn btn--primary btn--sm" disabled={Boolean(busy)} onClick={() => void link(s)}>{busy === s.id ? "Linking…" : "Link"}</button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

/** One linked server: status, last deploy, and a branch picker plus Redeploy where the host supports it. */
function LinkRow({ row, projectId, onChanged }) {
  const [branches, setBranches] = useState(null);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);

  const openBranches = async () => {
    if (branches || busy) return;
    setBusy(true);
    try { const r = await getHostLinkBranches(projectId, row.id); setBranches(r); setChoice(r.current || row.branch || ""); }
    catch (e) { toast.error(errorMessage(e, "Could not read the branches.")); }
    finally { setBusy(false); }
  };
  const redeploy = async (branch) => {
    const target = branch || row.branch;
    if (!window.confirm("Redeploy " + row.name + (target ? " from \"" + target + "\"" : "") + " on " + row.label + "?")) return;
    setBusy(true);
    try { await redeployHostLink(projectId, row.id, branch || undefined); toast.success("Redeploy started on " + row.label + "."); setBranches(null); onChanged(); }
    catch (e) { toast.error(errorMessage(e, "Could not start the redeploy.")); }
    finally { setBusy(false); }
  };
  const unlink = async () => {
    if (!window.confirm("Unlink " + row.name + " from this project? The server itself is not touched.")) return;
    try { await unlinkHostSite(projectId, row.id); toast.success("Unlinked."); onChanged(true); }
    catch (e) { toast.error(errorMessage(e, "Could not unlink.")); }
  };

  const d = row.latestDeploy;
  return (
    <tr>
      <td><strong>{row.name}</strong><small>{row.label}{row.accountName ? " · " + row.accountName : ""}</small></td>
      <td>{row.url ? <a href={safeUrl(row.url, row.dashboardUrl)} target="_blank" rel="noopener noreferrer">{row.url.replace(/^https:\/\//, "")}</a> : <span className="pdep__dim">—</span>}</td>
      <td>{row.error ? <small className="pdep__err">{row.error}</small> : d ? <><span className={"pdep__deploy is-" + (d.status === "live" ? "ok" : d.status === "failed" ? "bad" : "mid")}>{LABEL[d.status] || d.status}</span><small>{timeAgo(d.at)}{d.sha ? " · " + d.sha : ""}</small></> : <span className="pdep__dim">—</span>}</td>
      <td>
        {!branches ? (
          <div className="pdep__branch"><span>{d?.branch || row.branch || "default"}</span>{row.branchDeploy ? <button type="button" className="btn btn--ghost btn--sm" onClick={() => void openBranches()} disabled={busy}>{busy ? "Reading…" : "Change"}</button> : null}</div>
        ) : !branches.connected ? <small className="pdep__err">Connect GitHub to choose a branch.</small> : (
          <div className="pdep__branch">
            <select className="input" value={choice} onChange={(e) => setChoice(e.target.value)} aria-label={"Branch for " + row.name} disabled={busy}>
              {branches.branches.map((b) => <option key={b} value={b}>{b}{b === branches.default ? " (default)" : ""}</option>)}
            </select>
            <button type="button" className="btn btn--primary btn--sm" disabled={busy || !choice} onClick={() => void redeploy(choice)}>{busy ? "Working…" : "Deploy this branch"}</button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setBranches(null)} disabled={busy}>Cancel</button>
          </div>
        )}
      </td>
      <td>
        <div className="pdep__branch">
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy || Boolean(row.error)} onClick={() => void redeploy("")}>Redeploy</button>
          {row.dashboardUrl ? <a href={safeUrl(row.dashboardUrl, row.dashboardUrl)} target="_blank" rel="noopener noreferrer" aria-label={"Open " + row.name + " on " + row.label}>Open ↗</a> : null}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void unlink()}>Unlink</button>
        </div>
      </td>
    </tr>
  );
}

/** Existing Vercel / Netlify / Railway / Cloudflare servers linked to a project, read live from each host. */
export default function HostLinks({ project }) {
  const { refreshProfile } = useVault();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [pick, setPick] = useState(false);
  const [connect, setConnect] = useState(false);

  const load = useCallback(async () => {
    try { const r = await getProjectHostLinks(project.id); setRows(r.links || []); setError(""); }
    catch (e) { setError(errorMessage(e, "Could not read the linked servers.")); setRows((old) => old || []); }
  }, [project.id]);
  useEffect(() => { void load(); }, [load]);
  usePolling(() => load(), 120000, true);

  // Link changes are saved in the project on the server; reload the vault copy so a later edit does not overwrite them.
  const changed = async () => { await load(); void refreshProfile?.(); };

  return (
    <section className="card pdep" aria-label="Other hosting">
      <header className="pdep__head">
        <div>
          <h2>Other hosting</h2>
          <p>{rows === null ? "Reading linked servers…" : rows.length ? rows.length + " linked server" + (rows.length === 1 ? "" : "s") + " on Vercel, Netlify, Railway or Cloudflare" : "Link a server you already run on Vercel, Netlify, Railway or Cloudflare Pages."}</p>
        </div>
        <button type="button" className="btn btn--primary btn--sm" onClick={() => setPick(true)}>Link existing server</button>
      </header>
      {error ? <div className="notice notice--err" role="alert">{error}</div> : null}
      {rows?.length ? (
        <div className="pdep__scroll">
          <table className="pdep__table">
            <thead><tr><th>Server</th><th>URL</th><th>Last deploy</th><th>Branch</th><th /></tr></thead>
            <tbody>{rows.map((row) => <LinkRow key={row.id} row={row} projectId={project.id} onChanged={(refresh) => (refresh ? void changed() : void load())} />)}</tbody>
          </table>
        </div>
      ) : null}
      <LinkModal open={pick} onClose={() => setPick(false)} projectId={project.id} onLinked={changed} onConnect={() => setConnect(true)} />
      <HostConnectModal open={connect} onClose={() => setConnect(false)} />
    </section>
  );
}
