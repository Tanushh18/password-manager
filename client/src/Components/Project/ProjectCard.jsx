import React from "react";
import { Globe, Folder, Pencil } from "../Icons/Icons";
import { STATUS_LABEL } from "../../lib/projectItems";

const STATUS_BADGE = {
  planning: "badge--muted",
  in_progress: "badge--warn",
  deployed: "badge--ok",
  broken: "badge--danger",
  paused: "badge--muted",
  archived: "badge--muted",
};

export default function ProjectCard({ project, onEdit, style }) {
  const dbSummary = (project.databases || []).map((d) => d.provider || d.type).filter(Boolean).join(", ");

  return (
    <div className="card card--hover vault-card" style={style}>
      <div className="vault-card__head">
        <span className="avatar" style={{ width: 44, height: 44, background: "linear-gradient(140deg, var(--accent), var(--heading-2))" }}>
          <Globe size={20} />
        </span>
        <div className="vault-card__id">
          <div className="vault-card__name">{project.name || "Untitled project"}</div>
          <div className="vault-card__email">{project.hostingProvider || project.category || " "}</div>
        </div>
        <button type="button" className="icon-btn icon-btn--quiet vault-card__edit" onClick={onEdit} aria-label="Edit project">
          <Pencil size={17} />
        </button>
      </div>

      <div className="vault-card__badges">
        <span className={`badge ${STATUS_BADGE[project.status] || "badge--muted"}`}>{STATUS_LABEL[project.status] || project.status}</span>
        {project.hostingAccountEmail ? <span className="badge badge--cool">{project.hostingAccountEmail}</span> : null}
      </div>

      {project.description ? <p className="field__note" style={{ margin: "0.6rem 0 0" }}>{project.description}</p> : null}

      <div className="vault-card__body" style={{ marginTop: "0.6rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
        {dbSummary ? (
          <div className="vault-card__folder">
            <Folder size={13} /> <span className="field__note" style={{ margin: 0 }}>{dbSummary}</span>
          </div>
        ) : null}
        {project.liveUrl ? (
          <a href={/^https?:\/\//i.test(project.liveUrl) ? project.liveUrl : `https://${project.liveUrl}`} target="_blank" rel="noreferrer" className="vault-card__email">
            {project.liveUrl}
          </a>
        ) : null}
      </div>
    </div>
  );
}
