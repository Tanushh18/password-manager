import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { getLiveDashboard, getUsageSettings, saveUsageSettings } from "../../api/client";
import { Skeleton, Empty } from "../Render/RenderUi";
import { errorMessage } from "../Render/renderUtils";
import { buildRows, applyChoice, sameMapping, slugify, choiceOf, CATEGORIES } from "./serviceMapUtils";
import "../Render/RenderDashboard.css";
import "./Services.css";
import "./ServiceMap.css";

const HOW = { name: "variable name", value: "value", code: "your code", user: "you" };

/** One select with every service Stashr knows, your own services, and "not a service". */
function ServicePicker({ value, onChange, catalog, custom, guess, disabled }) {
  const byCategory = useMemo(() => {
    const map = new Map();
    for (const c of catalog) { if (!map.has(c.category)) map.set(c.category, []); map.get(c.category).push(c); }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [catalog]);
  return (
    <select className="rd-field sm-pick" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label="Which service is this variable for">
      <option value="">{guess ? "Auto — " + guess : "Auto — not sure"}</option>
      <option value="ignore">✕ Not a service (ignore)</option>
      {Object.entries(custom).length > 0 && <optgroup label="Your own services">{Object.entries(custom).map(([slug, c]) => <option key={slug} value={"custom:" + slug}>{c.label}</option>)}</optgroup>}
      {byCategory.map(([cat, list]) => <optgroup key={cat} label={cat}>{list.map((c) => <option key={c.key} value={c.key}>{c.label}{c.liveUsageSupported ? " · usage ✓" : ""}</option>)}</optgroup>)}
    </select>
  );
}

function VarRow({ row, project, draft, setChoice, catalog, custom, byKey }) {
  const choice = choiceOf(draft, project.id, row.name);
  const key = choice?.key || "";
  const def = byKey.get(key);
  const roles = def?.roles || [];
  const shownOwner = key ? (key === "ignore" ? "Ignored" : def?.label || custom[key.replace("custom:", "")]?.label || key) : row.ownerLabel;
  return (
    <tr className={key ? "is-mine" : row.ownerKey || row.internal ? "" : "is-unknown"}>
      <td><code>{row.name}</code><small className="sv-sub">{row.kind === "secret" ? "secret · hidden" : row.kind === "url" ? row.display || "URL" : row.set ? row.display || "set" : "empty"}</small></td>
      <td>
        {row.ownerKey ? <><strong>{row.ownerLabel}</strong><small className="sv-sub">found by {HOW[row.via] || row.via || "variable name"}</small></> : row.internal ? <span className="sv-dim">App setting (not a service)</span> : <span className="sv-dim">Not sure</span>}
      </td>
      <td>
        <ServicePicker value={key} onChange={(v) => setChoice(row.name, v, choice)} catalog={catalog} custom={custom} guess={row.ownerKey ? row.ownerLabel : row.internal ? "app setting" : ""} />
        {key && key !== "ignore" && <small className="sv-sub">→ {shownOwner}{def && !def.liveUsageSupported ? " (no usage reader yet)" : ""}</small>}
      </td>
      <td>
        {roles.length > 0 && key ? (
          <div className="sm-role">
            <select className="rd-field" value={choice?.role || ""} onChange={(e) => setChoice(row.name, key, { ...choice, key, role: e.target.value })} aria-label="Which part of the credentials">
              <option value="">Part…</option>
              {roles.map(([r, label]) => <option key={r} value={r}>{label}</option>)}
            </select>
            {choice?.role && (
              <input className="rd-field sm-group" placeholder="account (optional)" maxLength={30} value={choice.group || ""} aria-label="Account name, when you have several accounts of this service"
                onChange={(e) => setChoice(row.name, key, { ...choice, key, group: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })} />
            )}
          </div>
        ) : <span className="sv-dim">—</span>}
      </td>
      <td>
        {key ? (
          <select className="rd-field" value={choice.scope} onChange={(e) => setChoice(row.name, key, { ...choice, scope: e.target.value })} aria-label="Where this applies">
            <option value="project">This project</option>
            <option value="all">All my projects</option>
          </select>
        ) : <span className="sv-dim">—</span>}
      </td>
    </tr>
  );
}

function ProjectCard({ project, draft, setChoice, catalog, custom, byKey, onlyUnsure, query }) {
  const [open, setOpen] = useState(true);
  const rows = useMemo(() => buildRows(project), [project]);
  const needle = query.trim().toLowerCase();
  const visible = rows.filter((r) => (!onlyUnsure || (!r.ownerKey && !r.internal) || choiceOf(draft, project.id, r.name)) && (!needle || (r.name + " " + r.ownerLabel).toLowerCase().includes(needle)));
  const unsure = rows.filter((r) => !r.ownerKey && !r.internal && !choiceOf(draft, project.id, r.name)).length;
  if (!visible.length) return null;
  return (
    <section className="sv-panel">
      <header className="sv-panel__head sm-head">
        <button type="button" className="sm-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "▾" : "▸"} <h2>{project.name}</h2></button>
        <span className="sv-dim">{rows.length} variables{unsure ? " · " + unsure + " not sure" : ""}</span>
      </header>
      {open && (
        <div className="sv-tablewrap">
          <table className="sv-table sm-table">
            <thead><tr><th>Variable</th><th>Stashr thinks</th><th>It is for…</th><th>Part</th><th>Applies to</th></tr></thead>
            <tbody>{visible.map((row) => <VarRow key={row.name} row={row} project={project} draft={draft} setChoice={setChoice} catalog={catalog} custom={custom} byKey={byKey} />)}</tbody>
          </table>
        </div>
      )}
      {open && project.services.some((s) => s.state === "no-credentials" || s.state === "in-code") && (
        <p className="rd-note">Still can’t read usage: {project.services.filter((s) => s.state === "no-credentials" || s.state === "in-code").map((s) => s.label).join(", ")}. Set which variable is the API key / secret (the “Part” column) and save.</p>
      )}
    </section>
  );
}

/** Page where you tell Stashr which of your variables belong to which service; usage is read from your choices. */
export default function ServiceMap() {
  const [data, setData] = useState(null);
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState({});
  const [custom, setCustom] = useState({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [onlyUnsure, setOnlyUnsure] = useState(false);
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("APIs");

  const load = useCallback(async (refresh = false) => {
    setError("");
    try {
      const [dash, cfg] = await Promise.all([getLiveDashboard({ refresh }), getUsageSettings()]);
      setData(dash);
      setSettings(cfg);
      setDraft(cfg.mapping || {});
      setCustom(cfg.customServices || {});
    } catch (e) { setError(errorMessage(e, "Could not load your services.")); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const catalog = settings?.catalog || [];
  const byKey = useMemo(() => new Map(catalog.map((c) => [c.key, c])), [catalog]);
  const dirty = settings ? !sameMapping(draft, settings.mapping || {}) || JSON.stringify(custom) !== JSON.stringify(settings.customServices || {}) : false;

  const setChoice = (project) => (name, key, choice) => setDraft((old) => applyChoice(old, project.id, name, key, choice));
  const addCustom = () => {
    const label = newName.trim();
    const slug = slugify(label);
    if (!label || !slug) return;
    if (custom[slug]) { toast.info("You already have a service with that name."); return; }
    setCustom((old) => ({ ...old, [slug]: { label, category: newCategory } }));
    setNewName("");
    toast.success(label + " added. Pick it in the “It is for…” column, then save.");
  };
  const removeCustom = (slug) => {
    setCustom((old) => { const next = { ...old }; delete next[slug]; return next; });
    setDraft((old) => Object.fromEntries(Object.entries(old).filter(([, v]) => v.key !== "custom:" + slug)));
  };
  const save = async () => {
    setSaving(true);
    try {
      await saveUsageSettings({ mapping: draft, customServices: custom });
      toast.success("Saved. Usage is being re-read with your choices…");
      await load(true);
    } catch (e) { toast.error(errorMessage(e, "Could not save.")); }
    finally { setSaving(false); }
  };

  const projects = data?.projects || [];
  const unsureTotal = useMemo(() => projects.reduce((n, p) => n + buildRows(p).filter((r) => !r.ownerKey && !r.internal && !choiceOf(draft, p.id, r.name)).length, 0), [projects, draft]);

  return (
    <main className="rd-page">
      <header className="rd-topbar">
        <div className="rd-shell rd-topbar__inner">
          <div className="rd-topbar__title"><div className="rd-eyebrow"><span />SERVICES</div><h1>🧭 Map your services</h1></div>
          <div className="rd-topbar__tools">
            <Link className="rd-btn rd-btn--quiet" to="/services">← Services &amp; Usage</Link>
            <button type="button" className="rd-btn rd-btn--quiet" disabled={!dirty || saving} onClick={() => { setDraft(settings?.mapping || {}); setCustom(settings?.customServices || {}); }}>Undo changes</button>
            <button type="button" className="rd-btn rd-btn--primary" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Saving…" : dirty ? "Save changes" : "Saved ✓"}</button>
          </div>
        </div>
      </header>
      <div className="rd-shell rd-stack">
        <p className="rd-note sm-intro">Stashr guesses each variable’s service from its name, its value and your code (the “Stashr thinks” column). If a guess is wrong, or it isn’t sure, choose the service yourself: usage is then read from your choice. Your choices are saved to your account and follow you to every device. Values are never shown.</p>
        {error && <div className="rd-alert rd-alert--error" role="alert"><span aria-hidden="true">!</span><div>{error}</div><button type="button" onClick={() => void load()}>Retry</button></div>}
        {!data && !error && <Skeleton lines={6} height={48} />}
        {data && data.enabled === false && <Empty icon="🧭" title="Turn on Services & Usage first">Open Services &amp; Usage and switch tracking on; your variables show up here afterwards.</Empty>}
        {data?.enabled && (
          <>
            <div className="sm-toolbar">
              <input className="rd-field" type="search" placeholder="Filter variable or service…" aria-label="Filter variables" value={query} onChange={(e) => setQuery(e.target.value)} />
              <label className="rd-check"><input type="checkbox" checked={onlyUnsure} onChange={(e) => setOnlyUnsure(e.target.checked)} /> Only what I’ve set or Stashr isn’t sure about</label>
              <span className="sv-dim">{unsureTotal} not sure</span>
            </div>

            <section className="sv-panel">
              <header className="sv-panel__head"><h2>Your own services</h2><span className="sv-dim">For a service Stashr doesn’t know (you give it a name)</span></header>
              <div className="sm-custom">
                {Object.entries(custom).map(([slug, c]) => <span key={slug} className="sm-chip">{c.label} <small>{c.category}</small><button type="button" aria-label={"Remove " + c.label} onClick={() => removeCustom(slug)}>×</button></span>)}
                <form className="sm-add" onSubmit={(e) => { e.preventDefault(); addCustom(); }}>
                  <input className="rd-field" placeholder="Service name, e.g. Acme Maps" maxLength={60} value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New service name" />
                  <select className="rd-field" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} aria-label="Category">{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
                  <button type="submit" className="rd-btn rd-btn--quiet" disabled={!newName.trim()}>＋ Add</button>
                </form>
              </div>
            </section>

            {projects.map((p) => <ProjectCard key={p.id} project={p} draft={draft} setChoice={setChoice(p)} catalog={catalog} custom={custom} byKey={byKey} onlyUnsure={onlyUnsure} query={query} />)}
            {!projects.length && <Empty icon="🧭" title="No live services yet">Connect a Render account and deploy something; its variables appear here.</Empty>}
          </>
        )}
      </div>
    </main>
  );
}
