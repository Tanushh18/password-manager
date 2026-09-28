import React, { useMemo, useState } from "react";
import { toast } from "react-toastify";
import Ambience from "../../Components/Ambience/Ambience";
import Reveal from "../../Components/Reveal/Reveal";
import ProjectCard from "../../Components/Project/ProjectCard";
import ProjectEditor from "../../Components/Project/ProjectEditor";
import { ShieldLine, Globe, Plus, Search, Grid, Alert } from "../../Components/Icons/Icons";
import { useVault } from "../../state/vault";
import { STATUS_LABEL } from "../../lib/projectItems";
import "../Passwords/Passwords.css";
import "./Projects.css";

const STATUSES = ["planning", "in_progress", "deployed", "broken", "paused", "archived"];

export default function Projects() {
  const { profile, projects, projectsBroken, addProject, updateProject, deleteProject } = useVault();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("__all");
  const [editing, setEditing] = useState(null); // null | "new" | project

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return projects
      .filter((p) => status === "__all" || p.status === status)
      .filter((p) => {
        if (!term) return true;
        const haystack = [
          p.name, p.description, p.tags, p.category, p.techStack,
          p.hostingProvider, p.hostingAccountEmail, p.liveUrl,
          ...(p.databases || []).map((d) => `${d.provider} ${d.type} ${d.accountEmail}`),
        ].join(" ").toLowerCase();
        return haystack.includes(term);
      })
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
  }, [projects, search, status]);

  const saveProject = async (form) => {
    if (editing === "new") {
      await addProject(form);
      toast.success("Encrypted and saved ✨");
    } else {
      await updateProject(editing.id, form);
      toast.success("Updated and re-encrypted.");
    }
  };

  const firstName = (profile?.name || "").split(" ")[0];

  return (
    <div className="vault page">
      <Ambience petals={false} />

      <div className="shell">
        <header className="vault__head anim-fade-up">
          <span className="pill vault__pill">
            <ShieldLine size={13} />
            End-to-end encrypted
          </span>
          <h1 className="vault__title">
            Every project, <em className="serif-em">{firstName || "friend"}</em>
          </h1>
          <p className="vault__count">
            {projects.length === 0
              ? "No projects yet — add the first one."
              : `${projects.length} project${projects.length === 1 ? "" : "s"}, readable only on your devices`}
          </p>
        </header>

        {projectsBroken ? (
          <div className="notice notice--err vault__notice">
            <Alert size={15} /> {projectsBroken} project{projectsBroken === 1 ? "" : "s"} couldn't be decrypted with this key and {projectsBroken === 1 ? "is" : "are"} hidden.
          </div>
        ) : null}

        <div className="vault__tools anim-fade-up d-2">
          <div className="vault__search field__wrap">
            <span className="vault__search-icon"><Search size={17} /></span>
            <input
              className="input vault__search-input"
              type="search"
              placeholder="Search name, hosting, database, tags…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search your projects"
            />
          </div>
          <div className="vault__actions">
            <button className="btn btn--primary" onClick={() => setEditing("new")}>
              <span className="btn__sheen" />
              <Plus size={15} /> New project
            </button>
          </div>
        </div>

        <nav className="folders anim-fade-up d-3" aria-label="Status filters">
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

        {projects.length === 0 ? (
          <Reveal className="empty card" variant="reveal--scale">
            <span className="card__ribbon" />
            <span className="empty__icon"><Globe size={28} /></span>
            <h2 className="empty__title">Nothing tracked yet</h2>
            <p className="empty__body">Add a project — its hosting, database, accounts and env vars, all encrypted the same way as your passwords.</p>
            <div className="empty__actions">
              <button className="btn btn--primary btn--lg" onClick={() => setEditing("new")}>
                <span className="btn__sheen" /> Add your first project
              </button>
            </div>
          </Reveal>
        ) : visible.length === 0 ? (
          <Reveal className="empty empty--slim card">
            <span className="empty__icon"><Search size={24} /></span>
            <h2 className="empty__title">{search ? <>Nothing matches “{search}”</> : "Nothing here"}</h2>
            <button className="btn btn--ghost" onClick={() => { setSearch(""); setStatus("__all"); }}>
              Show everything
            </button>
          </Reveal>
        ) : (
          <div className="vault__grid">
            {visible.map((project, i) => (
              <ProjectCard
                key={project.id}
                project={project}
                onEdit={() => setEditing(project)}
                style={{ animationDelay: `${Math.min(i, 10) * 0.04}s` }}
              />
            ))}
          </div>
        )}
      </div>

      <ProjectEditor
        open={Boolean(editing)}
        project={editing && editing !== "new" ? editing : null}
        onClose={() => setEditing(null)}
        onSave={saveProject}
        onDelete={async () => {
          await deleteProject(editing.id);
          toast.success("Deleted.");
        }}
      />
    </div>
  );
}
