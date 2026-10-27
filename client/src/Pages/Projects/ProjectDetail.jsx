import React, { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import ProjectTree from "../../Components/Project/ProjectTree";
import ProjectOverview from "../../Components/Project/ProjectOverview";
import RenderEnvSync from "../../Components/Project/RenderEnvSync";
import ProjectDeployments from "../../Components/Project/ProjectDeployments";
import BranchTree from "../../Components/Project/BranchTree";
import ServerUrls from "../../Components/Project/ServerUrls";
import GithubConnectModal from "../../Components/Project/GithubConnectModal";
import { STATUS_BADGE } from "../../Components/Project/ProjectCard";
import { Arrow, Globe, Pencil, Refresh } from "../../Components/Icons/Icons";
import { STATUS_LABEL } from "../../lib/projectItems";
import { useVault } from "../../state/vault";
import "../Passwords/Passwords.css";
import "./Projects.css";

const TABS = [["overview", "Overview"], ["servers", "Servers"], ["deploys", "Deploys"], ["details", "Details"]];
const tabFromHash = () => { const h = (typeof window !== "undefined" ? window.location.hash : "").replace("#", ""); return TABS.some(([id]) => id === h) ? h : "overview"; };

/** Full page for one project: its health and code, its servers, its deployments, and the saved details, in tabs. */
export default function ProjectDetail() {
  const { id } = useParams();
  const { projects } = useVault();
  const [githubOpen, setGithubOpen] = useState(false);
  const [githubKey, setGithubKey] = useState(0);
  const [refreshAll, setRefreshAll] = useState(0); // one button re-checks health, GitHub, branches and deployments
  const [tab, setTab] = useState(tabFromHash);
  const project = projects.find((p) => String(p.id) === id);
  useEffect(() => { try { window.history.replaceState(null, "", "#" + tab); } catch { /* ignore */ } }, [tab]);
  if (!project) return <Navigate to="/projects" replace />;

  const hasDeploys = project.renderServiceId || (project.renderServices || []).length || (project.hostLinks || []).length || project.repoUrl;

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
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRefreshAll((n) => n + 1)} title="Re-check health, GitHub, branches and deployments"><Refresh size={13} /> Refresh all</button>
          <Link to={`/projects/${project.id}/edit`} className="btn btn--primary btn--sm">
            <Pencil size={14} /> Edit
          </Link>
        </header>

        {project.description ? <p className="proj-detail__desc">{project.description}</p> : null}

        <div className="proj-tabs" role="tablist" aria-label="Project sections">
          {TABS.filter(([id2]) => id2 !== "deploys" || hasDeploys).map(([id2, label]) => (
            <button key={id2} type="button" role="tab" aria-selected={tab === id2} onClick={() => setTab(id2)}>{label}</button>
          ))}
        </div>

        {tab === "overview" ? (
          <div className="proj-pane" role="tabpanel">
            <ProjectOverview project={project} refreshKey={githubKey + refreshAll} onConnect={() => setGithubOpen(true)} />
          </div>
        ) : null}

        {tab === "servers" ? (
          <div className="proj-pane" role="tabpanel">
            <ServerUrls project={project} />
          </div>
        ) : null}

        {tab === "deploys" && hasDeploys ? (
          <div className="proj-pane" role="tabpanel">
            <ProjectDeployments project={project} refreshKey={refreshAll} hideRefresh />
            {project.repoUrl ? <BranchTree key={"b" + project.id} project={project} refreshKey={refreshAll} hideRefresh /> : null}
          </div>
        ) : null}

        {tab === "details" ? (
          <div className="proj-pane" role="tabpanel">
            <section className="card proj-detail__tree">
              <ProjectTree key={project.id} project={project} />
            </section>
            <details className="card proj-optional">
              <summary className="proj-section__title">Stashr ⇄ Render variables <small>(pull or push the saved variables of a Render service)</small></summary>
              <RenderEnvSync project={project} />
            </details>
          </div>
        ) : null}
      </div>
      <GithubConnectModal open={githubOpen} onClose={() => setGithubOpen(false)} onChange={() => setGithubKey((k) => k + 1)} />
    </div>
  );
}
