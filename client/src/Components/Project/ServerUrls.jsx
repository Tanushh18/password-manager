import React, { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { checkServer, errorMessage, saveRegistry } from "../../api/client";
import { useVault } from "../../state/vault";
import { Plus, Trash } from "../Icons/Icons";

const APPS = [{ id: "", label: "Not published" }, { id: "wethree", label: "We Three" }, { id: "dealradar", label: "Deal Radar" }, { id: "stashr", label: "Stashr" }];
const looksValid = (u) => /^https?:\/\/\S+$/i.test(u.trim());

/**
 * This project's own backend URL list. It is saved inside the project (encrypted with the rest of it);
 * saving also publishes the switched-on URLs to the public registry the chosen app reads on start.
 */
export default function ServerUrls({ project }) {
  const { updateProject } = useVault();
  const [rows, setRows] = useState([]);
  const [app, setApp] = useState("");
  const [status, setStatus] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRows((project.serverUrls || []).map((r) => ({ ...r })));
    setApp(project.registryApp || "");
  }, [project.id, project.serverUrls, project.registryApp]);

  const edit = (i, patch) => setRows((list) => list.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const move = (i) => setRows((list) => (i > 0 ? list.map((_, n) => (n === i - 1 ? list[i] : n === i ? list[i - 1] : list[n])) : list));

  const check = async () => {
    const next = {};
    await Promise.all(rows.filter((r) => looksValid(r.url)).map(async (r) => {
      try { const res = await checkServer(r.url.trim()); next[r.url] = res.data.ok ? "up" : "down"; } catch { next[r.url] = "unknown"; }
    }));
    setStatus(next);
  };

  const save = async () => {
    const cleaned = rows.filter((r) => r.url.trim()).map((r) => ({ url: r.url.trim().replace(/\/+$/, ""), enabled: r.enabled !== false }));
    if (cleaned.some((r) => !looksValid(r.url))) return toast.error("Every URL must start with https://");
    const active = cleaned.filter((r) => r.enabled).map((r) => r.url);
    if (app && active.length === 0) return toast.error("Switch on at least one URL, or choose “Not published”.");
    setBusy(true);
    try {
      await updateProject(project.id, { serverUrls: cleaned, registryApp: app });
      if (app) {
        try { await saveRegistry(app, active); toast.success("Saved and published to " + APPS.find((a) => a.id === app).label + "."); }
        catch (err) { toast.warn("Saved in this project, but not published: " + errorMessage(err, "only an admin can publish.")); }
      } else toast.success("Saved.");
    } catch (err) { toast.error(errorMessage(err, "Could not save.")); }
    finally { setBusy(false); }
  };

  return (
    <section className="card proj-optional" style={{ padding: 16 }}>
      <h2 className="proj-section__title">Server URLs <small>(the app uses the switched-on ones, in this order)</small></h2>
      {rows.length === 0 ? <p className="field__note">No server URLs yet.</p> : rows.map((r, i) => (
        <div key={i} className="proj-repeat-row">
          <input className="input" value={r.url} placeholder="https://your-server.onrender.com/api" onChange={(e) => edit(i, { url: e.target.value })} />
          <small>{status[r.url] || ""}</small>
          <label><input type="checkbox" checked={r.enabled !== false} onChange={(e) => edit(i, { enabled: e.target.checked })} /> Use</label>
          <button type="button" className="icon-btn icon-btn--quiet" onClick={() => move(i)} aria-label="Move up" disabled={i === 0}>↑</button>
          <button type="button" className="icon-btn icon-btn--quiet" onClick={() => setRows((l) => l.filter((_, n) => n !== i))} aria-label="Remove"><Trash size={15} /></button>
        </div>
      ))}
      <div className="field">
        <label className="field__label" htmlFor="su-app">App that reads this list</label>
        <select id="su-app" className="input" value={app} onChange={(e) => setApp(e.target.value)}>
          {APPS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn--sm" onClick={() => setRows((l) => [...l, { url: "", enabled: true }])}><Plus size={14} /> Add URL</button>
        <button type="button" className="btn btn--sm" onClick={check} disabled={!rows.length}>Check all</button>
        <button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </section>
  );
}
