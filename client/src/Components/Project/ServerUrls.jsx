import React, { useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { API_URL, checkServer, errorMessage, getAllRenderServers, syncProjectServers } from "../../api/client";
import { useVault } from "../../state/vault";
import { Plus, Trash } from "../Icons/Icons";
import HostLinks from "./HostLinks";
import ServerUsage from "./ServerUsage";
import "./ServerUrls.css";

const LIST_NAME = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const suggestName = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 38).replace(/-+$/g, "");
const looksValid = (u) => /^https?:\/\/\S+$/i.test(u.trim());
const originOf = (u) => { try { return new URL(u).origin.toLowerCase(); } catch { return ""; } };
const pathOf = (u) => { try { return new URL(u).pathname.replace(/\/+$/, ""); } catch { return ""; } };

/** A small popup menu that closes when you pick something or click elsewhere. */
function Menu({ label, align, children }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="su__menu" ref={box}>
      <button type="button" className="btn btn--sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{label} ▾</button>
      {open ? <div className={"su__pop" + (align === "right" ? " su__pop--right" : "")} role="menu" onClick={() => setOpen(false)}>{children}</div> : null}
    </div>
  );
}

/**
 * This project's backend URLs. They live inside the project (encrypted with the rest of it) and feed a public list at
 * <Stashr>/registry/<name> that a client app or website reads to find the server. Servers of the repo are added by
 * themselves as they appear; switch one off with its switch, or remove it and it stays out.
 */
export default function ServerUrls({ project }) {
  const { updateProject } = useVault();
  const [rows, setRows] = useState([]);
  const [ignored, setIgnored] = useState([]);
  const [published, setPublished] = useState(false);
  const [listName, setListName] = useState("");
  const [status, setStatus] = useState({});
  const [busy, setBusy] = useState("");
  const [found, setFound] = useState(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);

  const slug = project.registryApp || "";
  const locked = project.registryLocked === true && Boolean(slug);

  useEffect(() => {
    setRows((project.serverUrls || []).map((r) => ({ ...r })));
    setIgnored(project.serverUrlsIgnored || []);
    setPublished(Boolean(slug));
    setListName(slug || suggestName(project.name));
  }, [project.id, project.name, project.serverUrls, project.serverUrlsIgnored, slug]);

  const name = listName.trim().toLowerCase();
  const publicUrl = published && LIST_NAME.test(name) ? `${API_URL()}/registry/${name}` : "";
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

  const cleanRows = (list) => list.filter((r) => r.url.trim()).map((r) => ({ url: r.url.trim().replace(/\/+$/, ""), enabled: r.enabled !== false, ...(r.auto ? { auto: true } : {}) }));

  // Saves the project and, when it is published, updates the public list under the chosen name. `instant` = from a switch.
  const persist = async (list, { instant = false } = {}) => {
    const cleaned = cleanRows(list);
    if (cleaned.some((r) => !looksValid(r.url))) return toast.error("Every URL must start with https://");
    if (published && !LIST_NAME.test(name)) return toast.error("List name: 3-40 letters, numbers or dashes.");
    setBusy(instant ? "toggle" : "save");
    try {
      await updateProject(project.id, { serverUrls: cleaned, serverUrlsIgnored: ignored, registryApp: published ? name : "" });
      const on = cleaned.filter((r) => r.enabled).length;
      if (published) {
        const res = await syncProjectServers(project.id, { registryApp: name });
        await updateProject(project.id, { serverUrls: res.serverUrls, registryApp: res.registryApp });
        if (!res.published) toast.warn(`Saved here, but "${name}" was not published: the name is taken, or it is a built-in app name only an admin can use, or it needs at least one server on.`);
        else toast.success(on ? (instant ? "Updated. The apps use " + on + " server" + (on === 1 ? "" : "s") + "." : "Saved. Public list updated.") : "All servers are off. The public list is empty now.");
      } else toast.success("Saved.");
    } catch (err) { toast.error(errorMessage(err, "Could not save.")); }
    finally { setBusy(""); }
  };
  const save = () => persist(rows);
  const setOne = (i, enabled) => { const next = rows.map((r, n) => (n === i ? { ...r, enabled } : r)); setRows(next); void persist(next, { instant: true }); };
  const setAll = (enabled) => { const next = rows.map((r) => ({ ...r, enabled })); setRows(next); void persist(next, { instant: true }); };

  const toggleLock = async () => {
    setBusy("lock");
    try {
      await updateProject(project.id, { registryLocked: !locked });
      toast.success(locked ? "Address unlocked." : "Address locked. The public list link cannot be renamed or unpublished.");
    } catch (err) { toast.error(errorMessage(err, "Could not change the lock.")); }
    finally { setBusy(""); }
  };

  const syncNow = async () => {
    setBusy("sync");
    try {
      const res = await syncProjectServers(project.id, published && LIST_NAME.test(name) ? { registryApp: name } : { publish: false });
      await updateProject(project.id, { serverUrls: res.serverUrls, registryApp: res.registryApp });
      toast.success(res.changed ? "Servers updated from your Render accounts." : "Already up to date.");
    } catch (err) { toast.error(errorMessage(err, "Could not sync.")); }
    finally { setBusy(""); }
  };

  const copy = async () => { try { await navigator.clipboard.writeText(publicUrl); toast.success("Copied."); } catch { toast.error("Clipboard is not available."); } };
  const groups = (found || []).reduce((acc, s) => { (acc[s.providerLabel] = acc[s.providerLabel] || []).push(s); return acc; }, {});
  const onCount = rows.filter((r) => r.enabled !== false).length;

  return (
    <section className="card su" aria-label="Server URLs">
      <div className="su__head">
        <div>
          <h2 className="su__title">Server URLs</h2>
          <p className="su__hint">{rows.length ? `${onCount} of ${rows.length} on. The app uses the switched-on ones, top first.` : "No servers yet. Deploy one, or add it below."}</p>
        </div>
      </div>

      <div className="su__public">
        <div>
          <label htmlFor="su-name">Public list</label>
          <div className="su__name">
            <button type="button" role="switch" aria-checked={published} aria-label="Publish this list" className="su__switch" disabled={locked} onClick={() => setPublished((v) => !v)} title={published ? "Published: your client reads these URLs from Stashr. Click to stop." : "Not published. Click to publish."} />
            <input id="su-name" className="input" value={listName} disabled={!published || locked} placeholder="list-name" maxLength={40} onChange={(e) => setListName(e.target.value)} aria-label="List name" />
          </div>
        </div>
        {publicUrl ? (
          <div className="su__address"><code title={publicUrl}>{publicUrl}</code><button type="button" className="btn btn--sm" onClick={copy}>Copy</button>{slug ? <button type="button" className="btn btn--sm" disabled={busy === "lock"} onClick={toggleLock} title={locked ? "Locked: this address cannot be renamed or unpublished. Click to unlock." : "Lock this address so it cannot be renamed or unpublished."}>{locked ? "Locked 🔒" : "Lock"}</button> : null}</div>
        ) : <div className="su__address su__address--empty">{published ? "Use 3-40 letters, numbers or dashes for the name." : "Publish it to get an address your client can use."}</div>}
      </div>

      <div className="su__list">
        {rows.map((r, i) => {
          const on = r.enabled !== false;
          return (
            <div key={i} className={"su__row" + (on ? "" : " is-off")}>
              <span className={"su__dot" + (status[r.url] === "up" ? " is-up" : status[r.url] === "down" ? " is-down" : "")} title={status[r.url] ? status[r.url] : "Not checked yet"} aria-hidden="true" />
              <input className="input" value={r.url} placeholder="https://your-server.onrender.com" aria-label={"Server URL " + (i + 1)} onChange={(e) => edit(i, { url: e.target.value })} />
              {r.auto ? <span className="su__tag" title="Added automatically from your Render server">auto</span> : <span />}
              <button type="button" role="switch" aria-checked={on} aria-label={(on ? "Turn off " : "Turn on ") + (r.url || "server")} className="su__switch" disabled={busy === "toggle" || !looksValid(r.url)} title={on ? "On: the apps use it. Click to turn it off, right now." : "Off. Click to let the apps use it again."} onClick={() => setOne(i, !on)} />
              <button type="button" className="icon-btn icon-btn--quiet su__up" onClick={() => move(i)} aria-label="Move up" disabled={i === 0}>↑</button>
              <button type="button" className="icon-btn icon-btn--quiet" onClick={() => remove(i)} aria-label="Remove"><Trash size={15} /></button>
            </div>
          );
        })}
      </div>

      <div className="su__actions">
        <Menu label="Add">
          <button type="button" role="menuitem" onClick={() => setRows((l) => [...l, { url: "", enabled: true }])}>Type a URL</button>
          <button type="button" role="menuitem" onClick={discover}>From my servers…</button>
          <button type="button" role="menuitem" onClick={() => setLinkOpen(true)}>Link a Vercel / Netlify / Railway site…</button>
        </Menu>
        <Menu label="More">
          <button type="button" role="menuitem" onClick={syncNow} disabled={busy === "sync"}>Sync from Render now</button>
          <button type="button" role="menuitem" onClick={check} disabled={!rows.length}>Check which are up</button>
          <hr />
          <button type="button" role="menuitem" onClick={() => setAll(false)} disabled={!rows.length || busy === "toggle"}>Turn all off</button>
          <button type="button" role="menuitem" onClick={() => setAll(true)} disabled={!rows.length || busy === "toggle"}>Turn all on</button>
        </Menu>
        <span className="su__spacer" />
        <button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={busy === "save"}>{busy === "save" ? "Saving…" : "Save"}</button>
      </div>

      <HostLinks project={project} open={linkOpen} onOpenChange={setLinkOpen} />

      {found ? (
        <div className="su__found">
          {found.length === 0 ? <p className="su__empty">No servers found in your connected Render or hosting accounts.</p> : Object.entries(groups).map(([provider, list]) => (
            <div key={provider}>
              <div className="su__group">{provider} · {list.length}</div>
              {list.map((s) => {
                const added = rows.some((r) => originOf(r.url) === originOf(s.url));
                return (
                  <div key={provider + s.id} className="su__found-row">
                    <span><strong>{s.name}</strong><small>{s.url} · {s.domain ? "custom domain" : s.kind === "site" ? "site" : "server"} · {s.accountName}{s.suspended ? " · suspended" : ""}</small></span>
                    <button type="button" className="btn btn--sm" disabled={added} onClick={() => addFound(s)}>{added ? "Added" : <><Plus size={13} /> Add</>}</button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}

      {/^https?:\/\//i.test(project.repoUrl || "") ? (
        <details className="su__usage" onToggle={(e) => setUsageOpen(e.currentTarget.open)}>
          <summary>Where the code gets its server address</summary>
          {usageOpen ? <ServerUsage projectId={project.id} /> : null}
        </details>
      ) : null}
    </section>
  );
}
