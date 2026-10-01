import React from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import ProjectEditor from "../../Components/Project/ProjectEditor";
import { Arrow } from "../../Components/Icons/Icons";
import { useVault } from "../../state/vault";
import "../Passwords/Passwords.css";
import "./Projects.css";

/** Add (/projects/new) or edit (/projects/:id/edit) a project on its own page. */
export default function ProjectForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { projects, addProject, updateProject, deleteProject } = useVault();
  const project = id ? projects.find((p) => String(p.id) === id) : null;
  if (id && !project) return <Navigate to="/projects" replace />;

  const back = id ? `/projects/${id}` : "/projects";

  const save = async (form) => {
    if (project) {
      await updateProject(project.id, form);
      toast.success("Updated and re-encrypted.");
    } else {
      await addProject(form);
      toast.success("Encrypted and saved.");
    }
  };

  return (
    <div className="vault page">
      <div className="shell proj-shell">
        <Link to={back} className="proj-back">
          <Arrow size={14} style={{ transform: "rotate(180deg)" }} /> {project ? project.name : "All projects"}
        </Link>
        <ProjectEditor
          asPage
          open
          project={project}
          onClose={() => navigate(back)}
          onSave={save}
          onDelete={async () => {
            await deleteProject(project.id);
            toast.success("Deleted.");
            navigate("/projects", { replace: true });
          }}
        />
      </div>
    </div>
  );
}
