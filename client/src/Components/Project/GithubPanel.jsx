import React, { useCallback, useEffect, useState } from "react";
import { External, Refresh, Alert } from "../Icons/Icons";
import { getGithubRepo } from "../../api/client";

const ago = (value) => {
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return "—";
  const m = Math.max(0, Math.floor((Date.now() - t) / 60000));
  return m < 1 ? "just now" : m < 60 ? m + "m ago" : m < 1440 ? Math.floor(m / 60) + "h ago" : Math.floor(m / 1440) + "d ago";
};
const CI_BADGE = { passing: "badge--ok", failing: "badge--danger", running: "badge--warn", other: "badge--muted" };
const CI_LABEL = { passing: "CI passing", failing: "CI failing", running: "CI running", other: "CI finished" };
const safe = (url) => (/^https:\/\/github\.com\//.test(String(url || "")) ? url : null);

/** One project's GitHub details. Fetched on demand from the server (which holds the token) when the project is opened. */
export default function GithubPanel({ repoUrl, onConnect, refreshKey }) {
  const [state, setState] = useState({ status: "loading" });

  const load = useCallback(async (refresh = false) => {
    setState((old) => (old.status === "ready" ? { ...old, refreshing: true } : { status: "loading" }));
    try {
      const data = await getGithubRepo(repoUrl, refresh);
      setState(data.connected === false ? { status: "disconnected" } : { status: "ready", data });
    } catch (e) {
      setState({ status: "error", message: e?.response?.data?.error || "Could not load GitHub details.", code: e?.response?.status });
    }
  }, [repoUrl]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  if (state.status === "loading") return <section className="card gh-panel" aria-busy="true"><h2 className="gh-panel__title">GitHub</h2><p className="field__note">Loading repository details…</p></section>;
  if (state.status === "disconnected") return (
    <section className="card gh-panel">
      <h2 className="gh-panel__title">GitHub</h2>
      <p className="field__note">Connect a GitHub token to see this repository’s commits, pull requests and CI status here.</p>
      <button type="button" className="btn btn--primary btn--sm" onClick={onConnect}>Connect GitHub</button>
    </section>
  );
  if (state.status === "error") return (
    <section className="card gh-panel">
      <h2 className="gh-panel__title">GitHub</h2>
      <div className="notice notice--err" role="alert"><Alert size={15} /> {state.message}</div>
      <div className="gh-panel__row">
        {state.code === 401 || state.code === 403 || state.code === 404 ? <button type="button" className="btn btn--ghost btn--sm" onClick={onConnect}>Manage tokens</button> : null}
        {state.code !== 400 ? <button type="button" className="btn btn--ghost btn--sm" onClick={() => void load(true)}><Refresh size={13} /> Retry</button> : null}
      </div>
    </section>
  );

  const { data } = state;
  const { repo, commits, pulls, ci, partial } = data;
  return (
    <section className="card gh-panel" aria-label="GitHub details">
      <header className="gh-panel__head">
        <div>
          <h2 className="gh-panel__title">GitHub {safe(repo.url) ? <a href={repo.url} target="_blank" rel="noreferrer noopener" className="gh-panel__repo">{repo.fullName} <External size={12} /></a> : repo.fullName}</h2>
          {repo.description ? <p className="field__note">{repo.description}</p> : null}
        </div>
        <button type="button" className="btn btn--ghost btn--sm" disabled={state.refreshing} onClick={() => void load(true)}><Refresh size={13} /> {state.refreshing ? "Refreshing…" : "Refresh"}</button>
      </header>

      <div className="vault-card__badges">
        {ci ? <a className={"badge " + (CI_BADGE[ci.state] || "badge--muted")} href={safe(ci.url) || undefined} target="_blank" rel="noreferrer noopener" title={ci.name + " on " + (ci.branch || "branch") + " · " + ago(ci.at)}>{CI_LABEL[ci.state]}</a> : <span className="badge badge--muted">No CI runs</span>}
        <span className="badge badge--muted">{repo.defaultBranch || "no default branch"}</span>
        {repo.private ? <span className="badge badge--muted">Private</span> : <span className="badge badge--muted">Public</span>}
        {repo.archived ? <span className="badge badge--warn">Archived</span> : null}
        {repo.language ? <span className="badge badge--muted">{repo.language}</span> : null}
        <span className="badge badge--muted">★ {repo.stars}</span>
        <span className="badge badge--muted">Pushed {ago(repo.pushedAt)}</span>
        <span className="badge badge--muted">{repo.openIssuesAndPulls} open issue{repo.openIssuesAndPulls === 1 ? "" : "s"} &amp; PRs</span>
      </div>

      {partial?.length ? <p className="field__note">Couldn’t load {partial.join(", ")} — the token may lack that read permission.</p> : null}

      <div className="gh-panel__cols">
        <div>
          <h3 className="gh-panel__sub">Recent commits</h3>
          {commits.length ? <ul className="gh-list">{commits.map((c) => (
            <li key={c.sha}><code>{safe(c.url) ? <a href={c.url} target="_blank" rel="noreferrer noopener">{c.sha}</a> : c.sha}</code><span>{c.message || "(no message)"}</span><small>{c.author} · {ago(c.at)}</small></li>
          ))}</ul> : <p className="field__note">No commits returned.</p>}
        </div>
        <div>
          <h3 className="gh-panel__sub">Open pull requests {pulls.length ? <span className="badge badge--muted">{pulls.length}{pulls.length === 10 ? "+" : ""}</span> : null}</h3>
          {pulls.length ? <ul className="gh-list">{pulls.map((p) => (
            <li key={p.number}><code>#{p.number}</code><span>{safe(p.url) ? <a href={p.url} target="_blank" rel="noreferrer noopener">{p.title}</a> : p.title}{p.draft ? " (draft)" : ""}</span><small>{p.author} · {ago(p.updatedAt)}</small></li>
          ))}</ul> : <p className="field__note">No open pull requests.</p>}
        </div>
      </div>
      <p className="field__note">Fetched {ago(data.fetchedAt)} with the “{data.account.login}” token{data.cached ? " (cached up to 1 minute)" : ""}.</p>
    </section>
  );
}
