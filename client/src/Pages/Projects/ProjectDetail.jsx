import React, { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import ProjectTree from "../../Components/Project/ProjectTree";
import GithubPanel from "../../Components/Project/GithubPanel";
import ProjectStatus from "../../Components/Project/ProjectStatus";
import RenderEnvSync from "../../Components/Project/RenderEnvSync";
import ProjectDeployments from "../../Components/Project/ProjectDeployments";
import BranchTree from "../../Components/Project/BranchTree";
import HostLinks from "../../Components/Project/HostLinks";
import GithubConnectModal from "../../Components/Project/GithubConnectModal";
import { STATUS_BADGE } from "../../Components/Project/ProjectCard";
import { Arrow, Globe, Pencil } from "../../Components/Icons/Icons";
import { STATUS_LABEL } from "../../lib/projectItems";
import { useVault } from "../../state/vault";
import "../Passwords/Passwords.css";
import "./Projects.css";

/** Full page for one project: its whole structure, expanded. */
export default function ProjectDetail() {
  const { id } = useParams();
  const { projects } = useVault();
  const [githubOpen, setGithubOpen] = useState(false);
  const [githubKey, setGithubKey] = useState(0);
  const project = projects.find((p) => String(p.id) === id);
  if (!project) return <Navigate to="/projects" replace />;

  return (
    <div className="vault page">
      <div className="shell proj-shell">
        <Link to="/projects" className="proj-back">
          <Arrow size={14} style={{ transform: "rotate(180deg)" }} /> All projects
        </Link>

        <header className="proj-detail__head">
          <span className="avatar" style={{ width: 48, height: 48, background: "var(--accent)" }}>
            <Globe size={22} />
          </span>
          <div className="proj-detail__id">
            <h1 className="vault__title">{project.name}</h1>
            <div className="vault-card__badges">
              <span className={`badge ${STATUS_BADGE[project.status] || "badge--muted"}`}>{STATUS_LABEL[project.status] || project.status}</span>
              {project.hostingProvider ? <span className="badge badge--muted">{project.hostingProvider}</span> : null}
            </div>
          </div>
          <Link to={`/projects/${project.id}/edit`} className="btn btn--primary btn--sm">
            <Pencil size={14} /> Edit
          </Link>
        </header>

        {project.description ? <p className="proj-detail__desc">{project.description}</p> : null}

        <ProjectStatus project={project} />

        {project.repoUrl ? <GithubPanel repoUrl={project.repoUrl} refreshKey={githubKey} onConnect={() => setGithubOpen(true)} /> : null}

        {project.repoUrl ? <BranchTree key={"b" + project.id} project={project} /> : null}

        {project.renderServiceId || (project.renderServices || []).length ? <ProjectDeployments project={project} /> : null}

        <HostLinks project={project} />

        <RenderEnvSync project={project} />

        <section className="card proj-detail__tree">
          <ProjectTree key={project.id} project={project} expanded />
        </section>
      </div>
      <GithubConnectModal open={githubOpen} onClose={() => setGithubOpen(false)} onChange={() => setGithubKey((k) => k + 1)} />
    </div>
  );
}
