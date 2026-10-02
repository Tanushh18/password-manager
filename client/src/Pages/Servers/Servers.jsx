import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { Arrow, Trash } from "../../Components/Icons/Icons";
import * as api from "../../api/client";
import "./Servers.css";

/* One app's editable URL list. Saving updates the registry; apps pick it up the next time they start. */
function AppCard({ entry, onSaved }) {
  const [urls, setUrls] = useState(entry.urls);
  const [draft, setDraft] = useState("");
  const [health, setHealth] = useState({}); // url -> { state, ms }
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(urls) !== JSON.stringify(entry.urls);

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
          return (
            <li key={url} className="servers__row">
              <span className={`servers__dot servers__dot--${h?.state || "idle"}`} title={h?.state || "not tested"} />
              <code className="servers__url">{url}</code>
              {h?.state === "up" && <span className="servers__ms">{h.ms} ms</span>}
              {h?.state === "down" && <span className="servers__ms servers__ms--bad">down</span>}
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
  const [error, setError] = useState("");

  useEffect(() => {
    api.getRegistry()
      .then((res) => setApps(res.data.apps))
      .catch((err) => setError(api.errorMessage(err, "Could not load the server list.")));
  }, []);

  const onSaved = (app, urls) =>
    setApps((list) => list.map((a) => (a.app === app ? { ...a, urls, saved: true } : a)));

  return (
    <div className="servers page">
      <div className="shell-narrow">
        <header className="settings__top">
          <Link to="/settings" className="proj-back">
            <Arrow size={14} style={{ transform: "rotate(180deg)" }} /> Settings
          </Link>
          <h1 className="vault__title">Servers</h1>
          <p className="vault__count">
            Change a backend URL here and every app picks it up the next time it starts — no code change, no redeploy.
          </p>
        </header>

        {error && <p className="servers__error">{error}</p>}
        {!apps && !error && <p className="servers__hint">Loading…</p>}
        {apps && (
          <div className="servers__grid">
            {apps.map((entry) => (
              <AppCard key={entry.app + entry.urls.join("|")} entry={entry} onSaved={onSaved} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
