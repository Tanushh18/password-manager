import React, { useCallback, useEffect, useRef, useState } from "react";
import { External } from "../Icons/Icons";
import { useVault } from "../../state/vault";
import { getGithubRepo, getProjectStatuses } from "../../api/client";
import { ago, CI_BADGE, CI_LABEL, HEALTH_BADGE, HEALTH_LABEL, safe } from "./ProjectStatus";
import "./ProjectOverview.css";

const githubUrl = (url) => (/^https:\/\/github\.com\//.test(String(url || "")) ? url : null);

/**
 * One card for everything that says how the project is doing: health, the latest deploy, CI, the repository and its
 * commits and pull requests. Commits, pull requests and undeployed commits are folded away until wanted.
 * Fetches both the Render/health status and the GitHub details; `refreshKey` (the page's "Refresh all") re-reads them.
 */
export default function ProjectOverview({ project, refreshKey, onConnect }) {
  const { refreshProfile } = useVault();
  const [status, setStatus] = useState({ state: "loading" });
  const [gh, setGh] = useState({ state: project.repoUrl ? "loading" : "none" });
  const linkedOnce = useRef(false);
  const refreshRef = useRef(refreshProfile);
  refreshRef.current = refreshProfile;

  const loadStatus = useCallback(async (refresh = false) => {
    setStatus((old) => (old.state === "ready" ? { ...old, busy: true } : { state: "loading" }));
    try {
      const data = await getProjectStatuses({ id: project.id, refresh });
      setStatus({ state: "ready", data: data.statuses.find((s) => s.projectId === String(project.id)) || null });
      // Auto-linking changed the saved project, so reload it into the app once.
      if (data.linkedNow?.length && !linkedOnce.current) { linkedOnce.current = true; void refreshRef.current?.(); }
    } catch (e) { setStatus({ state: "error", message: e?.response?.data?.error || "Could not load project status." }); }
  }, [project.id]);

  const loadGithub = useCallback(async (refresh = false) => {
    if (!project.repoUrl) { setGh({ state: "none" }); return; }
    setGh((old) => (old.state === "ready" ? { ...old, busy: true } : { state: "loading" }));
    try {
      const data = await getGithubRepo(project.repoUrl, refresh);
      if (data?.connected === false) setGh({ state: "disconnected" });
      else if (!data?.repo) setGh({ state: "error", message: "GitHub returned an unexpected response." });
      else setGh({ state: "ready", data });
    } catch (e) { setGh({ state: "error", message: e?.response?.data?.error || "Could not load GitHub details." }); }
  }, [project.repoUrl]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => { void loadGithub(); }, [loadGithub]);
  useEffect(() => { if (refreshKey) { void loadStatus(true); void loadGithub(true); } }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = status.state === "ready" ? status.data : null;
  const g = gh.state === "ready" ? gh.data : null;
  const health = s?.health;
  const ci = g?.ci || s?.ci;
  const repo = g?.repo;
  const drift = s?.drift;
  const waiting = drift?.behindBy > 0 ? drift.commits || [] : [];
  const commits = g?.commits || [];
  const pulls = g?.pulls || [];

  return (
    <section className="card ov" aria-label="Project overview" aria-busy={status.state === "loading"}>
      <header className="ov__head">
        <h2 className="ov__title">
          Health{" "}
          {health ? <span className={"badge " + (HEALTH_BADGE[health.level] || "badge--muted")}>{HEALTH_LABEL[health.level]}{health.score != null ? " · " + health.score : ""}</span> : null}
        </h2>
        <span className="ov__meta">
          {status.state === "loading" ? "Checking Render and GitHub…" : s?.checkedAt ? "Checked " + ago(s.checkedAt) : ""}
          {status.busy || gh.busy ? " · refreshing…" : ""}
        </span>
      </header>

      {status.state === "error" ? <p className="ov__note">{status.message} <button type="button" className="btn btn--ghost btn--sm" onClick={() => void loadStatus(true)}>Retry</button></p> : null}

      {health?.reasons?.length ? (
        <ul className="gh-reasons">{health.reasons.map((r, i) => <li key={i} className={"is-" + r.severity}>{r.text}</li>)}</ul>
      ) : null}

      <div className="ov__badges">
        {ci ? <a className={"badge " + (CI_BADGE[ci.state] || "badge--muted")} href={safe(ci.url) || undefined} target="_blank" rel="noreferrer noopener" title={ci.name + " on " + (ci.branch || "branch")}>{CI_LABEL[ci.state]}</a> : null}
        {s?.deploy ? <span className={"badge " + (/failed/.test(s.deploy.status) ? "badge--danger" : s.deploy.status === "live" ? "badge--ok" : "badge--muted")}>Deploy: {s.deploy.status.replace(/_/g, " ")} · {ago(s.deploy.at)}</span> : null}
        {s?.live?.sha ? <span className="badge badge--muted">Live {s.live.sha}</span> : null}
        {drift ? <span className={"badge " + (drift.behindBy > 0 ? "badge--warn" : "badge--ok")}>{drift.behindBy > 0 ? drift.behindBy + " not deployed yet" : drift.status === "behind" ? "Deployed ahead of " + drift.branch : "Up to date with " + drift.branch}</span> : null}
        {repo ? (
          <>
            <span className="badge badge--muted">{repo.defaultBranch || "no default branch"}</span>
            <span className="badge badge--muted">{repo.private ? "Private" : "Public"}</span>
            {repo.archived ? <span className="badge badge--warn">Archived</span> : null}
            {repo.language ? <span className="badge badge--muted">{repo.language}</span> : null}
            <span className="badge badge--muted">★ {repo.stars}</span>
            <span className="badge badge--muted">Pushed {ago(repo.pushedAt)}</span>
            <span className="badge badge--muted">{repo.openIssuesAndPulls} open issue{repo.openIssuesAndPulls === 1 ? "" : "s"} &amp; PRs</span>
          </>
        ) : null}
        {s?.github?.error ? <span className="badge badge--muted" title={s.github.error}>GitHub: {s.github.error}</span> : null}
      </div>

      <p className="ov__line">
        {s?.linked && s.service ? (
          <>{s.autoLinked ? "Linked automatically to " : "Linked to "}<strong>{s.service.name}</strong> ({s.service.accountName}){s.service.region ? " · " + s.service.region : ""}{s.service.plan ? " · " + s.service.plan : ""}{safe(s.service.dashboardUrl) ? <> · <a href={s.service.dashboardUrl} target="_blank" rel="noreferrer noopener">Render <External size={11} /></a></> : null}</>
        ) : s?.ambiguous ? (
          <>{s.ambiguous} Render services use this repository, so it was not linked automatically. Set the project’s <em>Hosting service name</em> to the right one.</>
        ) : s?.linked ? "The linked Render service was not found in your connected accounts." : s ? "No Render service uses this repository yet." : null}
        {repo ? <>{s ? " · " : ""}{githubUrl(repo.url) ? <a href={repo.url} target="_blank" rel="noreferrer noopener">{repo.fullName} <External size={11} /></a> : repo.fullName}</> : null}
        {gh.state === "disconnected" ? <>{" · "}<button type="button" className="btn btn--ghost btn--sm" onClick={onConnect}>Connect GitHub for CI, commits and drift</button></> : null}
        {gh.state === "error" ? <>{" · "}{gh.message} <button type="button" className="btn btn--ghost btn--sm" onClick={() => void loadGithub(true)}>Retry</button></> : null}
      </p>
      {repo?.description ? <p className="ov__desc">{repo.description}</p> : null}

      {waiting.length ? (
        <details className="ov__fold" open>
          <summary>Waiting to be deployed <span className="badge badge--warn">{drift.behindBy}</span></summary>
          <ul className="gh-list">{waiting.map((c) => (
            <li key={c.sha}><code>{safe(c.url) ? <a href={c.url} target="_blank" rel="noreferrer noopener">{c.sha}</a> : c.sha}</code><span>{c.message || "(no message)"}</span><small>{ago(c.at)}</small></li>
          ))}</ul>
        </details>
      ) : null}

      {g ? (
        <>
          <details className="ov__fold">
            <summary>Recent commits <span className="badge badge--muted">{commits.length}</span></summary>
            {commits.length ? <ul className="gh-list">{commits.map((c) => (
              <li key={c.sha}><code>{githubUrl(c.url) ? <a href={c.url} target="_blank" rel="noreferrer noopener">{c.sha}</a> : c.sha}</code><span>{c.message || "(no message)"}</span><small>{c.author} · {ago(c.at)}</small></li>
            ))}</ul> : <p className="ov__note">No commits returned.</p>}
          </details>
          <details className="ov__fold">
            <summary>Open pull requests <span className="badge badge--muted">{pulls.length}{pulls.length === 10 ? "+" : ""}</span></summary>
            {pulls.length ? <ul className="gh-list">{pulls.map((p) => (
              <li key={p.number}><code>#{p.number}</code><span>{githubUrl(p.url) ? <a href={p.url} target="_blank" rel="noreferrer noopener">{p.title}</a> : p.title}{p.draft ? " (draft)" : ""}</span><small>{p.author} · {ago(p.updatedAt)}</small></li>
            ))}</ul> : <p className="ov__note">No open pull requests.</p>}
          </details>
          {g.partial?.length ? <p className="ov__note">Could not load {g.partial.join(", ")}: the token may lack that read permission.</p> : null}
        </>
      ) : null}
      {s?.partial?.length ? <p className="ov__note">Some data was unavailable: {s.partial.join(", ")}. The score uses what could be read.</p> : null}
    </section>
  );
}
