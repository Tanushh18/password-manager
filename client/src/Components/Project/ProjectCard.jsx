import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Globe, Pencil, Arrow } from "../Icons/Icons";
import { STATUS_LABEL } from "../../lib/projectItems";
import { flattenProject } from "../../lib/projectTree";
import ProjectTree from "./ProjectTree";

export const STATUS_BADGE = {
  planning: "badge--muted",
  in_progress: "badge--warn",
  deployed: "badge--ok",
  broken: "badge--danger",
  paused: "badge--muted",
  archived: "badge--muted",
};

export default function ProjectCard({ project, style }) {
  const [open, setOpen] = useState(false);
  const fields = flattenProject(project).length;
  const envCount = (project.envVars || []).length;
  const dbCount = (project.databases || []).length;

  return (
    <article className="card vault-card proj-card" style={style}>
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
        {dbCount ? <span className="badge badge--muted">{dbCount} database{dbCount === 1 ? "" : "s"}</span> : null}
        {envCount ? <span className="badge badge--muted">{envCount} env var{envCount === 1 ? "" : "s"}</span> : null}
      </div>

      {project.description ? <p className="proj-card__desc">{project.description}</p> : null}

      <div className="proj-card__foot">
        <button type="button" className="proj-card__toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "Hide structure" : `Show structure · ${fields} field${fields === 1 ? "" : "s"}`}
        </button>
        <Link to={`/projects/${project.id}`} className="proj-card__open">
          Open <Arrow size={13} />
        </Link>
      </div>

      {open ? <ProjectTree project={project} compact /> : null}
    </article>
  );
}
