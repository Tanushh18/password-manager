import React, { useCallback, useEffect, useRef, useState } from "react";
import { Refresh } from "../Icons/Icons";
import { useVault } from "../../state/vault";
import { getProjectStatuses } from "../../api/client";

const ago = (value) => {
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return "—";
  const m = Math.max(0, Math.floor((Date.now() - t) / 60000));
  return m < 1 ? "just now" : m < 60 ? m + "m ago" : m < 1440 ? Math.floor(m / 60) + "h ago" : Math.floor(m / 1440) + "d ago";
};

export const HEALTH_BADGE = { green: "badge--ok", amber: "badge--warn", red: "badge--danger", unknown: "badge--muted" };
export const HEALTH_LABEL = { green: "Healthy", amber: "Needs a look", red: "Unhealthy", unknown: "No data yet" };
const CI_BADGE = { passing: "badge--ok", failing: "badge--danger", running: "badge--warn", other: "badge--muted" };
const CI_LABEL = { passing: "CI passing", failing: "CI failing", running: "CI running", other: "CI finished" };
const safe = (url) => (/^https:\/\//.test(String(url || "")) ? url : null);

/** Compact badge for project cards. */
export function HealthBadge({ status }) {
  if (!status) return null;
  const { health } = status;
  const title = health.reasons.map((r) => r.text).join("\n");
  return <span className={"badge " + (HEALTH_BADGE[health.level] || "badge--muted")} title={title}>{HEALTH_LABEL[health.level]}{health.score != null ? " · " + health.score : ""}</span>;
}

/**
 * Automatic project status: no buttons needed. Opening a project links it to its Render service (when the
 * match is unambiguous), then shows health, undeployed commits, the latest deploy and CI.
 */
export default function ProjectStatus({ project }) {
  const { refreshProfile } = useVault();
  const [state, setState] = useState({ status: "loading" });
  const refreshed = useRef(false);
  // Held in a ref so a re-created callback can never re-trigger the fetch.
  const refreshRef = useRef(refreshProfile);
  refreshRef.current = refreshProfile;

  const load = useCallback(async (refresh = false) => {
    setState((old) => (old.status === "ready" ? { ...old, refreshing: true } : { status: "loading" }));
    try {
      const data = await getProjectStatuses({ id: project.id, refresh });
      const mine = data.statuses.find((s) => s.projectId === String(project.id)) || null;
      setState({ status: "ready", data: mine });
      // Auto-linking changed the saved project, so reload it into the app once.
      if (data.linkedNow?.length && !refreshed.current) { refreshed.current = true; void refreshRef.current?.(); }
    } catch (e) { setState({ status: "error", message: e?.response?.data?.error || "Could not load project status." }); }
  }, [project.id]);

  useEffect(() => { void load(); }, [load]);

  if (state.status === "loading") return <section className="card gh-panel" aria-busy="true"><h2 className="gh-panel__title">Project health</h2><p className="field__note">Checking Render and GitHub…</p></section>;
  if (state.status === "error") return <section className="card gh-panel"><h2 className="gh-panel__title">Project health</h2><p className="field__note">{state.message}</p><div className="gh-panel__row"><button type="button" className="btn btn--ghost btn--sm" onClick={() => void load(true)}><Refresh size={13} /> Retry</button></div></section>;

  const s = state.data;
  if (!s) return null;
  const { health, service, deploy, live, drift, ci } = s;
  const needsInfo = !s.linked && !s.github;

  return (
    <section className="card gh-panel" aria-label="Project health">
      <header className="gh-panel__head">
        <div>
          <h2 className="gh-panel__title">Project health <span className={"badge " + (HEALTH_BADGE[health.level] || "badge--muted")}>{HEALTH_LABEL[health.level]}{health.score != null ? " · " + health.score : ""}</span></h2>
          <p className="field__note">Updated automatically from Render and GitHub{s.checkedAt ? " · checked " + ago(s.checkedAt) : ""}.</p>
        </div>
        <button type="button" className="btn btn--ghost btn--sm" disabled={state.refreshing} onClick={() => void load(true)}><Refresh size={13} /> {state.refreshing ? "Checking…" : "Recheck"}</button>
      </header>

      {health.reasons.length ? (
        <ul className="gh-reasons">{health.reasons.map((r, i) => <li key={i} className={"is-" + r.severity}>{r.text}</li>)}</ul>
      ) : null}

      {s.linked && service ? (
        <p className="field__note">
          {s.autoLinked ? "Linked automatically to " : "Linked to "}<strong>{service.name}</strong> ({service.accountName}){service.region ? " · " + service.region : ""}{service.plan ? " · " + service.plan : ""}
          {safe(service.dashboardUrl) ? <> · <a href={service.dashboardUrl} target="_blank" rel="noreferrer noopener">Open in Render</a></> : null}. Environment variables sync automatically.
        </p>
      ) : s.ambiguous ? (
        <p className="field__note">{s.ambiguous} Render services use this project’s repository, so it wasn’t linked automatically. Set the project’s <em>Hosting service name</em> to the right one (or pick it below) and it will link itself.</p>
      ) : s.linked ? (
        <p className="field__note">The linked Render service was not found in your connected accounts.</p>
      ) : needsInfo ? (
        <p className="field__note">Add a GitHub <em>Repo URL</em> (or a <em>Hosting service name</em> that matches a Render service) and this project links itself — nothing to click.</p>
      ) : (
        <p className="field__note">No Render service uses this repository yet.</p>
      )}

      <div className="vault-card__badges">
        {ci ? <a className={"badge " + (CI_BADGE[ci.state] || "badge--muted")} href={safe(ci.url) || undefined} target="_blank" rel="noreferrer noopener" title={ci.name + " on " + (ci.branch || "branch")}>{CI_LABEL[ci.state]}</a> : null}
        {deploy ? <span className={"badge " + (/failed/.test(deploy.status) ? "badge--danger" : deploy.status === "live" ? "badge--ok" : "badge--muted")}>Deploy: {deploy.status.replace(/_/g, " ")} · {ago(deploy.at)}</span> : null}
        {live?.sha ? <span className="badge badge--muted">Live {live.sha}</span> : null}
        {drift ? <span className={"badge " + (drift.behindBy > 0 ? "badge--warn" : "badge--ok")}>{drift.behindBy > 0 ? drift.behindBy + " not deployed yet" : drift.status === "behind" ? "Deployed ahead of " + drift.branch : "Up to date with " + drift.branch}</span> : null}
        {s.github?.error ? <span className="badge badge--muted" title={s.github.error}>GitHub: {s.github.error}</span> : null}
        {s.github && s.github.connected === false ? <span className="badge badge--muted">Connect GitHub for CI and drift</span> : null}
      </div>

      {drift?.behindBy > 0 && drift.commits?.length ? (
        <div>
          <h3 className="gh-panel__sub">Waiting to be deployed ({drift.branch})</h3>
          <ul className="gh-list">{drift.commits.map((c) => (
            <li key={c.sha}><code>{safe(c.url) ? <a href={c.url} target="_blank" rel="noreferrer noopener">{c.sha}</a> : c.sha}</code><span>{c.message || "(no message)"}</span><small>{ago(c.at)}</small></li>
          ))}</ul>
        </div>
      ) : null}

      {s.partial?.length ? <p className="field__note">Some data was unavailable: {s.partial.join(", ")}. The score uses what could be read.</p> : null}
    </section>
  );
}
