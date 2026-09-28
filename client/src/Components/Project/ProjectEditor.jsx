import React, { useEffect, useState } from "react";
import { Modal } from "react-responsive-modal";
import "react-responsive-modal/styles.css";
import { toast } from "react-toastify";
import Field from "../Field/Field";
import { emptyProject, emptyDatabase, emptyEnvVar, emptyExtraField } from "../../lib/projectItems";
import { Globe, Trash, Check, Plus } from "../Icons/Icons";

const text = (id, label, key, form, setForm, extra = {}) => (
  <Field id={id} label={label} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} {...extra} />
);

function RepeatRow({ children, onRemove }) {
  return (
    <div className="proj-repeat-row">
      <div className="proj-repeat-row__fields">{children}</div>
      <button type="button" className="icon-btn icon-btn--quiet" onClick={onRemove} aria-label="Remove">
        <Trash size={15} />
      </button>
    </div>
  );
}

/** Create or edit a project. `project` null = new. */
export default function ProjectEditor({ open, project, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(emptyProject());
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(project ? { ...emptyProject(), ...project } : emptyProject());
      setConfirmDelete(false);
    }
  }, [open, project]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const updateRow = (list, i, patch) => list.map((row, idx) => (idx === i ? { ...row, ...patch } : row));

  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Give it a name.");
    try {
      setSaving(true);
      await onSave(form);
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.error || err.message || "Couldn't save that.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirmDelete) return setConfirmDelete(true);
    try {
      setSaving(true);
      await onDelete();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.error || "Couldn't delete that.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} center classNames={{ modal: "sheet sheet--wide proj-sheet" }}>
      <form className="sheet__body editor" onSubmit={save}>
        <span className="card__ribbon" />
        <div className="editor__head">
          <span className="avatar" style={{ width: 52, height: 52, background: "linear-gradient(140deg, var(--accent), var(--heading-2))" }}>
            <Globe size={22} />
          </span>
          <div>
            <h2 className="sheet__title">{project ? "Edit project" : "New project"}</h2>
            <p className="sheet__sub">Encrypted on this device with AES-256-GCM before it's saved — same as your passwords.</p>
          </div>
        </div>

        <div className="proj-section">
          <h3 className="proj-section__title">Basics</h3>
          <div className="editor__grid">
            {text("pr-name", "Name *", "name", form, setForm, { autoFocus: true })}
            <div className="field">
              <label className="field__label" htmlFor="pr-status">Status</label>
              <select id="pr-status" className="input" value={form.status} onChange={set("status")}>
                <option value="planning">Planning</option>
                <option value="in_progress">In progress</option>
                <option value="deployed">Deployed</option>
                <option value="broken">Broken</option>
                <option value="paused">Paused</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="pr-priority">Priority</label>
              <select id="pr-priority" className="input" value={form.priority} onChange={set("priority")}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            {text("pr-category", "Category", "category", form, setForm, { placeholder: "web app, bot, API…" })}
            {text("pr-tech", "Tech stack", "techStack", form, setForm, { placeholder: "React, Node, MongoDB…" })}
            {text("pr-tags", "Tags", "tags", form, setForm, { placeholder: "comma, separated" })}
          </div>
          <div className="field">
            <label className="field__label" htmlFor="pr-desc">Description</label>
            <textarea id="pr-desc" className="input textarea" rows={2} value={form.description} onChange={set("description")} />
          </div>
        </div>

        <div className="proj-section">
          <h3 className="proj-section__title">Repo &amp; live URL</h3>
          <div className="editor__grid">
            {text("pr-repo", "Repo URL", "repoUrl", form, setForm)}
            {text("pr-repo-acc", "Repo account", "repoAccount", form, setForm)}
            {text("pr-live", "Live URL", "liveUrl", form, setForm)}
            {text("pr-domain", "Custom domain", "customDomain", form, setForm)}
          </div>
        </div>

        <div className="proj-section">
          <h3 className="proj-section__title">Hosting</h3>
          <div className="editor__grid">
            {text("pr-host", "Provider", "hostingProvider", form, setForm, { placeholder: "Render, Vercel…" })}
            {text("pr-host-email", "Account email", "hostingAccountEmail", form, setForm)}
            {text("pr-host-label", "Account label", "hostingAccountLabel", form, setForm, { placeholder: "personal, work…" })}
            {text("pr-host-service", "Service name", "hostingServiceName", form, setForm)}
            {text("pr-host-plan", "Plan", "hostingPlan", form, setForm)}
            {text("pr-host-region", "Region", "hostingRegion", form, setForm)}
            {text("pr-host-branch", "Auto-deploy branch", "autoDeployBranch", form, setForm, { placeholder: "main" })}
            {text("pr-deployed", "Last deployed", "lastDeployedAt", form, setForm, { type: "date" })}
          </div>
        </div>

        <div className="proj-section">
          <h3 className="proj-section__title">Databases</h3>
          {(form.databases || []).map((row, i) => (
            <RepeatRow key={i} onRemove={() => setForm((f) => ({ ...f, databases: f.databases.filter((_, idx) => idx !== i) }))}>
              <input className="input" placeholder="Label" value={row.label} onChange={(e) => setForm((f) => ({ ...f, databases: updateRow(f.databases, i, { label: e.target.value }) }))} />
              <input className="input" placeholder="Provider" value={row.provider} onChange={(e) => setForm((f) => ({ ...f, databases: updateRow(f.databases, i, { provider: e.target.value }) }))} />
              <input className="input" placeholder="Type" value={row.type} onChange={(e) => setForm((f) => ({ ...f, databases: updateRow(f.databases, i, { type: e.target.value }) }))} />
              <input className="input" placeholder="Account email" value={row.accountEmail} onChange={(e) => setForm((f) => ({ ...f, databases: updateRow(f.databases, i, { accountEmail: e.target.value }) }))} />
              <input className="input" placeholder="Notes" value={row.notes} onChange={(e) => setForm((f) => ({ ...f, databases: updateRow(f.databases, i, { notes: e.target.value }) }))} />
            </RepeatRow>
          ))}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setForm((f) => ({ ...f, databases: [...f.databases, emptyDatabase()] }))}>
            <Plus size={14} /> Add database
          </button>
        </div>

        <div className="proj-section">
          <h3 className="proj-section__title">Firebase / Google Cloud</h3>
          <div className="editor__grid">
            {text("pr-fb-id", "Firebase project ID", "firebaseProjectId", form, setForm)}
            {text("pr-fb-email", "Firebase account email", "firebaseAccountEmail", form, setForm)}
            {text("pr-gcp-id", "Google Cloud project ID", "googleCloudProjectId", form, setForm)}
            {text("pr-gcp-email", "Google Cloud account email", "googleCloudAccountEmail", form, setForm)}
          </div>
        </div>

        <div className="proj-section">
          <h3 className="proj-section__title">Play Store</h3>
          <div className="editor__grid">
            {text("pr-ps-pkg", "Package name", "playStorePackageName", form, setForm)}
            {text("pr-ps-email", "Play Console account email", "playStoreAccountEmail", form, setForm)}
            {text("pr-ps-url", "Play Store URL", "playStoreUrl", form, setForm)}
            {text("pr-ps-status", "Status", "playStoreStatus", form, setForm, { placeholder: "internal testing, live…" })}
          </div>
        </div>

        <div className="proj-section">
          <h3 className="proj-section__title">DNS &amp; monitoring</h3>
          <div className="editor__grid">
            {text("pr-dns", "DNS provider", "dnsProvider", form, setForm)}
            {text("pr-dns-email", "DNS account email", "dnsAccountEmail", form, setForm)}
            {text("pr-mon", "Monitoring provider", "monitoringProvider", form, setForm)}
            {text("pr-mon-email", "Monitoring account email", "monitoringAccountEmail", form, setForm)}
          </div>
        </div>

        <div className="proj-section">
          <h3 className="proj-section__title">Environment variables &amp; secrets</h3>
          <p className="field__note" style={{ marginTop: "-0.3rem", marginBottom: "0.7rem" }}>
            Real values are welcome here — a Mongo URI, a Cloudinary key, whatever. This whole project entry is encrypted the same way as a password.
          </p>
          {(form.envVars || []).map((row, i) => (
            <RepeatRow key={i} onRemove={() => setForm((f) => ({ ...f, envVars: f.envVars.filter((_, idx) => idx !== i) }))}>
              <input className="input" placeholder="Variable name (e.g. MONGO_URI)" value={row.name} onChange={(e) => setForm((f) => ({ ...f, envVars: updateRow(f.envVars, i, { name: e.target.value }) }))} />
              <input className="input" placeholder="Value" value={row.value} onChange={(e) => setForm((f) => ({ ...f, envVars: updateRow(f.envVars, i, { value: e.target.value }) }))} />
              <input className="input" placeholder="Purpose / service" value={row.purpose} onChange={(e) => setForm((f) => ({ ...f, envVars: updateRow(f.envVars, i, { purpose: e.target.value }) }))} />
            </RepeatRow>
          ))}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setForm((f) => ({ ...f, envVars: [...f.envVars, emptyEnvVar()] }))}>
            <Plus size={14} /> Add variable
          </button>
        </div>

        <div className="proj-section">
          <h3 className="proj-section__title">Custom fields</h3>
          {(form.extraFields || []).map((row, i) => (
            <RepeatRow key={i} onRemove={() => setForm((f) => ({ ...f, extraFields: f.extraFields.filter((_, idx) => idx !== i) }))}>
              <input className="input" placeholder="Label" value={row.label} onChange={(e) => setForm((f) => ({ ...f, extraFields: updateRow(f.extraFields, i, { label: e.target.value }) }))} />
              <input className="input" placeholder="Value" value={row.value} onChange={(e) => setForm((f) => ({ ...f, extraFields: updateRow(f.extraFields, i, { value: e.target.value }) }))} />
            </RepeatRow>
          ))}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setForm((f) => ({ ...f, extraFields: [...f.extraFields, emptyExtraField()] }))}>
            <Plus size={14} /> Add custom field
          </button>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="pr-notes">Notes</label>
          <textarea id="pr-notes" className="input textarea" rows={3} value={form.notes} onChange={set("notes")} />
        </div>

        <div className="editor__actions">
          {project ? (
            <button type="button" className={`btn btn--sm ${confirmDelete ? "btn--danger" : "btn--quiet"}`} onClick={remove} disabled={saving}>
              <Trash size={14} /> {confirmDelete ? "Tap again to delete" : "Delete"}
            </button>
          ) : <span />}
          <div className="editor__right">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              <span className="btn__sheen" />
              {saving ? <span className="spinner" /> : <Check size={15} />}
              {project ? "Save changes" : "Save project"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
