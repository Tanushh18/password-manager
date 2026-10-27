import React, { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { API_URL, checkServer, errorMessage, getAllRenderServers, saveRegistry, syncProjectServers } from "../../api/client";
import { useVault } from "../../state/vault";
import { Plus, Trash } from "../Icons/Icons";

const OWN = "__own__";
const LEGACY = [{ id: "wethree", label: "We Three" }, { id: "dealradar", label: "Deal Radar" }, { id: "stashr", label: "Stashr" }];
const looksValid = (u) => /^https?:\/\/\S+$/i.test(u.trim());
const originOf = (u) => { try { return new URL(u).origin.toLowerCase(); } catch { return ""; } };
const pathOf = (u) => { try { return new URL(u).pathname.replace(/\/+$/, ""); } catch { return ""; } };

/**
 * This project's backend URLs. They live inside the project (encrypted with the rest of it) and feed a public list at
 * <Stashr>/registry/<name> that a client app or website reads to find the server. Servers of the repo are added by
 * themselves as they appear; switch one off with "Use", or remove it and it stays out.
 */
export default function ServerUrls({ project }) {
  const { updateProject } = useVault();
  const [rows, setRows] = useState([]);
  const [ignored, setIgnored] = useState([]);
  const [mode, setMode] = useState("");
  const [status, setStatus] = useState({});
  const [busy, setBusy] = useState("");
  const [found, setFound] = useState(null);

  const slug = project.registryApp || "";
  const isLegacy = LEGACY.some((a) => a.id === slug);

  useEffect(() => {
    setRows((project.serverUrls || []).map((r) => ({ ...r })));
    setIgnored(project.serverUrlsIgnored || []);
    setMode(!slug ? "" : isLegacy ? slug : OWN);
  }, [project.id, project.serverUrls, project.serverUrlsIgnored, slug, isLegacy]);

  const publicUrl = slug ? `${API_URL()}/registry/${slug}` : "";
  const edit = (i, patch) => setRows((list) => list.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const move = (i) => setRows((list) => (i > 0 ? list.map((_, n) => (n === i - 1 ? list[i] : n === i ? list[i - 1] : list[n])) : list));
  const remove = (i) => {
    const row = rows[i];
    if (row.auto && originOf(row.url)) setIgnored((l) => [...new Set([...l, originOf(row.url)])]);
    setRows((l) => l.filter((_, n) => n !== i));
  };

  const check = async () => {
    const next = {};
    await Promise.all(rows.filter((r) => looksValid(r.url)).map(async (r) => {
      try { const res = await checkServer(r.url.trim()); next[r.url] = res.data.ok ? "up" : "down"; } catch { next[r.url] = "unknown"; }
    }));
    setStatus(next);
  };

  const discover = async () => {
    try { setFound((await getAllRenderServers({ refresh: true })).servers); }
    catch (err) { toast.error(errorMessage(err, "Could not load your servers.")); }
  };
  const addFound = (s) => {
    const suffix = pathOf(rows.find((r) => looksValid(r.url))?.url || "");
    const url = new URL(s.url).origin + suffix;
    setIgnored((l) => l.filter((u) => u !== originOf(url)));
    setRows((list) => (list.some((r) => originOf(r.url) === originOf(url)) ? list : [...list, { url, enabled: !s.suspended }]));
  };

  const cleanRows = () => rows.filter((r) => r.url.trim()).map((r) => ({ url: r.url.trim().replace(/\/+$/, ""), enabled: r.enabled !== false, ...(r.auto ? { auto: true } : {}) }));

  const save = async () => {
    const cleaned = cleanRows();
    if (cleaned.some((r) => !looksValid(r.url))) return toast.error("Every URL must start with https://");
    if (mode && cleaned.filter((r) => r.enabled).length === 0) return toast.error("Switch on at least one URL, or choose “Not published”.");
    setBusy("save");
    try {
      const app = mode === OWN ? (isLegacy ? "" : slug) : mode;
      await updateProject(project.id, { serverUrls: cleaned, serverUrlsIgnored: ignored, registryApp: app });
      if (mode === OWN) {
        const res = await syncProjectServers(project.id);
        await updateProject(project.id, { serverUrls: res.serverUrls, registryApp: res.registryApp });
        toast.success(res.published ? "Saved. Public list updated." : "Saved.");
      } else if (mode) {
        try { await saveRegistry(mode, cleaned.filter((r) => r.enabled).map((r) => r.url)); toast.success("Saved and published."); }
        catch (err) { toast.warn("Saved in this project, but not published: " + errorMessage(err, "only an admin can publish this app.")); }
      } else toast.success("Saved.");
    } catch (err) { toast.error(errorMessage(err, "Could not save.")); }
    finally { setBusy(""); }
  };

  const syncNow = async () => {
    setBusy("sync");
    try {
      const res = await syncProjectServers(project.id, mode === "" ? {} : undefined);
      await updateProject(project.id, { serverUrls: res.serverUrls, registryApp: res.registryApp });
      toast.success(res.changed ? "Servers updated from your Render accounts." : "Already up to date.");
    } catch (err) { toast.error(errorMessage(err, "Could not sync.")); }
    finally { setBusy(""); }
  };

  const copy = async () => { try { await navigator.clipboard.writeText(publicUrl); toast.success("Copied."); } catch { toast.error("Clipboard is not available."); } };

  const groups = (found || []).reduce((acc, s) => { (acc[s.providerLabel] = acc[s.providerLabel] || []).push(s); return acc; }, {});

  return (
    <section className="card proj-optional" style={{ padding: 16 }}>
      <h2 className="proj-section__title">Server URLs <small>(the app uses the switched-on ones, in this order)</small></h2>
      {rows.length === 0 ? <p className="field__note">No server URLs yet. Deploy a server, or add one below.</p> : rows.map((r, i) => (
        <div key={i} className="proj-repeat-row">
          <input className="input" value={r.url} placeholder="https://your-server.onrender.com/api" onChange={(e) => edit(i, { url: e.target.value })} />
          <small>{status[r.url] || (r.auto ? "auto" : "")}</small>
          <label><input type="checkbox" checked={r.enabled !== false} onChange={(e) => edit(i, { enabled: e.target.checked })} /> Use</label>
          <button type="button" className="icon-btn icon-btn--quiet" onClick={() => move(i)} aria-label="Move up" disabled={i === 0}>↑</button>
          <button type="button" className="icon-btn icon-btn--quiet" onClick={() => remove(i)} aria-label="Remove"><Trash size={15} /></button>
        </div>
      ))}
      <div className="field">
        <label className="field__label" htmlFor="su-app">Public list</label>
        <select id="su-app" className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="">Not published</option>
          <option value={OWN}>Publish for this project{slug && !isLegacy ? ` (${slug})` : ""}</option>
          {LEGACY.map((a) => <option key={a.id} value={a.id}>{a.label} (admin)</option>)}
        </select>
        {publicUrl && mode ? (
          <p className="field__note">
            Put this address in your client: <code>{publicUrl}</code>{" "}
            <button type="button" className="btn btn--sm" onClick={copy}>Copy</button>
          </p>
        ) : mode === OWN ? <p className="field__note">The address appears after you save.</p> : null}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn--sm" onClick={() => setRows((l) => [...l, { url: "", enabled: true }])}><Plus size={14} /> Add URL</button>
        <button type="button" className="btn btn--sm" onClick={discover}>Add from my servers</button>
        <button type="button" className="btn btn--sm" onClick={syncNow} disabled={busy === "sync"}>{busy === "sync" ? "Syncing…" : "Sync now"}</button>
        <button type="button" className="btn btn--sm" onClick={check} disabled={!rows.length}>Check all</button>
        <button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={busy === "save"}>{busy === "save" ? "Saving…" : "Save"}</button>
      </div>
      {found && (
        <div style={{ marginTop: 12 }}>
          {found.length === 0 ? <p className="field__note">No servers found in your connected Render or hosting accounts.</p> : Object.entries(groups).map(([provider, list]) => (
            <div key={provider}>
              <h3 className="proj-section__title" style={{ fontSize: 14, marginTop: 10 }}>{provider} <small>({list.length})</small></h3>
              {list.map((s) => {
                const added = rows.some((r) => originOf(r.url) === originOf(s.url));
                return (
                  <div key={provider + s.id} className="proj-repeat-row">
                    <span style={{ flex: 1 }}><strong>{s.name}</strong> <small>{s.url} · {s.kind === "site" ? "site" : "server"} · {s.accountName}{s.suspended ? " · suspended" : ""}</small></span>
                    <button type="button" className="btn btn--sm" disabled={added} onClick={() => addFound(s)}>{added ? "Added" : "Add"}</button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
