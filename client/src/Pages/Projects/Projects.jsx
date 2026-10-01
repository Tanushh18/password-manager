import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import useShortcuts from "../../hooks/useShortcuts";
import Reveal from "../../Components/Reveal/Reveal";
import ProjectCard from "../../Components/Project/ProjectCard";
import ProjectImportModal from "../../Components/Project/ProjectImportModal";
import { TreeLeaf } from "../../Components/Project/ProjectTree";
import { Globe, Plus, Search, Grid, Alert, Upload } from "../../Components/Icons/Icons";
import { useVault } from "../../state/vault";
import { STATUS_LABEL } from "../../lib/projectItems";
import { searchProjects } from "../../lib/projectTree";
import "../Passwords/Passwords.css";
import "../../Components/Project/ProjectTree.css";
import "./Projects.css";

const STATUSES = ["planning", "in_progress", "deployed", "broken", "paused", "archived"];

export default function Projects() {
  const { projects, projectsBroken, importProjects, prefs } = useVault();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("__all");
  const [view, setView] = useState("all"); // all | values | projects (while searching)
  const [importing, setImporting] = useState(false);
  const navigate = useNavigate();
  const searchRef = useShortcuts(() => navigate("/projects/new"));

  const byStatus = useMemo(() => projects.filter((p) => status === "__all" || p.status === status), [projects, status]);

  const results = useMemo(() => {
    const r = searchProjects(byStatus, search);
    const recent = (a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
    return { projects: [...r.projects].sort(recent), values: r.values };
  }, [byStatus, search]);

  const searching = search.trim().length > 0;
  const showValues = searching && view !== "projects" && results.values.length > 0;
  const showProjects = !searching || view !== "values";
  const visible = results.projects;

  return (
    <div className="vault page">
      <div className="shell">
        <header className="vault__head">
          <div>
            <h1 className="vault__title">Projects</h1>
            <p className="vault__count">
              {projects.length === 0
                ? "No projects yet."
                : `${projects.length} project${projects.length === 1 ? "" : "s"} · end-to-end encrypted`}
            </p>
          </div>
        </header>

        {projectsBroken ? (
          <div className="notice notice--err vault__notice">
            <Alert size={15} /> {projectsBroken} project{projectsBroken === 1 ? "" : "s"} couldn't be decrypted with this key and {projectsBroken === 1 ? "is" : "are"} hidden.
          </div>
        ) : null}

        <div className="vault__tools">
          <div className="vault__search field__wrap">
            <span className="vault__search-icon"><Search size={17} /></span>
            <input
              className="input vault__search-input"
              type="search"
              ref={searchRef}
              placeholder="Search projects, variables (e.g. MONGO_URI), values…  ( / )"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search your projects and their variables"
            />
          </div>
          <div className="vault__actions">
            <Link className="btn btn--primary" to="/projects/new">
              <Plus size={15} /> New project <kbd className="kbd">N</kbd>
            </Link>
            <button className="btn btn--ghost" onClick={() => setImporting(true)}>
              <Upload size={15} /> Import
            </button>
          </div>
        </div>

        <nav className="folders" aria-label="Filters">
          {searching ? (
            <>
              <button type="button" className={`folder-chip ${view === "all" ? "is-active" : ""}`} onClick={() => setView("all")}>
                All results
              </button>
              <button type="button" className={`folder-chip ${view === "values" ? "is-active" : ""}`} onClick={() => setView("values")}>
                Values <span>{results.values.length}</span>
              </button>
              <button type="button" className={`folder-chip ${view === "projects" ? "is-active" : ""}`} onClick={() => setView("projects")}>
                Projects <span>{results.projects.length}</span>
              </button>
              <span className="folders__sep" />
            </>
          ) : null}
          <button type="button" className={`folder-chip ${status === "__all" ? "is-active" : ""}`} onClick={() => setStatus("__all")}>
            <Grid size={13} /> All <span>{projects.length}</span>
          </button>
          {STATUSES.map((s) => {
            const count = projects.filter((p) => p.status === s).length;
            if (!count) return null;
            return (
              <button key={s} type="button" className={`folder-chip ${status === s ? "is-active" : ""}`} onClick={() => setStatus(s)}>
                {STATUS_LABEL[s]} <span>{count}</span>
              </button>
            );
          })}
        </nav>

        {showValues ? (
          <section className="card proj-values" aria-label="Matching values">
            <h2 className="proj-values__title">Values matching “{search.trim()}”</h2>
            {results.values.slice(0, 50).map((hit, i) => (
              <div key={`${hit.project.id}-${i}`} className="proj-values__row">
                <Link to={`/projects/${hit.project.id}`} className="proj-values__project">{hit.project.name}</Link>
                <TreeLeaf node={hit.field} showPath={hit.field.path.join(" › ")} reveal={prefs.searchValues !== false} />
              </div>
            ))}
            {results.values.length > 50 ? <p className="field__note">Showing the first 50. Type more to narrow it down.</p> : null}
          </section>
        ) : null}

        {projects.length === 0 ? (
          <Reveal className="empty card" variant="reveal--scale">
            <span className="empty__icon"><Globe size={28} /></span>
            <h2 className="empty__title">Nothing tracked yet</h2>
            <p className="empty__body">Add a project with its hosting, database, accounts and env vars, all encrypted the same way as your passwords.</p>
            <div className="empty__actions">
              <Link className="btn btn--primary btn--lg" to="/projects/new">Add your first project</Link>
              <button className="btn btn--ghost btn--lg" onClick={() => setImporting(true)}>
                <Upload size={15} /> Import from Excel
              </button>
            </div>
          </Reveal>
        ) : searching && !visible.length && !results.values.length ? (
          <Reveal className="empty empty--slim card">
            <span className="empty__icon"><Search size={24} /></span>
            <h2 className="empty__title">Nothing matches “{search}”</h2>
            <button className="btn btn--ghost" onClick={() => { setSearch(""); setStatus("__all"); }}>
              Show everything
            </button>
          </Reveal>
        ) : showProjects && visible.length ? (
          <>
            {searching ? <h2 className="proj-values__title proj-list__title">Projects</h2> : null}
            <div className="vault__grid">
              {visible.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          </>
        ) : null}
      </div>

      <ProjectImportModal open={importing} onClose={() => setImporting(false)} onImport={importProjects} />
    </div>
  );
}
