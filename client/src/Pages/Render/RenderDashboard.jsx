import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import { connectRenderAccount, deleteRenderAccount, bulkDeleteRenderServices, getRenderAccounts, getRenderServices, getRenderAudit } from "../../api/client";
import { Modal, StatePill, Skeleton, Empty, Kpi, Section, FleetBar, useConfirm } from "./RenderUi";
import ServiceDetail from "./ServiceDetail";
import { MonitoringView, IncidentsView, AlertPolicyView } from "./OpsViews";
import { usePolling } from "./renderHooks";
import { useOps } from "./useOps";
import {
  SERVICE_KINDS, serviceKind, serviceKey, serviceState, summarizeFleet, filterServices, sortServices, paginate,
  normalizeServices, initials, timeAgo, formatDateTime, safeUrl, readStored, writeStored, errorMessage
} from "./renderUtils";
import "./RenderDashboard.css";

const VIEWS = [["overview", "Overview"], ["services", "Services"], ["monitoring", "Monitoring"], ["incidents", "Incidents"], ["settings", "Settings"]];
const PAGE_SIZE = 15;
const FAV_KEY = "stashr_render_favorites";
const viewFromHash = () => { const h = window.location.hash.replace("#", ""); return VIEWS.some(([id]) => id === h) ? h : "overview"; };

export default function RenderDashboard() {
  const [view, setView] = useState(viewFromHash);
  const [accounts, setAccounts] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [error, setError] = useState("");
  const [audit, setAudit] = useState([]);
  const [auto, setAuto] = useState(() => readStored("stashr_render_auto_refresh", true));

  // inventory
  const [query, setQuery] = useState("");
  const [accountFilter, setAccountFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [hideSuspended, setHideSuspended] = useState(false);
  const [sort, setSort] = useState({ key: "name", dir: "asc" });
  const [page, setPage] = useState(1);
  const [checked, setChecked] = useState([]);
  const [favorites, setFavorites] = useState(() => readStored(FAV_KEY, []));
  const searchRef = useRef(null);

  // modals
  const [selectedKey, setSelectedKey] = useState(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [ask, confirmDialog] = useConfirm();
  const ops = useOps();
  const { refresh: refreshOps } = ops;

  /* ---------- data ---------- */
  const loadAccounts = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const result = await getRenderAccounts();
      const list = Array.isArray(result.accounts) ? result.accounts : [];
      const withServices = await Promise.all(list.map(async (a) => {
        try { const data = await getRenderServices(a.id); return { ...a, services: normalizeServices(data.services), truncated: Boolean(data.truncated) }; }
        catch (e) { return { ...a, services: [], loadError: errorMessage(e, "Could not load services.") }; }
      }));
      setAccounts(withServices);
      setServices(withServices.flatMap((a) => a.services.map((s) => ({ ...s, accountId: a.id, accountName: a.name }))));
      setLastSync(new Date());
      setError("");
    } catch (e) {
      setError(errorMessage(e, "Could not load Render connections. Sign in again if your Stashr session expired."));
    } finally { if (!quiet) setLoading(false); }
  }, []);

  const loadAudit = useCallback(async () => {
    try { const r = await getRenderAudit(50); setAudit(Array.isArray(r.events) ? r.events : []); } catch { /* supplemental */ }
  }, []);

  useEffect(() => { void loadAccounts(); void loadAudit(); void refreshOps(); }, [loadAccounts, loadAudit, refreshOps]);
  usePolling(() => loadAccounts({ quiet: true }), 120000, auto);
  useEffect(() => { writeStored("stashr_render_auto_refresh", auto); }, [auto]);
  useEffect(() => { writeStored(FAV_KEY, favorites); }, [favorites]);

  const refreshAll = async () => {
    setRefreshing(true);
    try { await Promise.all([loadAccounts({ quiet: true }), loadAudit(), refreshOps()]); toast.success("Refreshed."); }
    finally { setRefreshing(false); }
  };

  /* ---------- navigation ---------- */
  const go = useCallback((next) => {
    setView(next);
    if (window.location.hash !== "#" + next) window.history.replaceState(null, "", "#" + next);
  }, []);
  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    document.title = "Render Control Center · Stashr";
    const onKey = (event) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName) || event.target?.isContentEditable;
      if (((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") || (!typing && event.key === "/")) {
        event.preventDefault();
        go("services");
        window.setTimeout(() => searchRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  /* ---------- derived ---------- */
  const fleet = useMemo(() => summarizeFleet(services, ops.incidents), [services, ops.incidents]);
  const nameOf = useCallback((id) => services.find((s) => s.id === id)?.name, [services]);

  const filtered = useMemo(() => {
    const base = filterServices(services, { query, accountId: accountFilter, kind: typeFilter, hideSuspended, favoriteIds: favoriteOnly ? favorites : null });
    const withState = stateFilter === "all" ? base : base.filter((s) => serviceState(s, fleet.incidentKeys) === stateFilter);
    return sortServices(withState, sort.key, sort.dir);
  }, [services, query, accountFilter, typeFilter, stateFilter, hideSuspended, favoriteOnly, favorites, sort, fleet.incidentKeys]);
  const pageData = paginate(filtered, page, PAGE_SIZE);
  useEffect(() => { setPage(1); }, [query, accountFilter, typeFilter, stateFilter, hideSuspended, favoriteOnly]);

  const selected = selectedKey ? services.find((s) => serviceKey(s) === selectedKey) : null;
  const filtersActive = Boolean(query || accountFilter !== "all" || typeFilter !== "all" || stateFilter !== "all" || favoriteOnly || hideSuspended);
  const clearFilters = () => { setQuery(""); setAccountFilter("all"); setTypeFilter("all"); setStateFilter("all"); setFavoriteOnly(false); setHideSuspended(false); };
  const toggleSort = (key) => setSort((old) => (old.key === key ? { key, dir: old.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  const toggleFavorite = (s) => setFavorites((old) => (old.includes(serviceKey(s)) ? old.filter((x) => x !== serviceKey(s)) : [...old, serviceKey(s)]));
  const pageKeys = pageData.rows.map(serviceKey);
  const allOnPage = pageKeys.length > 0 && pageKeys.every((k) => checked.includes(k));
  const toggleChecked = (key) => setChecked((old) => (old.includes(key) ? old.filter((k) => k !== key) : [...old, key]));
  const togglePage = () => setChecked((old) => (allOnPage ? old.filter((k) => !pageKeys.includes(k)) : [...new Set([...old, ...pageKeys])]));

  /* ---------- actions ---------- */
  const connect = async (event) => {
    event.preventDefault();
    if (!apiKey.trim()) return;
    setConnecting(true); setConnectError("");
    try {
      const result = await connectRenderAccount({ name: accountName.trim() || "Render account " + (accounts.length + 1), apiKey: apiKey.trim() });
      const account = { ...result.account, services: normalizeServices(result.services) };
      setAccounts((old) => [...old, account]);
      setServices((old) => [...old, ...account.services.map((s) => ({ ...s, accountId: account.id, accountName: account.name }))]);
      setApiKey(""); setAccountName(""); setShowKey(false); setConnectOpen(false); setLastSync(new Date());
      toast.success("Connected " + account.name + " with " + account.services.length + " services.");
    } catch (e) {
      const message = errorMessage(e, "Could not connect this Render account.");
      setConnectError(message);
    } finally { setConnecting(false); }
  };

  const removeAccount = async (account) => {
    const ok = await ask({ title: "Disconnect " + account.name + "?", message: "Its saved Render API key will be removed from your Stashr account. Server groups that use its services will lose those members.", confirmLabel: "Disconnect", danger: true });
    if (!ok) return;
    try {
      await deleteRenderAccount(account.id);
      setAccounts((old) => old.filter((a) => a.id !== account.id));
      setServices((old) => old.filter((s) => s.accountId !== account.id));
      setChecked((old) => old.filter((k) => !k.startsWith(account.id + ":")));
      if (selected?.accountId === account.id) setSelectedKey(null);
      toast.success("Render connection removed.");
      void refreshOps();
    } catch (e) { toast.error(errorMessage(e, "Could not remove this connection.")); }
  };

  const createGroup = async () => {
    const keys = [...new Set(checked)].filter((k) => services.some((s) => serviceKey(s) === k));
    if (keys.length < 2) { toast.info("Select at least two services to create a group."); return; }
    if (keys.length > 10) { toast.info("A group can contain up to 10 services."); return; }
    if (ops.groups.length >= 10) { toast.info("You can save up to 10 server groups."); return; }
    const name = await ask({ title: "Name this server group", message: keys.length + " services selected. Choose a name such as “Deal Radar”.", confirmLabel: "Create group", input: { placeholder: "Group name", label: "Group name", maxLength: 60 } });
    if (!name) return;
    const group = { id: "group-" + Date.now().toString(36), name: name.slice(0, 60), serviceKeys: keys, dependencies: [] };
    try {
      await ops.persist({ groups: [...ops.groups, group] });
      setSelectedGroupId(group.id); setChecked([]); go("monitoring");
    } catch { /* toast shown */ }
  };

  const checkedSuspended = useMemo(() => services.filter((s) => checked.includes(serviceKey(s)) && s.suspended === "suspended"), [services, checked]);

  const deleteSelectedSuspended = async () => {
    const targets = checkedSuspended;
    if (!targets.length) return;
    const untouched = checked.length - targets.length;
    const ok = await ask({
      title: "Delete " + targets.length + " suspended service" + (targets.length === 1 ? "" : "s") + "?",
      message: targets.map((s) => s.name).join(", ") + ". This permanently deletes them from Render, including deploy history, logs and environment variables, and cannot be undone." + (untouched ? " " + untouched + " selected service" + (untouched === 1 ? " is" : "s are") + " not suspended and will be left untouched." : ""),
      confirmLabel: "Yes, delete", cancelLabel: "No", danger: true
    });
    if (!ok) return;
    setBulkDeleting(true);
    try {
      const result = await bulkDeleteRenderServices(targets.map((s) => ({ accountId: s.accountId, serviceId: s.id })));
      const done = new Set(result.results.filter((r) => r.ok).map((r) => r.accountId + ":" + r.serviceId));
      const failures = result.results.filter((r) => !r.ok);
      setChecked((old) => old.filter((k) => !done.has(k)));
      if (done.size) toast.success("Deleted " + done.size + " service" + (done.size === 1 ? "" : "s") + ".");
      if (failures.length) toast.error(failures.length + " not deleted: " + failures.slice(0, 3).map((f) => (f.name || f.serviceId) + " (" + f.error + ")").join("; ") + (failures.length > 3 ? "…" : ""), { autoClose: 10000 });
      await Promise.all([loadAccounts({ quiet: true }), loadAudit(), refreshOps()]);
    } catch (e) { toast.error(errorMessage(e, "Could not delete the selected services.")); }
    finally { setBulkDeleting(false); }
  };

  const copyToClipboard = async (text) => {
    try { await navigator.clipboard.writeText(text); toast.success("Copied."); } catch { toast.error("Clipboard is not available."); }
  };

  /* ---------- attention list ---------- */
  const attention = useMemo(() => {
    const items = [];
    ops.openIncidents.slice(0, 5).forEach((i) => items.push({ key: "i" + (i.id || i.serviceKey + i.type), tone: "danger", title: i.message || i.type, meta: (i.groupName || "Group") + " · " + (i.serviceName || "Service") + " · " + timeAgo(i.at), onClick: () => go("incidents") }));
    services.filter((s) => s.suspended === "suspended").slice(0, 5).forEach((s) => items.push({ key: "s" + serviceKey(s), tone: "warn", title: s.name + " is suspended", meta: s.accountName + " · " + serviceKind(s), onClick: () => setSelectedKey(serviceKey(s)) }));
    accounts.filter((a) => a.truncated).forEach((a) => items.push({ key: "t" + a.id, tone: "warn", title: a.name + ": inventory is incomplete", meta: "This account has more services than Stashr can list at once.", onClick: () => go("settings") }));
    accounts.filter((a) => a.loadError).forEach((a) => items.push({ key: "a" + a.id, tone: "danger", title: a.name + ": " + a.loadError, meta: "Check the API key in Settings → Connections", onClick: () => go("settings") }));
    if (ops.loadError) items.push({ key: "ops", tone: "warn", title: "Persistent monitoring unavailable", meta: ops.loadError, onClick: () => void refreshOps() });
    return items;
  }, [ops.openIncidents, ops.loadError, services, accounts, go, refreshOps]);

  const counts = { services: services.length, incidents: ops.openIncidents.length };
  const sortHeader = (key, label) => (
    <th scope="col" aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="rd-sortbtn" onClick={() => toggleSort(key)}>{label}<span aria-hidden="true">{sort.key === key ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span></button>
    </th>
  );

  return (
    <main className="rd-page">
      <header className="rd-topbar">
        <div className="rd-shell rd-topbar__inner">
          <div className="rd-topbar__title">
            <div className="rd-eyebrow"><span />INFRASTRUCTURE</div>
            <h1>Render Control Center</h1>
          </div>
          <div className="rd-topbar__tools">
            <span className="rd-sync" role="status" aria-live="polite">{loading ? "Loading…" : lastSync ? "Synced " + timeAgo(lastSync.toISOString()) : "Not synced"}</span>
            <label className="rd-check" title="Refresh the service list every 2 minutes while this tab is visible"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-refresh</label>
            <button type="button" className="rd-btn rd-btn--quiet" onClick={() => void refreshAll()} disabled={refreshing || loading}>{refreshing ? "Refreshing…" : "↻ Refresh"}</button>
            <button type="button" className="rd-btn rd-btn--primary" onClick={() => { setConnectError(""); setConnectOpen(true); }}>＋ Connect account</button>
          </div>
        </div>
        <nav className="rd-shell rd-nav" aria-label="Render control center sections">
          {VIEWS.map(([id, label]) => (
            <button key={id} type="button" className={view === id ? "is-active" : ""} aria-current={view === id ? "page" : undefined} onClick={() => go(id)}>
              {label}
              {id === "services" && services.length > 0 && <b className="rd-badge">{counts.services}</b>}
              {id === "incidents" && counts.incidents > 0 && <b className="rd-badge rd-badge--danger">{counts.incidents}</b>}
            </button>
          ))}
        </nav>
      </header>

      <div className="rd-shell rd-content">
        {error && <div className="rd-alert rd-alert--error" role="alert"><span aria-hidden="true">!</span><div>{error}</div><button type="button" onClick={() => void loadAccounts()}>Retry</button></div>}

        {view === "overview" && (
          <div className="rd-stack">
            <div className="rd-kpis">
              <Kpi label="Services" value={loading ? "–" : fleet.total} hint={accounts.length + " connected account" + (accounts.length === 1 ? "" : "s")} onClick={() => go("services")} />
              <Kpi label="Active" value={loading ? "–" : fleet.active} tone="ok" hint="Listed as not suspended" onClick={() => { clearFilters(); setStateFilter("active"); go("services"); }} />
              <Kpi label="Open incidents" value={ops.openIncidents.length} tone={ops.openIncidents.length ? "danger" : undefined} hint={ops.openIncidents.length ? "Review the timeline" : "None open"} onClick={() => go("incidents")} />
              <Kpi label="Suspended" value={loading ? "–" : fleet.suspended} tone={fleet.suspended ? "warn" : undefined} hint="May need attention" onClick={() => { clearFilters(); setStateFilter("suspended"); go("services"); }} />
            </div>

            <div className="rd-grid">
              <div className="rd-stack">
                <Section title="Fleet status" subtitle="All services across connected accounts">
                  {loading ? <Skeleton lines={3} /> : <>
                    <FleetBar counts={fleet} />
                    <ul className="rd-legend rd-legend--row">
                      {[["active", "Active"], ["incident", "Incident open"], ["suspended", "Suspended"]].map(([k, l]) => <li key={k}><i className={"rd-swatch is-" + k} /><span>{l}</span><small>{fleet[k]}</small></li>)}
                    </ul>
                    {Object.keys(fleet.kinds).length > 0 && <div className="rd-chips">{SERVICE_KINDS.filter((k) => fleet.kinds[k]).map((k) => <button key={k} type="button" className="rd-chip" onClick={() => { clearFilters(); setTypeFilter(k); go("services"); }}>{k}<small>{fleet.kinds[k]}</small></button>)}</div>}
                  </>}
                </Section>

                <Section title="Needs attention" subtitle={attention.length ? attention.length + " item" + (attention.length === 1 ? "" : "s") + " to review" : "Nothing needs your attention"}>
                  {attention.length ? (
                    <ul className="rd-attention">{attention.map((a) => <li key={a.key}><button type="button" className={"is-" + a.tone} onClick={a.onClick}><span className="rd-attention__mark" aria-hidden="true">{a.tone === "danger" ? "!" : "▲"}</span><div><strong>{a.title}</strong><small>{a.meta}</small></div><span aria-hidden="true">›</span></button></li>)}</ul>
                  ) : <Empty icon="✓" title="All clear">No open incidents, suspended services or connection errors.</Empty>}
                </Section>
              </div>

              <div className="rd-stack">
                <Section title="Recent activity" subtitle="Operations performed through Stashr" actions={<button type="button" className="rd-icon-btn" aria-label="Refresh activity" onClick={() => void loadAudit()}>↻</button>}>
                  {audit.length ? <ul className="rd-activity">{audit.slice(0, 8).map((e, i) => <li key={e.id || i}><strong>{String(e.action || "operation").replace(/_/g, " ")}</strong><small>{e.serviceId ? (nameOf(e.serviceId) || e.serviceId.slice(0, 14)) + " · " : ""}{e.at ? timeAgo(e.at) : "recently"}</small></li>)}</ul> : <p className="rd-muted">No audited operations yet.</p>}
                </Section>
                <Section title="Connections" subtitle="Render accounts saved in Stashr" actions={<button type="button" className="rd-icon-btn" aria-label="Add Render account" onClick={() => { setConnectError(""); setConnectOpen(true); }}>＋</button>}>
                  {accounts.length ? <ul className="rd-accounts">{accounts.map((a) => <li key={a.id}><span className="rd-avatar" aria-hidden="true">{initials(a.name)}</span><div><strong>{a.name}</strong><small className={a.loadError ? "rd-warn" : ""}>{a.loadError || a.services.length + " services"}</small></div></li>)}</ul> : <Empty icon="☁" title="No connections yet" action={<button type="button" className="rd-btn rd-btn--primary" onClick={() => setConnectOpen(true)}>Connect Render</button>}>Add a Render API key to see services here.</Empty>}
                </Section>
              </div>
            </div>
          </div>
        )}

        {view === "services" && (
          <Section title="Service inventory" subtitle={"Showing " + filtered.length + " of " + services.length + " services"} className="rd-card--flush"
            actions={<a className="rd-btn rd-btn--quiet" href="https://dashboard.render.com" target="_blank" rel="noreferrer noopener">Open Render ↗</a>}>
            <div className="rd-toolbar">
              <label className="rd-search"><span aria-hidden="true">⌕</span><input ref={searchRef} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, region, branch, repo…  ( / or Ctrl+K )" aria-label="Search services" /></label>
              <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} aria-label="Filter by account"><option value="all">All accounts</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filter by type"><option value="all">All types</option>{SERVICE_KINDS.map((t) => <option key={t}>{t}</option>)}</select>
              <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} aria-label="Filter by status"><option value="all">Any status</option><option value="active">Active</option><option value="incident">Incident open</option><option value="suspended">Suspended</option></select>
              <button type="button" className={"rd-btn rd-btn--quiet" + (favoriteOnly ? " is-active" : "")} aria-pressed={favoriteOnly} onClick={() => setFavoriteOnly((v) => !v)}>{favoriteOnly ? "★" : "☆"} Favorites</button>
              <label className="rd-check"><input type="checkbox" checked={hideSuspended} onChange={(e) => setHideSuspended(e.target.checked)} /> Hide suspended</label>
              {filtersActive && <button type="button" className="rd-btn rd-btn--link" onClick={clearFilters}>Clear filters</button>}
            </div>
            {checked.length > 0 && (
              <div className="rd-selectbar" role="region" aria-label="Selection actions">
                <strong>{checked.length} selected</strong>
                <button type="button" className="rd-btn rd-btn--primary" disabled={checked.length < 2} onClick={() => void createGroup()}>＋ Group selected</button>
                <button type="button" className="rd-btn rd-btn--danger-quiet" disabled={!checkedSuspended.length || bulkDeleting} title={checkedSuspended.length ? "Permanently delete the selected suspended services" : "Select at least one suspended service"} onClick={() => void deleteSelectedSuspended()}>{bulkDeleting ? "Deleting…" : "🗑 Delete suspended (" + checkedSuspended.length + ")"}</button>
                <button type="button" className="rd-btn rd-btn--link" onClick={() => setChecked([])}>Clear</button>
                {checked.length < 2 && <small>Select at least 2 services to create a group.</small>}
              </div>
            )}
            <div className="rd-tablewrap">
              <table className="rd-table">
                <thead><tr>
                  <th scope="col" className="rd-col-check"><input type="checkbox" checked={allOnPage} onChange={togglePage} aria-label="Select all services on this page" /></th>
                  {sortHeader("name", "Service")}{sortHeader("account", "Account")}{sortHeader("type", "Type")}{sortHeader("region", "Region")}{sortHeader("status", "Status")}{sortHeader("updated", "Updated")}
                  <th scope="col"><span className="rd-sr">Actions</span></th>
                </tr></thead>
                <tbody>
                  {loading && Array.from({ length: 5 }, (_, i) => <tr key={"sk" + i} aria-hidden="true"><td colSpan="8"><Skeleton lines={1} height={22} /></td></tr>)}
                  {!loading && pageData.rows.map((s) => {
                    const key = serviceKey(s), state = serviceState(s, fleet.incidentKeys), fav = favorites.includes(key);
                    return (
                      <tr key={key} className={checked.includes(key) ? "is-checked" : ""} onClick={() => setSelectedKey(key)}>
                        <td className="rd-col-check" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={checked.includes(key)} onChange={() => toggleChecked(key)} aria-label={"Select " + s.name} /></td>
                        <td><button type="button" className="rd-svc" onClick={(e) => { e.stopPropagation(); setSelectedKey(key); }}><span className="rd-svc__icon" aria-hidden="true">{serviceKind(s) === "PostgreSQL" ? "▤" : "▣"}</span><span><strong>{s.name}</strong><small className="rd-mono">{s.id}{s.branch ? " · " + s.branch : ""}</small></span></button></td>
                        <td><span className="rd-account"><i aria-hidden="true">{initials(s.accountName)}</i>{s.accountName}</span></td>
                        <td>{serviceKind(s)}</td>
                        <td>{s.serviceDetails?.region || "—"}</td>
                        <td><StatePill state={state} /></td>
                        <td title={formatDateTime(s.updatedAt)}>{timeAgo(s.updatedAt)}</td>
                        <td className="rd-col-actions" onClick={(e) => e.stopPropagation()}>
                          <button type="button" className={"rd-icon-btn" + (fav ? " is-on" : "")} aria-pressed={fav} aria-label={(fav ? "Unfavorite " : "Favorite ") + s.name} onClick={() => toggleFavorite(s)}>{fav ? "★" : "☆"}</button>
                          <button type="button" className="rd-icon-btn" aria-label={"Copy ID of " + s.name} title="Copy service ID" onClick={() => void copyToClipboard(s.id)}>⧉</button>
                          <a className="rd-icon-btn" href={safeUrl(s.dashboardUrl)} target="_blank" rel="noreferrer noopener" aria-label={"Open " + s.name + " in Render"}>↗</a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!loading && !pageData.rows.length && (
                <Empty icon="▣" title={services.length ? "No matching services" : "Your control center is ready"}
                  action={services.length ? (filtersActive && <button type="button" className="rd-btn rd-btn--quiet" onClick={clearFilters}>Clear filters</button>) : <button type="button" className="rd-btn rd-btn--primary" onClick={() => setConnectOpen(true)}>＋ Connect your first account</button>}>
                  {services.length ? "Try changing your search or filters." : "Connect a Render API key to get started. The key is stored encrypted in your Stashr account."}
                </Empty>
              )}
            </div>
            <footer className="rd-pager">
              <span>{filtered.length ? (pageData.page - 1) * PAGE_SIZE + 1 + "–" + Math.min(pageData.page * PAGE_SIZE, filtered.length) + " of " + filtered.length : "0 results"}</span>
              <div>
                <button type="button" className="rd-btn rd-btn--quiet" disabled={pageData.page <= 1} onClick={() => setPage(pageData.page - 1)}>‹ Prev</button>
                <span aria-live="polite">Page {pageData.page} / {pageData.pages}</span>
                <button type="button" className="rd-btn rd-btn--quiet" disabled={pageData.page >= pageData.pages} onClick={() => setPage(pageData.page + 1)}>Next ›</button>
              </div>
            </footer>
          </Section>
        )}

        {view === "monitoring" && (
          <MonitoringView services={services} ops={ops} selectedGroupId={selectedGroupId} onSelectGroup={setSelectedGroupId} askConfirm={ask}
            onOpenService={(s) => setSelectedKey(serviceKey(s))} onRefreshServices={() => loadAccounts({ quiet: true })} onAudit={loadAudit} onGoServices={() => go("services")} />
        )}

        {view === "incidents" && <IncidentsView ops={ops} onSample={() => void ops.sampleNow()} />}

        {view === "settings" && (
          <div className="rd-stack">
            <Section title="Connections" subtitle="Render API keys are encrypted in your Stashr vault and never returned to the browser."
              actions={<button type="button" className="rd-btn rd-btn--primary" onClick={() => { setConnectError(""); setConnectOpen(true); }}>＋ Connect account</button>}>
              {accounts.length ? <ul className="rd-accounts rd-accounts--wide">{accounts.map((a) => (
                <li key={a.id}><span className="rd-avatar" aria-hidden="true">{initials(a.name)}</span><div><strong>{a.name}</strong><small className={a.loadError ? "rd-warn" : ""}>{a.loadError || a.services.length + " services"}{a.lastValidatedAt ? " · validated " + timeAgo(a.lastValidatedAt) : ""}</small></div><button type="button" className="rd-btn rd-btn--danger-quiet" onClick={() => void removeAccount(a)}>Disconnect</button></li>
              ))}</ul> : <Empty icon="☁" title="No connections yet" action={<button type="button" className="rd-btn rd-btn--primary" onClick={() => setConnectOpen(true)}>Connect Render</button>}>Add a Render API key to begin.</Empty>}
            </Section>
            <AlertPolicyView ops={ops} askConfirm={ask} />
          </div>
        )}
      </div>

      {connectOpen && (
        <Modal labelledBy="rd-connect-title" onClose={() => setConnectOpen(false)} className="rd-dialog--sm">
          <h2 id="rd-connect-title" className="rd-dialog__title">Connect Render</h2>
          <p className="rd-dialog__body">Enter a Render API key. Stashr validates it, then stores it encrypted with your account’s vault data key.</p>
          <form onSubmit={connect} className="rd-form">
            <label>Account name <small>optional</small><input className="rd-field" value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="e.g. Production" maxLength={80} /></label>
            <label>Render API key
              <div className="rd-keywrap">
                <input data-autofocus className="rd-field" type={showKey ? "text" : "password"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="rnd_…" autoComplete="off" spellCheck="false" required />
                <button type="button" onClick={() => setShowKey((v) => !v)} aria-pressed={showKey}>{showKey ? "Hide" : "Show"}</button>
              </div>
            </label>
            <p className="rd-note">Your key is sent only to your authenticated Stashr backend for validation and encrypted storage.</p>
            {connectError && <div className="rd-alert rd-alert--error" role="alert"><span aria-hidden="true">!</span><div>{connectError}</div></div>}
            <div className="rd-dialog__actions">
              <button type="button" className="rd-btn rd-btn--quiet" onClick={() => setConnectOpen(false)}>Cancel</button>
              <button type="submit" className="rd-btn rd-btn--primary" disabled={connecting || !apiKey.trim()}>{connecting ? "Validating…" : "Validate & connect"}</button>
            </div>
          </form>
        </Modal>
      )}

      {selected && (
        <ServiceDetail key={serviceKey(selected)} service={selected} services={services} incidentKeys={fleet.incidentKeys} opsConfig={ops.config}
          askConfirm={ask} isFavorite={favorites.includes(serviceKey(selected))} onToggleFavorite={() => toggleFavorite(selected)}
          onClose={() => setSelectedKey(null)} onOpenService={(s) => setSelectedKey(serviceKey(s))}
          onRefresh={() => loadAccounts({ quiet: true })} onAudit={loadAudit} />
      )}
      {confirmDialog}
    </main>
  );
}
