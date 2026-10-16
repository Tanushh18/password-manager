import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { Arrow, Trash } from "../../Components/Icons/Icons";
import * as api from "../../api/client";
import "./Servers.css";

import MascotBanner from "../../Components/Robot/MascotBanner";
import { registryMood } from "../../lib/pageMoods";
/* One app's editable URL list. Saving updates the registry; apps pick it up the next time they start. */
const ago = (value) => {
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return "";
  const m = Math.max(0, Math.floor((Date.now() - t) / 60000));
  return m < 1 ? "just now" : m < 60 ? m + "m ago" : m < 1440 ? Math.floor(m / 60) + "h ago" : Math.floor(m / 1440) + "d ago";
};

/** What Render says about one registry URL. Automatic: matched by hostname, no setup. */
function RenderTag({ item, willRemove }) {
  if (!item) return null;
  if (item.kind === "external") return <span className="servers__render servers__render--muted">Custom domain</span>;
  if (item.kind === "unmatched") return <span className="servers__render servers__render--muted" title="Not found in the Render accounts connected to Stashr">Not in connected Render</span>;
  const s = item.service;
  const deploy = s.lastDeploy ? " · deploy " + s.lastDeploy.status.replace(/_/g, " ") + (s.lastDeploy.at ? " " + ago(s.lastDeploy.at) : "") : "";
  return (
    <span className={"servers__render servers__render--" + s.state} title={s.name + " · " + s.accountName}>
      Render · {s.state === "active" ? "Active" : "Suspended"}{s.plan ? " · " + s.plan : ""}{s.region ? " · " + s.region : ""}{deploy}
      {willRemove ? " · will be removed automatically" : ""}
    </span>
  );
}

function AppCard({ entry, sync, onSaved, onSyncChanged }) {
  const [urls, setUrls] = useState(entry.urls);
  const [draft, setDraft] = useState("");
  const [health, setHealth] = useState({}); // url -> { state, ms }
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(urls) !== JSON.stringify(entry.urls);
  // Optimistic: flip immediately, roll back only if the server refuses.
  const [autoOn, setAutoOn] = useState(sync?.autoSync ?? true);
  useEffect(() => { setAutoOn(sync?.autoSync ?? true); }, [sync?.autoSync]);

  const test = useCallback(async (url) => {
    setHealth((h) => ({ ...h, [url]: { state: "checking" } }));
    try {
      const res = await api.checkServer(url);
      setHealth((h) => ({ ...h, [url]: { state: res.data.ok ? "up" : "down", ms: res.data.ms } }));
    } catch (err) {
      setHealth((h) => ({ ...h, [url]: { state: "down" } }));
    }
  }, []);

  const add = () => {
    const url = draft.trim().replace(/\/+$/, "");
    if (!url) return;
    if (!/^https:\/\//i.test(url)) return toast.error("Use a full https:// address.");
    if (urls.includes(url)) return toast.info("That URL is already in the list.");
    setUrls([...urls, url]);
    setDraft("");
  };

  const move = (i, by) => {
    const next = [...urls];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setUrls(next);
  };

  const toggleAuto = async (enabled) => {
    setAutoOn(enabled);
    try { await api.setRegistryAutoSync(entry.app, enabled); toast.success(enabled ? "Auto-sync on." : "Auto-sync off."); onSyncChanged(); }
    catch (err) { setAutoOn(!enabled); toast.error(api.errorMessage(err, "Could not change auto-sync.")); }
  };

  // One click: add a discovered Render service and save immediately.
  const addSuggested = async (url) => {
    if (dirty) return toast.info("Save or discard your edits first.");
    setSaving(true);
    try {
      const res = await api.saveRegistry(entry.app, [...entry.urls, url]);
      toast.success("Added " + url);
      onSaved(entry.app, res.data.urls);
      onSyncChanged();
    } catch (err) { toast.error(api.errorMessage(err, "Could not add.")); }
    finally { setSaving(false); }
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.saveRegistry(entry.app, urls);
      toast.success(`${entry.label} servers saved.`);
      onSaved(entry.app, res.data.urls);
    } catch (err) {
      toast.error(api.errorMessage(err, "Could not save."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card servers__card">
      <header className="servers__head">
        <h2>{entry.label}</h2>
        <span className="servers__hint">First URL is tried first; the rest are backups.</span>
      </header>

      <ul className="servers__list">
        {urls.map((url, i) => {
          const h = health[url];
          const item = sync?.items?.find((i) => i.url === url);
          return (
            <li key={url} className="servers__row">
              <span className={`servers__dot servers__dot--${h?.state || "idle"}`} title={h?.state || "not tested"} />
              <code className="servers__url">{url}</code>
              {h?.state === "up" && <span className="servers__ms">{h.ms} ms</span>}
              {h?.state === "down" && <span className="servers__ms servers__ms--bad">down</span>}
              {sync ? <RenderTag item={item} willRemove={autoOn && sync.willRemove?.includes(url)} /> : null}
              <span className="servers__tools">
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => test(url)} disabled={h?.state === "checking"}>
                  {h?.state === "checking" ? "Testing…" : "Test"}
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => move(i, 1)} disabled={i === urls.length - 1} aria-label="Move down">↓</button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setUrls(urls.filter((u) => u !== url))} aria-label="Remove">
                  <Trash size={14} />
                </button>
              </span>
            </li>
          );
        })}
      </ul>

      {sync?.renderConnected ? (
        <div className="servers__sync">
          <label className="servers__auto">
            <input type="checkbox" checked={autoOn} onChange={(e) => void toggleAuto(e.target.checked)} />
            Keep in sync with Render automatically
          </label>
          <span className="servers__hint">Suspended Render servers are dropped from this list in the background — never the last working one. Custom domains are never touched.</span>
          {sync.add?.length ? (
            <div className="servers__suggest">
              <strong>Found on Render</strong>
              {sync.add.map((a) => (
                <div key={a.url} className="servers__suggest-row">
                  <code>{a.url}</code><span className="servers__hint">{a.name}{a.accountName ? " · " + a.accountName : ""}</span>
                  <button type="button" className="btn btn--ghost btn--sm" disabled={saving} onClick={() => void addSuggested(a.url)}>Add</button>
                </div>
              ))}
            </div>
          ) : null}
          {sync.log?.length ? (
            <ul className="servers__log" aria-label="Recent automatic changes">
              {sync.log.map((l, i) => <li key={i}><code>{l.url}</code> {l.action} · {l.reason} · {ago(l.at)}</li>)}
            </ul>
          ) : null}
        </div>
      ) : sync ? <p className="servers__hint">Connect a Render account on the Render page and this list syncs with it automatically.</p> : null}

      <div className="servers__add">
        <input
          className="input"
          value={draft}
          placeholder="https://new-server.onrender.com"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button type="button" className="btn btn--ghost btn--sm" onClick={add}>Add</button>
      </div>

      <div className="servers__foot">
        <button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={!dirty || saving || urls.length === 0}>
          {saving ? "Saving…" : "Save"}
        </button>
        {dirty && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setUrls(entry.urls)}>Discard</button>}
        {!entry.saved && <span className="servers__hint">Showing the built-in defaults — nothing saved yet.</span>}
      </div>
    </section>
  );
}

export default function Servers() {
  const [apps, setApps] = useState(null);
  const [sync, setSync] = useState({}); // app -> Render sync info (automatic; optional)
  const [error, setError] = useState("");

  const loadSync = useCallback((refresh = false) => {
    api.getRegistrySync({ refresh })
      .then((data) => setSync(Object.fromEntries((data.apps || []).map((a) => [a.app, a]))))
      .catch(() => { /* sync info is optional; the list still works */ });
  }, []);

  useEffect(() => {
    api.getRegistry()
      .then((res) => setApps(res.data.apps))
      .catch((err) => setError(api.errorMessage(err, "Could not load the server list.")));
    loadSync();
  }, [loadSync]);

  const onSaved = (app, urls) =>
    setApps((list) => list.map((a) => (a.app === app ? { ...a, urls, saved: true } : a)));

  return (
    <div className="servers page">
      <div className="shell-narrow">
        <header className="settings__top">
          <Link to="/settings" className="proj-back">
            <Arrow size={14} style={{ transform: "rotate(180deg)" }} /> Settings
          </Link>
          <h1 className="vault__title">Server URLs</h1>
          <p className="vault__count">
            Change a backend URL here and every app picks it up the next time it starts — no code change, no redeploy.
          </p>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => loadSync(true)}>↻ Refresh Render sync</button>
        </header>

        {apps && <MascotBanner kind="satellite" {...registryMood(apps)} />}
        {error && <p className="servers__error">{error}</p>}
        {!apps && !error && <p className="servers__hint">Loading…</p>}
        {apps && (
          <div className="servers__grid">
            {apps.map((entry) => (
              <AppCard key={entry.app + entry.urls.join("|")} entry={entry} sync={sync[entry.app]} onSaved={onSaved} onSyncChanged={loadSync} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
