import React, { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { getStatusPage, saveStatusPage, getStatusPageServices, publicApiBase } from "../../api/client";

/* Public status page: the owner picks an address and the services to show. Only names and running / suspended are public. */
export default function StatusPageCard() {
  const [page, setPage] = useState(null);
  const [services, setServices] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getStatusPage().then(setPage).catch(() => setPage({ slug: "", enabled: false, title: "", serviceIds: [] }));
    getStatusPageServices().then((r) => setServices(r.services || [])).catch(() => setServices([]));
  }, []);

  if (!page) return null;

  const set = (patch) => setPage((p) => ({ ...p, ...patch }));
  const toggle = (id) => set({ serviceIds: page.serviceIds.includes(id) ? page.serviceIds.filter((x) => x !== id) : [...page.serviceIds, id] });

  const save = () => {
    setBusy(true);
    saveStatusPage({ slug: page.slug, title: page.title, enabled: page.enabled, serviceIds: page.serviceIds })
      .then(() => toast.success(page.enabled ? "Status page is live." : "Saved."))
      .catch((e) => toast.error(e?.response?.data?.error || "Could not save the status page."))
      .finally(() => setBusy(false));
  };

  const link = page.slug ? `${publicApiBase}/status/${page.slug}` : "";

  return (
    <section className="sv-secrets" aria-label="Public status page">
      <header>
        <h2>Public status page</h2>
        <label><input type="checkbox" checked={page.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> On</label>
      </header>
      <small>Shows the services you pick with running or suspended. No URLs, env vars or accounts.</small>
      <div className="sv-status__form">
        <input placeholder="address, e.g. wecode-status" value={page.slug} onChange={(e) => set({ slug: e.target.value.toLowerCase() })} />
        <input placeholder="title" value={page.title} onChange={(e) => set({ title: e.target.value })} />
      </div>
      <ul className="sv-status__services">
        {services.map((s) => (
          <li key={s.id}>
            <label><input type="checkbox" checked={page.serviceIds.includes(s.id)} onChange={() => toggle(s.id)} /> {s.name}{s.suspended ? " (suspended)" : ""}</label>
          </li>
        ))}
      </ul>
      <div className="sv-status__actions">
        <button type="button" className="btn btn--sm" onClick={save} disabled={busy || !page.slug}>{busy ? "Saving…" : "Save"}</button>
        {page.enabled && link && <a href={link} target="_blank" rel="noreferrer">Open {link}</a>}
      </div>
    </section>
  );
}
