import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Globe, Pencil, Arrow, External } from "../Icons/Icons";
import { STATUS_LABEL } from "../../lib/projectItems";
import { flattenProject } from "../../lib/projectTree";
import ProjectTree from "./ProjectTree";
import { HealthBadge } from "./ProjectStatus";

export const STATUS_BADGE = {
  planning: "badge--muted",
  in_progress: "badge--warn",
  deployed: "badge--ok",
  broken: "badge--danger",
  paused: "badge--muted",
  archived: "badge--muted",
};

const SOURCE = { github: ["GitHub", "synced from your GitHub token"], render: ["Render", "found on your Render account"] };

export default function ProjectCard({ project, style, status }) {
  const [open, setOpen] = useState(false);
  const [showServers, setShowServers] = useState(false);
  const servers = Array.isArray(project.renderServices) ? project.renderServices : [];
  const [sourceLabel, sourceHint] = SOURCE[project.autoSource] || ["Manual", "added by you"];
  const fields = flattenProject(project).length;
  const envCount = (project.envVars || []).length;
  const dbCount = (project.databases || []).length;

  return (
    <article className={"card vault-card proj-card pv2-card" + (project.status === "archived" ? " is-archived" : "")} style={style}>
      <div className="vault-card__head">
        <span className="avatar" style={{ width: 40, height: 40, background: "var(--accent)" }}>
          <Globe size={18} />
        </span>
        <div className="vault-card__id">
          <Link to={`/projects/${project.id}`} className="vault-card__name proj-card__name">{project.name || "Untitled project"}</Link>
          <div className="vault-card__email">{[project.hostingProvider, project.category].filter(Boolean).join(" · ") || " "}</div>
        </div>
        <Link to={`/projects/${project.id}/edit`} className="icon-btn icon-btn--quiet" aria-label="Edit project">
          <Pencil size={16} />
        </Link>
      </div>

      <div className="vault-card__badges">
        <span className={`badge ${STATUS_BADGE[project.status] || "badge--muted"}`}>{STATUS_LABEL[project.status] || project.status}</span>
        <span className={"badge pv2-src pv2-src--" + (project.autoSource || "manual")} title={"Source: " + sourceHint}>{sourceLabel}</span>
        {servers.length > 1 ? <button type="button" className="badge badge--ok pv2-servers" aria-expanded={showServers} onClick={() => setShowServers((v) => !v)} title="Render servers deployed from this repo">{servers.length} servers {showServers ? "▴" : "▾"}</button> : null}
        <HealthBadge status={status} />
        {status?.drift?.behindBy > 0 ? <span className="badge badge--warn" title="Commits on the branch that are not deployed yet">{status.drift.behindBy} undeployed</span> : null}
        {dbCount ? <span className="badge badge--muted">{dbCount} database{dbCount === 1 ? "" : "s"}</span> : null}
        {envCount ? <span className="badge badge--muted">{envCount} env var{envCount === 1 ? "" : "s"}</span> : null}
      </div>

      {project.description ? <p className="proj-card__desc">{project.description}</p> : null}

      {showServers ? (
        <ul className="pv2-serverlist" aria-label="Render servers">
          {servers.map((sv) => (
            <li key={sv.serviceId}>
              <span className={"pv2-dot" + (sv.suspended ? "" : " is-main")} aria-hidden="true" title={sv.suspended ? "Suspended" : "Running"} />
              <span className="pv2-serverlist__name">{sv.name || sv.serviceId}{sv.url ? <a className="pv2-serverlist__url" href={sv.url} target="_blank" rel="noopener noreferrer">{sv.url.replace(/^https:\/\//, "")}</a> : null}</span>
              {sv.serviceId === project.renderServiceId ? <em>main</em> : null}
              <a href={"https://dashboard.render.com/web/" + encodeURIComponent(sv.serviceId)} target="_blank" rel="noopener noreferrer" aria-label={"Open " + (sv.name || sv.serviceId) + " in Render"}><External size={13} /></a>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="proj-card__foot">
        <button type="button" className="proj-card__toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "Hide structure" : `Show structure · ${fields} field${fields === 1 ? "" : "s"}`}
        </button>
        <span className="pv2-links">
          {/^https?:\/\//i.test(project.repoUrl || "") ? <a href={project.repoUrl} target="_blank" rel="noopener noreferrer" className="proj-card__open" title="Open the GitHub repository">Repo <External size={12} /></a> : null}
          <Link to={`/projects/${project.id}`} className="proj-card__open">
            Open <Arrow size={13} />
          </Link>
        </span>
      </div>

      {open ? <ProjectTree project={project} compact /> : null}
    </article>
  );
}
