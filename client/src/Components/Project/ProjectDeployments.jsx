import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { getProjectDeployments, getServiceBranches, setServiceBranch } from "../../api/client";
import { usePolling } from "../../Pages/Render/renderHooks";
import { timeAgo, safeUrl, errorMessage } from "../../Pages/Render/renderUtils";
import "./ProjectDeployments.css";

const FILTERS = [["all", "All"], ["common", "Common"], ["different", "Different values"], ["partial", "Only on some"], ["stashr_only", "Only in Stashr"]];
const COUNT_KEY = { all: "total", common: "common", different: "different", partial: "partial", stashr_only: "stashrOnly" };
const DEPLOY_LABEL = { live: "Live", build_in_progress: "Building", update_in_progress: "Deploying", build_failed: "Build failed", update_failed: "Deploy failed", canceled: "Canceled", deactivated: "Replaced", created: "Queued" };
const host = (url) => String(url || "").replace(/^https?:\/\//, "").replace(/\/$/, "");

function serverState(s) {
  if (s.gone) return ["gone", "Deleted on Render"];
  if (s.error && !s.url) return ["unknown", "Unreadable"];
  return s.suspended ? ["suspended", "Suspended"] : ["live", "Running"];
}

function Cell({ cell }) {
  if (!cell || cell.state === "unknown") return <span className="pdep-cell pdep-cell--unknown" title="Could not be read">?</span>;
  if (cell.state === "missing") return <span className="pdep-cell pdep-cell--missing" title="Not set on this server">—</span>;
  if (cell.state === "empty") return <span className="pdep-cell pdep-cell--empty" title="Set, but empty">empty</span>;
  return <span className={"pdep-cell pdep-v pdep-v--" + cell.variant} title={"Value " + cell.variant + " (same letter = same value)"}>{cell.variant}</span>;
}

/** Pick which GitHub branch this server deploys. The branch list is read from the repo only when asked. */
function BranchPicker({ server, onDone }) {
  const [info, setInfo] = useState(null);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const open = async () => {
    if (info || busy) return;
    setBusy(true);
    try { const r = await getServiceBranches(server.accountId, server.id); setInfo(r); setChoice(r.current || server.branch || ""); setErr(""); }
    catch (e) { setErr(errorMessage(e, "Could not read the branches.")); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    const same = choice === (info.current || "");
    if (!window.confirm(same ? `Deploy "${choice}" on ${server.name} again?` : `Switch ${server.name} from "${info.current || "its current branch"}" to "${choice}" and deploy it?`)) return;
    setBusy(true);
    try {
      const r = await setServiceBranch(server.accountId, server.id, choice, true);
      toast.success(r.deployed ? `Deploying ${r.branch}.` : r.note || `Branch set to ${r.branch}.`);
      setInfo(null);
      onDone();
    } catch (e) { toast.error(errorMessage(e, "Could not change the branch.")); }
    finally { setBusy(false); }
  };

  if (server.gone || (server.error && !server.url)) return <span className="pdep__dim">—</span>;
  if (!info) return (
    <div className="pdep__branch">
      <span>{server.branch || "default"}</span>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => void open()} disabled={busy}>{busy ? "Reading…" : "Change"}</button>
      {err ? <small className="pdep__err">{err}</small> : null}
    </div>
  );
  if (!info.connected) return <small className="pdep__err">Connect GitHub (above) to choose a branch.</small>;
  return (
    <div className="pdep__branch">
      <select className="input" value={choice} onChange={(e) => setChoice(e.target.value)} aria-label={`Branch for ${server.name}`} disabled={busy}>
        {!info.branches.some((b) => b.name === info.current) && info.current ? <option value={info.current}>{info.current}</option> : null}
        {info.branches.map((b) => <option key={b.name} value={b.name}>{b.name}{b.name === info.default ? " (default)" : ""}</option>)}
      </select>
      <button type="button" className="btn btn--primary btn--sm" onClick={() => void apply()} disabled={busy || !choice}>{busy ? "Working…" : choice === info.current ? "Redeploy" : "Switch and deploy"}</button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setInfo(null)} disabled={busy}>Cancel</button>
    </div>
  );
}

/** Every Render server a project is deployed on: URL, status, last deploy, and which env vars are common or differ. */
export default function ProjectDeployments({ project }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try { setData(await getProjectDeployments(project.id)); setError(""); }
    catch (e) { if (!quiet) setError(errorMessage(e, "Could not read the deployments from Render.")); }
    finally { if (!quiet) setLoading(false); }
  }, [project.id]);
  useEffect(() => { void load(); }, [load, (project.renderServices || []).length]);
  usePolling(() => load({ quiet: true }), 120000, true);

  const servers = data?.servers || [];
  const columns = useMemo(() => [...servers, ...(data?.stashr ? [{ id: "stashr", name: "Stashr", isStashr: true }] : [])], [servers, data]);
  const rows = useMemo(() => (data?.env?.rows || []).filter((r) => (filter === "all" || r.status === filter) && (!query.trim() || r.name.toLowerCase().includes(query.trim().toLowerCase()))), [data, filter, query]);
  const summary = data?.env?.summary || {};
  const running = servers.filter((s) => !s.gone && !s.suspended).length;

  return (
    <section className="card pdep" aria-label="Deployments">
      <header className="pdep__head">
        <div>
          <h2>Deployments</h2>
          <p>{loading && !data ? "Reading every server from Render…" : `${servers.length} Render server${servers.length === 1 ? "" : "s"} · ${running} running${data ? " · live from Render " + timeAgo(data.checkedAt) : ""}`}</p>
        </div>
        <button type="button" className="btn btn--ghost btn--sm" disabled={loading} onClick={() => void load()}>{loading ? "Reading…" : "↻ Refresh"}</button>
      </header>
      {error ? <div className="notice notice--err" role="alert">{error}</div> : null}

      {servers.length > 0 && (
        <div className="pdep__scroll">
          <table className="pdep__table">
            <thead><tr><th>Server</th><th>URL</th><th>Status</th><th>Last deploy</th><th>Plan · region</th><th>Branch</th><th>Env vars</th><th /></tr></thead>
            <tbody>
              {servers.map((s) => {
                const [state, label] = serverState(s);
                return (
                  <tr key={s.id} className={"is-" + state}>
                    <td><strong>{s.name}</strong>{s.isMain ? <em className="pdep__main">main</em> : null}<small>{s.accountName}{s.branch ? " · " + s.branch : ""}</small></td>
                    <td>{s.url ? <a href={safeUrl(s.url)} target="_blank" rel="noopener noreferrer" className="pdep__url">{host(s.url)} ↗</a> : <span className="pdep__dim">—</span>}</td>
                    <td><span className={"pdep__pill is-" + state}>{label}</span>{s.error && state !== "gone" ? <small className="pdep__err">{s.error}</small> : null}</td>
                    <td>{s.latestDeploy ? <><span className={"pdep__deploy is-" + (s.latestDeploy.status === "live" ? "ok" : /fail/.test(s.latestDeploy.status) ? "bad" : "mid")}>{DEPLOY_LABEL[s.latestDeploy.status] || s.latestDeploy.status}</span><small>{timeAgo(s.latestDeploy.at)}{s.latestDeploy.sha ? " · " + s.latestDeploy.sha : ""}</small></> : <span className="pdep__dim">—</span>}</td>
                    <td>{[s.plan, s.region].filter(Boolean).join(" · ") || <span className="pdep__dim">—</span>}</td>
                    <td><BranchPicker server={s} onDone={() => void load({ quiet: true })} /></td>
                    <td>{s.envCount == null ? <span className="pdep__dim">?</span> : s.envCount}{s.envPartial ? <small className="pdep__err">too many to compare</small> : null}</td>
                    <td>{s.dashboardUrl ? <a href={safeUrl(s.dashboardUrl)} target="_blank" rel="noopener noreferrer" aria-label={"Open " + s.name + " in Render"}>Render ↗</a> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && (data.env?.rows || []).length > 0 && (
        <>
          <h3 className="pdep__sub">Environment variables by server</h3>
          <p className="pdep__note">
            <b>{summary.common ?? 0}</b> common to every server · <b>{summary.different ?? 0}</b> with different values · <b>{summary.partial ?? 0}</b> only on some
            {summary.stashrOnly ? <> · <b>{summary.stashrOnly}</b> only saved in Stashr</> : null}. Values are never shown: the same letter means the same value, different letters mean different values.
          </p>
          <div className="pdep__tools">
            <div className="pdep__chips" role="group" aria-label="Filter variables">
              {FILTERS.map(([id, label]) => (summary[COUNT_KEY[id]] || id === "all") ? (
                <button key={id} type="button" aria-pressed={filter === id} className={filter === id ? "is-active" : ""} onClick={() => setFilter(id)}>{label} <span>{summary[COUNT_KEY[id]] ?? 0}</span></button>
              ) : null)}
            </div>
            <input className="input pdep__search" type="search" placeholder="Search variables…" aria-label="Search variables" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="pdep__scroll pdep__matrix">
            <table className="pdep__table pdep__table--matrix">
              <thead><tr>
                <th>Variable</th>
                {columns.map((c) => <th key={c.id} className={c.isStashr ? "is-stashr" : c.suspended ? "is-off" : ""} title={c.name}><span>{c.name}</span>{c.isMain ? <em className="pdep__main">main</em> : null}{c.suspended ? <small>suspended</small> : null}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} className={"is-" + r.status}>
                    <td><code>{r.name}</code><small className={"pdep__tag is-" + r.status}>{{ common: "common", different: "differs", partial: "some servers", stashr_only: "only Stashr" }[r.status]}</small></td>
                    {columns.map((c) => <td key={c.id}><Cell cell={r.cells[c.id]} /></td>)}
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={columns.length + 1} className="pdep__dim">No variables match.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="pdep__legend"><span className="pdep-cell pdep-v pdep-v--A">A</span> a value · <span className="pdep-cell pdep-v pdep-v--B">B</span> a different value · <span className="pdep-cell pdep-cell--missing">—</span> not set · <span className="pdep-cell pdep-cell--empty">empty</span> set but empty</p>
        </>
      )}
      {data && !servers.length && !error ? <p className="pdep__dim">This project is not linked to a Render server yet.</p> : null}
    </section>
  );
}
