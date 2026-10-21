import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { getProjectDeployments, getServiceBranches, setServiceBranch } from "../../api/client";
import { usePolling } from "../../Pages/Render/renderHooks";
import { timeAgo, safeUrl, errorMessage } from "../../Pages/Render/renderUtils";
import ServerEnvCopy from "./ServerEnvCopy";
import EnvGroupSync from "./EnvGroupSync";
import { UrlMenu, SortTh, AccountPicker, ServerLogs, DEPLOY_LABEL } from "./ServerParts";
import "./ProjectDeployments.css";

const FILTERS = [["all", "All"], ["common", "Common"], ["different", "Different values"], ["partial", "Only on some"], ["stashr_only", "Only in Stashr"]];
const COUNT_KEY = { all: "total", common: "common", different: "different", partial: "partial", stashr_only: "stashrOnly" };
const STATE_RANK = { live: 0, suspended: 1, unknown: 2, gone: 3 };

// One read per project at a time: the server table and the branch tree on the same page share it.
const inFlight = new Map();
/** Reads the project's servers from Render. Calls within 20 seconds share one request. */
export function readDeployments(projectId, { fresh = false } = {}) {
  const hit = inFlight.get(projectId);
  if (hit && !fresh && Date.now() - hit.at < 20000) return hit.promise;
  const promise = getProjectDeployments(projectId);
  inFlight.set(projectId, { at: Date.now(), promise });
  promise.catch(() => inFlight.delete(projectId));
  return promise;
}

function serverState(s) {
  if (s.gone) return ["gone", "Deleted on Render"];
  if (s.error && !s.url) return ["unknown", "Unreadable"];
  return s.suspended ? ["suspended", "Suspended"] : ["live", "Running"];
}

/** Sort key for each server column. Missing values sort last. */
const SORTERS = {
  name: (s) => String(s.name || "").toLowerCase(),
  status: (s) => STATE_RANK[serverState(s)[0]] ?? 9,
  deploy: (s) => (s.latestDeploy?.at ? Date.parse(s.latestDeploy.at) : 0),
  branch: (s) => String(s.branch || ""),
  plan: (s) => String(s.plan || ""),
  env: (s) => (s.envCount == null ? -1 : s.envCount)
};

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

/** "Copy env" button for one server row, opening the copy dialog. */
function EnvCopyButton({ server, onDone }) {
  const [open, setOpen] = useState(false);
  if (server.gone || (server.error && !server.url)) return null;
  return (
    <>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(true)}>Copy env</button>
      {open ? <ServerEnvCopy server={server} open={open} onClose={() => setOpen(false)} onDone={onDone} /> : null}
    </>
  );
}

/** Every Render server a project is deployed on: account, URLs, status, deploys, branch and variables compared to the main server. */
export default function ProjectDeployments({ project }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState({ key: "name", dir: "asc" });
  const [syncFrom, setSyncFrom] = useState(null); // service id the env sync dialog starts from
  const [openLogs, setOpenLogs] = useState(() => new Set());

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try { setData(await readDeployments(project.id, { fresh: quiet })); setError(""); }
    catch (e) { if (!quiet) setError(errorMessage(e, "Could not read the deployments from Render.")); }
    finally { if (!quiet) setLoading(false); }
  }, [project.id]);
  useEffect(() => { void load(); }, [load, (project.renderServices || []).length]);
  usePolling(() => load({ quiet: true }), 120000, true);

  const servers = data?.servers || [];
  const main = servers.find((s) => s.isMain) || servers[0];
  const sortedServers = useMemo(() => {
    const key = SORTERS[sort.key] || SORTERS.name;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...servers].sort((a, b) => {
      const x = key(a), y = key(b);
      if (x === y) return String(a.name).localeCompare(String(b.name));
      return (x > y ? 1 : -1) * dir;
    });
  }, [servers, sort]);
  const columns = useMemo(() => [...servers, ...(data?.stashr ? [{ id: "stashr", name: "Stashr", isStashr: true }] : [])], [servers, data]);
  const rows = useMemo(() => (data?.env?.rows || []).filter((r) => (filter === "all" || r.status === filter) && (!query.trim() || r.name.toLowerCase().includes(query.trim().toLowerCase()))), [data, filter, query]);
  const summary = data?.env?.summary || {};
  const running = servers.filter((s) => !s.gone && !s.suspended).length;

  // How many variables each server differs from the main server (a missing or different value both count).
  const differsFromMain = useMemo(() => {
    const out = new Map();
    if (!main) return out;
    for (const s of servers) {
      if (s.id === main.id) continue;
      let n = 0;
      for (const r of data?.env?.rows || []) if ((r.cells?.[s.id]?.variant || r.cells?.[s.id]?.state) !== (r.cells?.[main.id]?.variant || r.cells?.[main.id]?.state)) n += 1;
      out.set(s.id, n);
    }
    return out;
  }, [servers, main, data]);

  const toggleLogs = (id) => setOpenLogs((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const branchCount = new Set(servers.map((s) => s.branch).filter(Boolean)).size;

  return (
    <section className="card pdep" aria-label="Deployments">
      <header className="pdep__head">
        <div>
          <h2>Deployments</h2>
          <p>{loading && !data ? "Reading every server from Render…" : `${servers.length} Render server${servers.length === 1 ? "" : "s"} · ${running} running · ${branchCount} branch${branchCount === 1 ? "" : "es"}${data ? " · live from Render " + timeAgo(data.checkedAt) : ""}`}</p>
        </div>
        <div className="pdep__actions">
          {main && servers.length > 1 ? <button type="button" className="btn btn--primary btn--sm" onClick={() => setSyncFrom(main.id)}>Sync env to servers on this branch</button> : null}
          <button type="button" className="btn btn--ghost btn--sm" disabled={loading} onClick={() => void load()}>{loading ? "Reading…" : "↻ Refresh"}</button>
        </div>
      </header>
      {error ? <div className="notice notice--err" role="alert">{error}</div> : null}

      {servers.length > 0 && (
        <div className="pdep__scroll">
          <table className="pdep__table pdep__servers">
            <thead><tr>
              <SortTh id="name" label="Server" sort={sort} onSort={setSort} />
              <th>URL</th>
              <SortTh id="status" label="Status" sort={sort} onSort={setSort} />
              <SortTh id="deploy" label="Last deploy" sort={sort} onSort={setSort} />
              <SortTh id="plan" label="Plan · region" sort={sort} onSort={setSort} />
              <SortTh id="branch" label="Branch" sort={sort} onSort={setSort} />
              <SortTh id="env" label="Env vars" sort={sort} onSort={setSort} />
              <th />
            </tr></thead>
            <tbody>
              {sortedServers.map((s) => {
                const [state, label] = serverState(s);
                const diff = differsFromMain.get(s.id) || 0;
                const logsOpen = openLogs.has(s.id);
                return (
                  <React.Fragment key={s.id}>
                    <tr className={"is-" + state}>
                      <td>
                        <strong>{s.name}</strong>{s.isMain ? <em className="pdep__main">main</em> : null}
                        <AccountPicker projectId={project.id} server={s} onDone={() => void load({ quiet: true })} />
                      </td>
                      <td><UrlMenu urls={[s.url]} /></td>
                      <td><span className={"pdep__pill is-" + state}>{label}</span>{s.error && state !== "gone" ? <small className="pdep__err">{s.error}</small> : null}</td>
                      <td>{s.latestDeploy ? <><span className={"pdep__deploy is-" + (s.latestDeploy.status === "live" ? "ok" : /fail/.test(s.latestDeploy.status) ? "bad" : "mid")}>{DEPLOY_LABEL[s.latestDeploy.status] || s.latestDeploy.status}</span><small>{timeAgo(s.latestDeploy.at)}{s.latestDeploy.sha ? " · " + s.latestDeploy.sha : ""}</small></> : <span className="pdep__dim">—</span>}</td>
                      <td>{[s.plan, s.region].filter(Boolean).join(" · ") || <span className="pdep__dim">—</span>}</td>
                      <td><BranchPicker server={s} onDone={() => void load({ quiet: true })} /></td>
                      <td>
                        {s.envCount == null ? <span className="pdep__dim">?</span> : s.envCount}
                        {s.envPartial ? <small className="pdep__err">too many to compare</small> : null}
                        {main && s.id !== main.id && diff ? <small className="pdep__diff" title="Variables that differ from the main server">{diff} differ from main</small> : null}
                      </td>
                      <td>
                        <div className="pdep__branch">
                          <button type="button" className="btn btn--ghost btn--sm" aria-expanded={logsOpen} onClick={() => toggleLogs(s.id)}>{logsOpen ? "Hide logs" : "Logs"}</button>
                          <EnvCopyButton server={s} onDone={() => void load({ quiet: true })} />
                          {s.dashboardUrl ? <a href={safeUrl(s.dashboardUrl)} target="_blank" rel="noopener noreferrer" aria-label={"Open " + s.name + " in Render"}>Render ↗</a> : null}
                        </div>
                      </td>
                    </tr>
                    {logsOpen ? <tr className="pdep__logrow"><td colSpan={8}><ServerLogs server={s} /></td></tr> : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && (data.env?.rows || []).length > 0 && (
        <details className="pdep__more">
          <summary>Environment variables by server <small>{summary.common ?? 0} common · {summary.different ?? 0} different · {summary.partial ?? 0} only on some</small></summary>
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
        </details>
      )}
      {data && !servers.length && !error ? <p className="pdep__dim">This project is not linked to a Render server yet.</p> : null}

      {syncFrom && main ? (
        <EnvGroupSync projectId={project.id} servers={servers} initialSource={syncFrom} open={Boolean(syncFrom)} onClose={() => setSyncFrom(null)} onDone={() => void load({ quiet: true })} />
      ) : null}
    </section>
  );
}
