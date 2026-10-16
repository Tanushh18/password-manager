import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { getLiveDashboard, getUsageSettings, saveUsageSettings } from "../../api/client";
import { Skeleton, Empty } from "../Render/RenderUi";
import { errorMessage } from "../Render/renderUtils";
import { buildRows, applyChoice, choiceOf, sameMapping, slugify, isFrontendVar, guessRole, folderRows } from "./serviceMapUtils";
import "../Render/RenderDashboard.css";
import "./Services.css";
import "./ServiceMap.css";

const HOW = { name: "its name", value: "its value", code: "your code", user: "you" };

/* ───────────────────────── Step 1: which folder is the server? ───────────────────────── */

function FolderStep({ project, busy, onChoose }) {
  const code = project.code;
  const rows = useMemo(() => folderRows(code?.dirs, code?.suggestion), [code]);
  const [pick, setPick] = useState(code?.suggestion?.folder || "");
  useEffect(() => { if (!pick && code?.suggestion?.folder) setPick(code.suggestion.folder); }, [code?.suggestion?.folder]); // eslint-disable-line react-hooks/exhaustive-deps

  if (code?.serverFolder) {
    return (
      <div className="sm-folder is-set">
        <span>📁 Server folder: <code>{code.serverFolder === "." ? "repository root" : code.serverFolder}</code></span>
        <button type="button" className="rd-btn rd-btn--link" disabled={busy} onClick={() => onChoose("")}>Change</button>
        {code.frontendVars?.length > 0 && <small className="sv-dim">{code.frontendVars.length} frontend variable{code.frontendVars.length === 1 ? "" : "s"} hidden</small>}
      </div>
    );
  }
  if (!code) return <p className="rd-note">No GitHub repository is linked to this server, so Stashr can’t look at your folders. Variables that only the browser uses (NEXT_PUBLIC_, VITE_ …) are hidden.</p>;
  if (code.state === "pending") return <p className="rd-note">🔎 Reading your repository’s folders…</p>;
  if (!rows.length) return <p className="rd-note">Stashr couldn’t read this repository’s folders (check your GitHub connection on the Projects page). Browser-only variables are hidden.</p>;

  return (
    <div className="sm-folder">
      <h3>Which folder is your server?</h3>
      <p className="sv-dim">Your repository has these folders. Pick the one that runs on Render, and Stashr will only ask about the variables your server uses.</p>
      <div className="sm-folders" role="radiogroup" aria-label="Server folder">
        <label className={"sm-folder__row" + (pick === "." ? " is-picked" : "")}><input type="radio" name={"f-" + project.id} checked={pick === "."} onChange={() => setPick(".")} /><span>📁 The whole repository (server is at the top level)</span></label>
        {rows.map((r) => (
          <label key={r.path} className={"sm-folder__row" + (pick === r.path ? " is-picked" : "")} style={{ paddingLeft: 10 + r.depth * 18 }}>
            <input type="radio" name={"f-" + project.id} checked={pick === r.path} onChange={() => setPick(r.path)} />
            <span>📁 {r.name}<small className="sv-dim"> {r.files} code file{r.files === 1 ? "" : "s"}</small></span>
            {r.suggested && <b className="sm-tag is-good">looks like your server{r.why ? " · " + r.why : ""}</b>}
            {!r.suggested && r.looksFrontend && <b className="sm-tag">looks like a frontend</b>}
          </label>
        ))}
      </div>
      <div className="sm-folder__actions">
        <button type="button" className="rd-btn rd-btn--primary" disabled={!pick || busy} onClick={() => onChoose(pick)}>{busy ? "Saving…" : "This is my server"}</button>
        <span className="sv-dim">Not sure? Skip, and Stashr will show everything except browser-only variables.</span>
      </div>
    </div>
  );
}

/* ───────────────────────── One variable ───────────────────────── */

function Picker({ value, onChange, catalog, custom, guess }) {
  const byCategory = useMemo(() => {
    const map = new Map();
    for (const c of catalog) { if (!map.has(c.category)) map.set(c.category, []); map.get(c.category).push(c); }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [catalog]);
  return (
    <select className="rd-field sm-pick" value={value} onChange={(e) => onChange(e.target.value)} aria-label="What is this variable for?">
      <option value="">{guess ? "✓ " + guess + " (Stashr’s guess)" : "Choose…"}</option>
      <option value="__new">＋ A service that isn’t listed…</option>
      <option value="ignore">✕ Not a service — ignore</option>
      {Object.keys(custom).length > 0 && <optgroup label="Your own services">{Object.entries(custom).map(([slug, c]) => <option key={slug} value={"custom:" + slug}>{c.label}</option>)}</optgroup>}
      {byCategory.map(([cat, list]) => <optgroup key={cat} label={cat}>{list.map((c) => <option key={c.key} value={c.key}>{c.label}{c.liveUsageSupported ? " · usage ✓" : ""}</option>)}</optgroup>)}
    </select>
  );
}

function VarRow({ row, project, draft, onSet, catalog, custom, byKey, onAddCustom }) {
  const choice = choiceOf(draft, project.id, row.name);
  const key = choice?.key || "";
  const def = byKey.get(key);
  const roles = def?.roles || [];
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [more, setMore] = useState(false);
  const inputRef = useRef(null);
  useEffect(() => { if (naming) inputRef.current?.focus(); }, [naming]);

  const pickService = (value) => {
    if (value === "__new") { setNaming(true); return; }
    const roleGuess = value && PROVIDER_ROLES(byKey, value) ? guessRole(PROVIDER_ROLES(byKey, value), row.name, value) : "";
    onSet(row.name, value, { scope: choice?.scope || "project", role: roleGuess, key: value });
  };
  const submitNew = () => { const key2 = onAddCustom(newName); if (key2) { onSet(row.name, key2, { scope: choice?.scope || "project" }); setNaming(false); setNewName(""); } };
  const label = key ? (key === "ignore" ? "Ignored" : def?.label || custom[key.replace("custom:", "")]?.label || key) : "";

  return (
    <li className={"sm-var" + (key ? " is-mine" : row.ownerKey ? "" : " is-unknown")}>
      <div className="sm-var__name">
        <code>{row.name}</code>
        <small className="sv-dim">{row.kind === "secret" ? "secret" : row.kind === "url" ? row.display || "URL" : row.set ? row.display || "set" : "empty"}</small>
      </div>
      <div className="sm-var__for">
        {naming ? (
          <form className="sm-inline" onSubmit={(e) => { e.preventDefault(); submitNew(); }}>
            <input ref={inputRef} className="rd-field" placeholder="Service name, e.g. Acme Maps" maxLength={60} value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="Name of the service" />
            <button type="submit" className="rd-btn rd-btn--quiet" disabled={!newName.trim()}>Add</button>
            <button type="button" className="rd-btn rd-btn--link" onClick={() => setNaming(false)}>Cancel</button>
          </form>
        ) : (
          <Picker value={key} onChange={pickService} catalog={catalog} custom={custom} guess={row.ownerKey ? row.ownerLabel : row.internal ? "app setting" : ""} />
        )}
        {row.ownerKey && !key && <small className="sv-dim">found by {HOW[row.via] || "its name"}</small>}
        {key && key !== "ignore" && !def?.liveUsageSupported && !key.startsWith("custom:") && <small className="sv-dim">→ {label} · no usage reader yet</small>}
        {key.startsWith("custom:") && <small className="sv-dim">→ {label} · tracked by name only</small>}
      </div>
      {roles.length > 0 && key && (
        <div className="sm-var__part">
          <select className="rd-field" value={choice?.role || ""} onChange={(e) => onSet(row.name, key, { ...choice, key, role: e.target.value })} aria-label="Which part of the login details is this?">
            <option value="">{choice?.role ? "" : "Which part is it?"}</option>
            {roles.map(([r, l]) => <option key={r} value={r}>{l}</option>)}
          </select>
        </div>
      )}
      {key && key !== "ignore" && (
        <div className="sm-var__more">
          <button type="button" className="rd-btn rd-btn--link" aria-expanded={more} onClick={() => setMore((v) => !v)}>{more ? "Hide options" : "More options"}</button>
          {more && (
            <div className="sm-adv">
              <label>Applies to
                <select className="rd-field" value={choice.scope} onChange={(e) => onSet(row.name, key, { ...choice, key, scope: e.target.value })}>
                  <option value="project">only this server</option>
                  <option value="all">all my servers</option>
                </select>
              </label>
              {choice?.role && roles.length > 0 && (
                <label>Account name <small className="sv-dim">(if you have two accounts of this service)</small>
                  <input className="rd-field" placeholder="e.g. shop" maxLength={30} value={choice.group || ""} onChange={(e) => onSet(row.name, key, { ...choice, key, group: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })} />
                </label>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
// Roles of a catalog service (as [[role, label], ...]); empty when it has none.
const PROVIDER_ROLES = (byKey, key) => byKey.get(key)?.roles || [];

/* ───────────────────────── One server (project) ───────────────────────── */

function ProjectCard({ project, draft, onSet, catalog, custom, byKey, onAddCustom, onFolder, folderBusy, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const [showSure, setShowSure] = useState(false);
  const [showFront, setShowFront] = useState(false);
  const rows = useMemo(() => buildRows(project), [project]);
  const frontend = rows.filter((r) => isFrontendVar(r.name, project) && !choiceOf(draft, project.id, r.name));
  const mine = rows.filter((r) => !frontend.includes(r));
  const needHelp = mine.filter((r) => !r.ownerKey && !r.internal && !choiceOf(draft, project.id, r.name));
  const sure = mine.filter((r) => !needHelp.includes(r));
  const stuck = project.services.filter((s) => (s.state === "no-credentials" || s.state === "in-code") && !s.inCodeOnly);
  const list = (items) => <ul className="sm-vars">{items.map((row) => <VarRow key={row.name} row={row} project={project} draft={draft} onSet={onSet} catalog={catalog} custom={custom} byKey={byKey} onAddCustom={onAddCustom} />)}</ul>;

  return (
    <section className="sv-panel sm-project">
      <header className="sv-panel__head sm-head">
        <button type="button" className="sm-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "▾" : "▸"} <h2>{project.name}</h2></button>
        <span className="sv-dim">{needHelp.length ? needHelp.length + " need your help" : "all understood ✓"}</span>
      </header>
      {open && (
        <div className="sm-body">
          <FolderStep project={project} busy={folderBusy} onChoose={onFolder} />

          {project.services.length > 0 && (
            <div className="sm-found">
              <h3>What Stashr found</h3>
              <div className="sm-found__chips">
                {project.services.map((s) => (
                  <span key={s.key} className={"sm-found__chip is-" + (s.state === "ok" ? "ok" : s.state === "error" ? "bad" : "mid")} title={s.diagnosis || ""}>
                    {s.label}<small>{s.state === "ok" ? "usage ✓" : s.state === "no-reader" ? "no usage reader" : s.state === "in-code" ? "in your code, no keys" : s.state === "error" ? "can’t read" : "needs keys"}</small>
                  </span>
                ))}
              </div>
              {stuck.length > 0 && <p className="rd-note">To read usage for {stuck.map((s) => s.label).join(", ")}, tell Stashr which variables hold its login details below.</p>}
            </div>
          )}

          {needHelp.length > 0 && <div><h3>Stashr isn’t sure about these</h3><p className="sv-dim">Choose what each one is for. Values stay hidden.</p>{list(needHelp)}</div>}

          {sure.length > 0 && (
            <div>
              <button type="button" className="rd-btn rd-btn--link" aria-expanded={showSure} onClick={() => setShowSure((v) => !v)}>{showSure ? "Hide" : "Show"} the {sure.length} Stashr already understood</button>
              {showSure && list(sure)}
            </div>
          )}

          {frontend.length > 0 && (
            <div>
              <button type="button" className="rd-btn rd-btn--link" aria-expanded={showFront} onClick={() => setShowFront((v) => !v)}>{showFront ? "Hide" : "Show"} {frontend.length} frontend variable{frontend.length === 1 ? "" : "s"} (not needed)</button>
              {showFront && list(frontend)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Tell Stashr which of your variables belong to which service; usage is then read from your choices. */
export default function ServiceMap() {
  const [data, setData] = useState(null);
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState({});
  const [custom, setCustom] = useState({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [folderBusy, setFolderBusy] = useState(false);
  const [query, setQuery] = useState("");
  const draftRef = useRef({ draft: {}, custom: {} });
  draftRef.current = { draft, custom };

  const load = useCallback(async ({ refresh = false, keepEdits = false } = {}) => {
    setError("");
    try {
      const [dash, cfg] = await Promise.all([getLiveDashboard({ refresh }), getUsageSettings()]);
      setData(dash);
      setSettings(cfg);
      if (!keepEdits) { setDraft(cfg.mapping || {}); setCustom(cfg.customServices || {}); }
    } catch (e) { setError(errorMessage(e, "Could not load your servers.")); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // A repository is read in the background the first time; check back until it has been.
  const pending = (data?.projects || []).some((p) => p.code?.state === "pending");
  useEffect(() => {
    if (!pending) return undefined;
    let tries = 0;
    const t = window.setInterval(() => { if (++tries > 12) window.clearInterval(t); else void load({ keepEdits: true }); }, 6000);
    return () => window.clearInterval(t);
  }, [pending, load]);

  const catalog = settings?.catalog || [];
  const byKey = useMemo(() => new Map(catalog.map((c) => [c.key, c])), [catalog]);
  const dirty = settings ? !sameMapping(draft, settings.mapping || {}) || JSON.stringify(custom) !== JSON.stringify(settings.customServices || {}) : false;

  const onSet = (projectId) => (name, key, choice) => setDraft((old) => applyChoice(old, projectId, name, key, choice));
  const onAddCustom = (label) => {
    const clean = String(label || "").trim();
    const slug = slugify(clean);
    if (!clean || !slug) return "";
    setCustom((old) => (old[slug] ? old : { ...old, [slug]: { label: clean, category: "APIs" } }));
    return "custom:" + slug;
  };
  const persist = async (extra = {}) => {
    const { draft: d, custom: c } = draftRef.current;
    await saveUsageSettings({ mapping: d, customServices: c, ...extra });
  };
  const save = async () => {
    setSaving(true);
    try { await persist(); toast.success("Saved. Usage is being re-read with your choices…"); await load({ refresh: true }); }
    catch (e) { toast.error(errorMessage(e, "Could not save.")); }
    finally { setSaving(false); }
  };
  const chooseFolder = (project) => async (folder) => {
    setFolderBusy(true);
    try {
      const folders = { ...(settings?.serverFolders || {}) };
      if (folder) folders[project.id] = folder; else delete folders[project.id];
      await persist({ serverFolders: folders });
      await load({ refresh: true, keepEdits: true });
      if (folder) toast.success("Server folder saved. Reading it now…");
    } catch (e) { toast.error(errorMessage(e, "Could not save the folder.")); }
    finally { setFolderBusy(false); }
  };

  const projects = (data?.projects || []).filter((p) => !query.trim() || (p.name + " " + p.services.map((s) => s.label).join(" ")).toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <main className="rd-page">
      <header className="rd-topbar">
        <div className="rd-shell rd-topbar__inner">
          <div className="rd-topbar__title"><div className="rd-eyebrow"><span />SERVICES</div><h1>🧭 Map your services</h1></div>
          <div className="rd-topbar__tools">
            <Link className="rd-btn rd-btn--quiet" to="/services">← Services &amp; Usage</Link>
          </div>
        </div>
      </header>
      <div className="rd-shell rd-stack">
        <ol className="sm-steps">
          <li><b>1</b> Pick the folder that is your server</li>
          <li><b>2</b> Check what Stashr found</li>
          <li><b>3</b> Fix anything it missed</li>
        </ol>
        {error && <div className="rd-alert rd-alert--error" role="alert"><span aria-hidden="true">!</span><div>{error}</div><button type="button" onClick={() => void load()}>Retry</button></div>}
        {!data && !error && <Skeleton lines={6} height={48} />}
        {data && data.enabled === false && <Empty icon="🧭" title="Turn on Services & Usage first">Open Services &amp; Usage and switch tracking on; your servers show up here afterwards.</Empty>}
        {data?.enabled && (
          <>
            {data.projects.length > 3 && <input className="rd-field sm-search" type="search" placeholder="Find a server…" aria-label="Find a server" value={query} onChange={(e) => setQuery(e.target.value)} />}
            {projects.map((p, i) => <ProjectCard key={p.id} project={p} draft={draft} onSet={onSet(p.id)} catalog={catalog} custom={custom} byKey={byKey} onAddCustom={onAddCustom} onFolder={chooseFolder(p)} folderBusy={folderBusy} defaultOpen={i === 0 || projects.length <= 2} />)}
            {!data.projects.length && <Empty icon="🧭" title="No live servers yet">Connect a Render account and deploy something; its variables appear here.</Empty>}
            {Object.keys(custom).length > 0 && (
              <p className="sm-mine">Your own services: {Object.entries(custom).map(([slug, c]) => <span key={slug} className="sm-chip">{c.label}<button type="button" aria-label={"Remove " + c.label} onClick={() => { setCustom((o) => { const n = { ...o }; delete n[slug]; return n; }); setDraft((o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v.key !== "custom:" + slug))); }}>×</button></span>)}</p>
            )}
          </>
        )}
      </div>
      {dirty && (
        <div className="sm-savebar" role="region" aria-label="Unsaved changes">
          <span>You have unsaved changes.</span>
          <button type="button" className="rd-btn rd-btn--quiet" disabled={saving} onClick={() => { setDraft(settings?.mapping || {}); setCustom(settings?.customServices || {}); }}>Undo</button>
          <button type="button" className="rd-btn rd-btn--primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save changes"}</button>
        </div>
      )}
    </main>
  );
}
