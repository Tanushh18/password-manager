import React, { useEffect, useMemo, useState } from "react";
import { getGithubRepos } from "../../api/client";
import { errorMessage, timeAgo } from "../../Pages/Render/renderUtils";

const SORTS = [["pushed", "Recently pushed"], ["name", "Name A–Z"], ["owner", "Owner"], ["language", "Language"]];
const SORTERS = {
  pushed: (a, b) => String(b.pushedAt).localeCompare(String(a.pushedAt)),
  name: (a, b) => a.name.localeCompare(b.name),
  owner: (a, b) => a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name),
  language: (a, b) => String(a.language || "~").localeCompare(String(b.language || "~")) || a.name.localeCompare(b.name)
};

/** The GitHub account's own repositories, searchable and sortable. Picking one fills in the repository URL. */
export default function RepoPicker({ accountId, selected, onPick, disabled }) {
  const [state, setState] = useState({ status: "loading", repos: [], truncated: false, message: "" });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("pushed");
  const [showArchived, setShowArchived] = useState(false);

  const load = (refresh = false) => {
    setState((s) => ({ ...s, status: "loading" }));
    getGithubRepos(accountId, refresh)
      .then((r) => setState({ status: "ready", repos: r.repos || [], truncated: Boolean(r.truncated), message: "" }))
      .catch((e) => setState({ status: "error", repos: [], truncated: false, message: errorMessage(e, "Could not load your repositories.") }));
  };
  useEffect(() => { if (accountId) load(false); }, [accountId]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return state.repos
      .filter((r) => (showArchived || !r.archived) && (!needle || r.key.includes(needle) || String(r.description).toLowerCase().includes(needle)))
      .sort(SORTERS[sort]);
  }, [state.repos, query, sort, showArchived]);

  return (
    <div className="repopick" aria-label="Your GitHub repositories">
      <div className="repopick__tools">
        <input className="input" type="search" placeholder="Search your repositories…" aria-label="Search your repositories" value={query} onChange={(e) => setQuery(e.target.value)} disabled={disabled} />
        <label className="repopick__sort">Sort
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value)} disabled={disabled}>{SORTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
        </label>
        <label className="repopick__check"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Archived</label>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => load(true)} disabled={disabled || state.status === "loading"}>↻</button>
      </div>
      {state.status === "loading" ? <p className="field__note">Loading your repositories…</p> : null}
      {state.status === "error" ? <div className="notice notice--err" role="alert">{state.message}</div> : null}
      {state.status === "ready" ? (
        <>
          <p className="field__note">{rows.length} of {state.repos.length} repositories{state.truncated ? " (showing the first 500)" : ""}. Pick one, or paste its URL below.</p>
          <ul className="repopick__list">
            {rows.map((r) => (
              <li key={r.key}>
                <button type="button" className={"repopick__item" + (selected === r.url ? " is-selected" : "")} aria-pressed={selected === r.url} disabled={disabled} onClick={() => onPick(r)}>
                  <strong>{r.owner}/{r.name}</strong>
                  <span className="repopick__meta">
                    {r.private ? <em>private</em> : null}
                    {r.archived ? <em>archived</em> : null}
                    {r.language ? <span>{r.language}</span> : null}
                    {r.pushedAt ? <span>pushed {timeAgo(r.pushedAt)}</span> : null}
                  </span>
                  {r.description ? <small>{r.description}</small> : null}
                </button>
              </li>
            ))}
            {!rows.length ? <li className="field__note">No repository matches.</li> : null}
          </ul>
        </>
      ) : null}
    </div>
  );
}
