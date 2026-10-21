import React, { useCallback, useMemo, useState } from "react";
import { readDeployments } from "./readDeployments";
import { errorMessage, timeAgo } from "../../Pages/Render/renderUtils";

/* Render servers side by side: which variables are common, different, or missing on some. Loads only when opened. */
const FILTERS = [["all", "All"], ["common", "Common"], ["different", "Different values"], ["partial", "Only on some"], ["stashr_only", "Only in Stashr"]];
const COUNT_KEY = { all: "total", common: "common", different: "different", partial: "partial", stashr_only: "stashrOnly" };

function Cell({ cell }) {
  if (!cell || cell.state === "unknown") return <span className="pdep-cell pdep-cell--unknown" title="Could not be read">?</span>;
  if (cell.state === "missing") return <span className="pdep-cell pdep-cell--missing" title="Not set on this server">—</span>;
  if (cell.state === "empty") return <span className="pdep-cell pdep-cell--empty" title="Set, but empty">empty</span>;
  return <span className={"pdep-cell pdep-v pdep-v--" + cell.variant} title={"Value " + cell.variant + " (same letter = same value)"}>{cell.variant}</span>;
}

export default function RenderMatrix({ project }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const load = useCallback(() => readDeployments(project.id, { fresh: true }).then(setData).catch((e) => setError(errorMessage(e, "Could not read the Render variables."))), [project.id]);
  const columns = useMemo(() => [...(data?.servers || []), ...(data?.stashr ? [{ id: "stashr", name: "Stashr", isStashr: true }] : [])], [data]);
  const rows = useMemo(() => (data?.env?.rows || []).filter((r) => (filter === "all" || r.status === filter) && (!query.trim() || r.name.toLowerCase().includes(query.trim().toLowerCase()))), [data, filter, query]);
  const summary = data?.env?.summary || {};

  return (
    <details className="pdep__more" onToggle={(e) => { if (e.currentTarget.open && !data) void load(); }}>
      <summary>Render variables side by side <small>Render servers only</small></summary>
      {error ? <div className="notice notice--err" role="alert">{error}</div> : null}
      {!data && !error ? <p className="field__note">Reading every Render server…</p> : null}
      {data && !(data.env?.rows || []).length ? <p className="pdep__dim">No Render variables to compare.</p> : null}
      {data && (data.env?.rows || []).length > 0 && (
        <>
          <p className="pdep__note">
            <b>{summary.common ?? 0}</b> common · <b>{summary.different ?? 0}</b> with different values · <b>{summary.partial ?? 0}</b> only on some{summary.stashrOnly ? <> · <b>{summary.stashrOnly}</b> only in Stashr</> : null}. Values are never shown; the same letter means the same value. Read {timeAgo(data.checkedAt)}.
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
                {columns.map((c) => <th key={c.id} className={c.isStashr ? "is-stashr" : c.suspended ? "is-off" : ""} title={c.name}><span>{c.name}</span>{c.isMain ? <em className="pdep__main">main</em> : null}</th>)}
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
        </>
      )}
    </details>
  );
}
