import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import {
  connectRenderAccount, deleteRenderAccount, getRenderAccounts, getRenderDeploys,
  getRenderEnvVars, getRenderLogs, getRenderServices, restartRenderService,
  triggerRenderDeploy, updateRenderEnvVar, deleteRenderEnvVar
} from "../../api/client";
import "./RenderDashboard.css";

const serviceKind = (s) => {
  const t = String(s.type || "").toLowerCase();
  if (t.includes("static")) return "Static site";
  if (t.includes("private")) return "Private service";
  if (t.includes("cron")) return "Cron job";
  if (t.includes("postgres")) return "PostgreSQL";
  if (t.includes("worker")) return "Background worker";
  return "Web service";
};
const normalizeServices = (payload) => (Array.isArray(payload) ? payload : [])
  .map((entry) => entry?.service || entry)
  .filter((s) => s?.id)
  .map((s) => ({ ...s, ownerId: s.ownerId || s.owner?.id }));
const normalizeList = (payload, key) => Array.isArray(payload) ? payload.map((x) => x?.[key] || x).filter(Boolean) : [];
const initials = (value) => String(value || "R").split(/[\s-_]+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join("").toUpperCase();
const timeAgo = (value) => {
  if (!value) return "—";
  const mins = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (!Number.isFinite(mins)) return "—";
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  if (mins < 1440) return Math.floor(mins / 60) + "h ago";
  return Math.floor(mins / 1440) + "d ago";
};
const dashboardUrl = (s) => s.dashboardUrl || "https://dashboard.render.com/web/" + s.id;

export default function RenderDashboard() {
  const [accounts, setAccounts] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [accountFilter, setAccountFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [modal, setModal] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState("overview");
  const [logs, setLogs] = useState([]);
  const [logType, setLogType] = useState("app");
  const [logSearch, setLogSearch] = useState("");
  const [envVars, setEnvVars] = useState([]);
  const [envSearch, setEnvSearch] = useState("");
  const [showEnvValues, setShowEnvValues] = useState(false);
  const [envBusy, setEnvBusy] = useState(false);
  const [deploys, setDeploys] = useState([]);
  const [detailBusy, setDetailBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [newEnv, setNewEnv] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [lastSync, setLastSync] = useState(null);

  const loadAccounts = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const result = await getRenderAccounts();
      const list = Array.isArray(result.accounts) ? result.accounts : [];
      const withServices = await Promise.all(list.map(async (a) => {
        try {
          const data = await getRenderServices(a.id);
          return { ...a, services: normalizeServices(data.services) };
        } catch (e) {
          return { ...a, services: [], loadError: e?.response?.data?.error || "Could not load services." };
        }
      }));
      setAccounts(withServices);
      setServices(withServices.flatMap((a) => a.services.map((s) => ({ ...s, accountId: a.id, accountName: a.name }))));
      setLastSync(new Date());
    } catch (e) {
      setError(e?.response?.data?.error || "Could not load Render connections. Sign in again if your Stashr session expired.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);

  const filtered = useMemo(() => services.filter((s) => {
    const haystack = [s.name, s.type, s.serviceDetails?.region, s.accountName, s.branch].join(" ").toLowerCase();
    return haystack.includes(query.toLowerCase())
      && (accountFilter === "all" || s.accountId === accountFilter)
      && (typeFilter === "all" || serviceKind(s) === typeFilter);
  }), [services, query, accountFilter, typeFilter]);

  const selectedAccount = selected ? accounts.find((a) => a.id === selected.accountId) : null;

  const refreshServices = async () => {
    setRefreshing(true);
    try {
      await loadAccounts(true);
      setNotice("Render services refreshed.");
    } catch (e) {
      setError(e?.response?.data?.error || "Refresh failed.");
    } finally { setRefreshing(false); }
  };

  const connect = async (event) => {
    event.preventDefault();
    if (!apiKey.trim()) return;
    setConnecting(true); setError(""); setNotice("");
    try {
      const result = await connectRenderAccount({ name: accountName.trim() || "Render account " + (accounts.length + 1), apiKey: apiKey.trim() });
      const account = { ...result.account, services: normalizeServices(result.services) };
      setAccounts((old) => [...old, account]);
      setServices((old) => [...old, ...account.services.map((s) => ({ ...s, accountId: account.id, accountName: account.name }))]);
      setApiKey(""); setAccountName(""); setShowKey(false); setModal(false);
      setLastSync(new Date());
      setNotice("Connected " + account.name + " with " + account.services.length + " services.");
      toast.success("Render account connected");
    } catch (e) {
      const message = e?.response?.data?.error || "Could not connect this Render account.";
      setError(message);
      toast.error(message);
    } finally { setConnecting(false); }
  };

  const removeAccount = async (account) => {
    if (!window.confirm("Disconnect " + account.name + "? Its saved Render API key will be removed from your Stashr account.")) return;
    try {
      await deleteRenderAccount(account.id);
      setAccounts((old) => old.filter((a) => a.id !== account.id));
      setServices((old) => old.filter((s) => s.accountId !== account.id));
      if (selected?.accountId === account.id) setSelected(null);
      toast.success("Render connection removed");
    } catch (e) { toast.error(e?.response?.data?.error || "Could not remove this connection."); }
  };

  const openService = (service) => {
    setSelected(service); setTab("overview"); setLogs([]); setDeploys([]); setEnvVars([]);
    setLogSearch(""); setEnvSearch(""); setError(""); setNewEnv(false);
  };

  const loadLogs = useCallback(async (service = selected, type = logType) => {
    if (!service || !service.ownerId) {
      if (service) setError("Render did not include the owner ID required to query logs for this service.");
      return;
    }
    setDetailBusy(true);
    try {
      const end = new Date();
      const start = new Date(end.getTime() - 60 * 60 * 1000);
      const result = await getRenderLogs(service.accountId, {
        ownerId: service.ownerId, resource: service.id, startTime: start.toISOString(),
        endTime: end.toISOString(), direction: "backward", limit: "100", type
      });
      setLogs(Array.isArray(result.logs) ? result.logs : []);
      setError("");
    } catch (e) { setError(e?.response?.data?.error || "Could not load logs."); }
    finally { setDetailBusy(false); }
  }, [selected, logType]);

  const loadEnv = async (service = selected) => {
    if (!service) return;
    setEnvBusy(true); setError("");
    try {
      const result = await getRenderEnvVars(service.accountId, service.id);
      setEnvVars(normalizeList(result, "envVar").map((v) => ({ key: v.key || "", value: v.value || "", originalValue: v.value || "", isNew: false })).filter((v) => v.key));
    } catch (e) { setError(e?.response?.data?.error || "Could not load environment variables."); }
    finally { setEnvBusy(false); }
  };

  const loadDeployments = async (service = selected) => {
    if (!service) return;
    setDetailBusy(true); setError("");
    try {
      const result = await getRenderDeploys(service.accountId, service.id);
      setDeploys(normalizeList(result, "deploy"));
    } catch (e) { setError(e?.response?.data?.error || "Could not load deployment history."); }
    finally { setDetailBusy(false); }
  };

  const changeTab = (next) => {
    setTab(next); setError("");
    if (next === "logs") void loadLogs(selected, logType);
    if (next === "env") void loadEnv(selected);
    if (next === "deploys") void loadDeployments(selected);
  };

  useEffect(() => {
    if (!selected || tab !== "logs") return undefined;
    const timer = window.setInterval(() => { void loadLogs(selected, logType); }, 15000);
    return () => window.clearInterval(timer);
  }, [selected?.id, selected?.accountId, selected?.ownerId, tab, logType, loadLogs]);

  const saveEnv = async () => {
    if (!selected) return;
    const changed = envVars.filter((v) => v.isNew || v.value !== v.originalValue);
    if (!changed.length) { toast.info("No environment variable changes to save."); return; }
    if (!window.confirm("Save " + changed.length + " environment variable change(s) for " + selected.name + "? A deploy may be needed for changes to take effect.")) return;
    setActionBusy(true);
    try {
      for (const item of changed) await updateRenderEnvVar(selected.accountId, selected.id, item.key, item.value);
      await loadEnv(selected);
      toast.success("Environment variables saved. Deploy if required.");
    } catch (e) { setError(e?.response?.data?.error || "Could not save environment variables."); }
    finally { setActionBusy(false); }
  };

  const removeEnv = async (item) => {
    if (item.isNew) { setEnvVars((old) => old.filter((v) => v.key !== item.key)); return; }
    if (!window.confirm("Permanently delete environment variable " + item.key + "?")) return;
    setActionBusy(true);
    try {
      await deleteRenderEnvVar(selected.accountId, selected.id, item.key);
      setEnvVars((old) => old.filter((v) => v.key !== item.key));
      toast.success("Environment variable deleted.");
    } catch (e) { setError(e?.response?.data?.error || "Could not delete this variable."); }
    finally { setActionBusy(false); }
  };

  const addEnv = (event) => {
    event.preventDefault();
    const key = newKey.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || envVars.some((v) => v.key === key)) {
      setError("Enter a valid unique environment variable name."); return;
    }
    setEnvVars((old) => [...old, { key, value: newValue, originalValue: "", isNew: true }]);
    setNewKey(""); setNewValue(""); setNewEnv(false);
  };

  const deploy = async (clearCache = false) => {
    if (!selected || !window.confirm((clearCache ? "Deploy with cache cleared" : "Deploy latest commit") + " for " + selected.name + "?")) return;
    setActionBusy(true);
    try {
      await triggerRenderDeploy(selected.accountId, selected.id, clearCache);
      toast.success("Deployment triggered.");
      await loadDeployments(selected);
      setTab("deploys");
    } catch (e) { setError(e?.response?.data?.error || "Could not trigger deployment."); }
    finally { setActionBusy(false); }
  };

  const restart = async () => {
    if (!selected || serviceKind(selected) === "Cron job") return;
    if (!window.confirm("Restart " + selected.name + "? This may briefly interrupt the service.")) return;
    setActionBusy(true);
    try { await restartRenderService(selected.accountId, selected.id); toast.success("Restart requested."); }
    catch (e) { setError(e?.response?.data?.error || "Could not restart service."); }
    finally { setActionBusy(false); }
  };

  const suspended = services.filter((s) => s.suspended === "suspended").length;

  return (
    <main className="rd-page">
      <div className="rd-shell">
        <header className="rd-heading">
          <div>
            <div className="rd-eyebrow"><span /> STASHr · INFRASTRUCTURE</div>
            <h1>Render <em>Control Center</em></h1>
            <p>Manage Render services, logs, environment variables and deployments from your Stashr vault.</p>
          </div>
          <div className="rd-heading-actions">
            <button className="rd-btn rd-btn--quiet" onClick={refreshServices} disabled={refreshing || loading}>{refreshing ? "Refreshing…" : "↻ Refresh"}</button>
            <button className="rd-btn rd-btn--primary" onClick={() => { setModal(true); setError(""); }}>＋ Connect account</button>
          </div>
        </header>

        {error && <div className="rd-alert rd-alert--error"><span>!</span><div>{error}</div><button onClick={() => setError("")}>×</button></div>}
        {notice && <div className="rd-alert rd-alert--success"><span>✓</span><div>{notice}</div><button onClick={() => setNotice("")}>×</button></div>}

        <section className="rd-stats">
          <article className="rd-stat rd-stat--accent"><span>Total services</span><strong>{String(services.length).padStart(2, "0")}</strong><small>{accounts.length} connected account{accounts.length === 1 ? "" : "s"}</small></article>
          <article className="rd-stat"><span>Not suspended</span><strong>{String(services.length - suspended).padStart(2, "0")}</strong><small><i className="rd-dot rd-dot--green" /> Services listed as active</small></article>
          <article className="rd-stat"><span>Suspended</span><strong>{String(suspended).padStart(2, "0")}</strong><small><i className="rd-dot rd-dot--amber" /> May need attention</small></article>
          <article className="rd-stat"><span>Last sync</span><strong className="rd-stat__sync">{lastSync ? lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</strong><small>{loading ? "Loading your connections…" : "Authenticated with Stashr"}</small></article>
        </section>

        <section className="rd-layout">
          <div className="rd-panel rd-services">
            <div className="rd-panel-head"><div><h2>Service inventory <b>{filtered.length}</b></h2><p>Search and filter all connected Render workspaces.</p></div><a href="https://dashboard.render.com" target="_blank" rel="noreferrer">Open Render ↗</a></div>
            <div className="rd-toolbar">
              <label className="rd-search"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search services, regions, branches…" /><button onClick={() => setQuery("")} aria-label="Clear search">×</button></label>
              <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} aria-label="Filter by account"><option value="all">All accounts</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filter by service type"><option value="all">All types</option>{["Web service", "Static site", "Private service", "Cron job", "Background worker", "PostgreSQL"].map((t) => <option key={t}>{t}</option>)}</select>
            </div>
            <div className="rd-table-wrap"><table className="rd-table"><thead><tr><th>Service</th><th>Account</th><th>Type</th><th>Region</th><th>Status</th><th /></tr></thead><tbody>
              {filtered.map((s) => <tr key={s.accountId + s.id} onClick={() => openService(s)}><td><div className="rd-service-cell"><span className="rd-service-icon">{serviceKind(s) === "PostgreSQL" ? "▤" : "▣"}</span><div><strong>{s.name}</strong><small>{s.id.slice(0, 15)}{s.branch ? " · " + s.branch : ""}</small></div></div></td><td><span className="rd-account-chip">{initials(s.accountName)} {s.accountName}</span></td><td>{serviceKind(s)}</td><td>{s.serviceDetails?.region || "—"}</td><td><span className={"rd-status " + (s.suspended === "suspended" ? "is-suspended" : "is-live")}><i />{s.suspended === "suspended" ? "Suspended" : "Listed"}</span></td><td><button className="rd-open" onClick={(e) => { e.stopPropagation(); openService(s); }} aria-label={"Open " + s.name}>↗</button></td></tr>)}
              {!filtered.length && <tr><td colSpan="6"><div className="rd-empty"><span>▣</span><h3>{loading ? "Loading your services…" : services.length ? "No matching services" : "Your control center is ready"}</h3><p>{loading ? "Fetching your connected Render accounts." : services.length ? "Try changing your search or filters." : "Connect a Render API key to get started. The key is stored encrypted in your Stashr account."}</p>{!loading && !services.length && <button className="rd-btn rd-btn--primary" onClick={() => setModal(true)}>＋ Connect your first account</button>}</div></td></tr>}
            </tbody></table></div>
            <div className="rd-table-foot">Showing <b>{filtered.length}</b> of <b>{services.length}</b> services <span>•</span> {lastSync ? "Synced " + timeAgo(lastSync.toISOString()) : "Not synced yet"}</div>
          </div>

          <aside className="rd-side">
            <section className="rd-panel rd-connections">
              <div className="rd-panel-head"><div><h2>Connections</h2><p>Render accounts saved in Stashr</p></div><button className="rd-icon-btn" onClick={() => setModal(true)} aria-label="Add Render account">＋</button></div>
              {accounts.length ? accounts.map((a) => <div className="rd-connection" key={a.id}><span className="rd-avatar">{initials(a.name)}</span><div className="rd-connection-info"><strong>{a.name}</strong><small>{a.services.length} services{a.loadError ? " · error loading" : ""}</small></div><button className="rd-remove" onClick={() => void removeAccount(a)} aria-label={"Remove " + a.name} title="Disconnect">×</button></div>) : <div className="rd-connection-empty"><span>☁</span><strong>No connections yet</strong><p>Add a Render API key to see services here.</p></div>}
              <div className="rd-security-note"><span>♢</span><div><strong>Encrypted credential storage</strong><p>Keys are encrypted in your Stashr database and never returned to the browser after connection.</p></div></div>
            </section>
            <section className="rd-panel rd-quick"><h2>Quick links</h2><a href="https://dashboard.render.com" target="_blank" rel="noreferrer">↗ Render dashboard</a><a href="https://api-docs.render.com/" target="_blank" rel="noreferrer">↗ Render API documentation</a><small>Changes to environment variables may require a new deploy.</small></section>
          </aside>
        </section>
      </div>

      {modal && <div className="rd-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setModal(false); }}><section className="rd-modal" role="dialog" aria-modal="true" aria-labelledby="rd-connect-title">
        <button className="rd-modal-close" onClick={() => setModal(false)} aria-label="Close">×</button><div className="rd-modal-icon">☁</div><div className="rd-eyebrow"><span /> NEW CONNECTION</div><h2 id="rd-connect-title">Connect Render</h2><p>Enter a Render API key. Stashr validates it, then stores it encrypted with your account's vault data key.</p>
        <form onSubmit={connect}><label>Account name <small>OPTIONAL</small><input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="e.g. Production" maxLength={80} /></label><label>Render API key<div className="rd-key-wrap"><input type={showKey ? "text" : "password"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Paste your Render API key" autoComplete="off" spellCheck="false" required /><button type="button" onClick={() => setShowKey((v) => !v)}>{showKey ? "Hide" : "Show"}</button></div></label><div className="rd-modal-safe"><span>🔒</span> Your API key is sent only to your authenticated Stashr backend for validation and encrypted storage. It is never committed to source code.</div>{error && <div className="rd-modal-error">{error}</div>}<button className="rd-btn rd-btn--primary rd-btn--full" type="submit" disabled={connecting || !apiKey.trim()}>{connecting ? "Validating and saving…" : "Validate & connect"}</button></form>
      </section></div>}

      {selected && selectedAccount && <div className="rd-backdrop rd-detail-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}><section className="rd-detail" role="dialog" aria-modal="true" aria-labelledby="rd-detail-title">
        <header className="rd-detail-head"><div><div className="rd-eyebrow"><span /> SERVICE CONTROL</div><h2 id="rd-detail-title">{selected.name}</h2><p>{selected.accountName} · {serviceKind(selected)} · {selected.id}</p></div><button className="rd-modal-close" onClick={() => setSelected(null)} aria-label="Close">×</button></header>
        <div className="rd-detail-actions"><a className="rd-btn rd-btn--quiet" href={dashboardUrl(selected)} target="_blank" rel="noreferrer">Open Render ↗</a><button className="rd-btn rd-btn--quiet" disabled={actionBusy || serviceKind(selected) === "Cron job"} onClick={() => void restart()}>↻ Restart</button><button className="rd-btn rd-btn--primary" disabled={actionBusy} onClick={() => void deploy(false)}>Deploy latest</button><button className="rd-btn rd-btn--quiet" disabled={actionBusy} onClick={() => void deploy(true)}>Deploy + clear cache</button></div>
        <nav className="rd-tabs"><button className={tab === "overview" ? "is-active" : ""} onClick={() => changeTab("overview")}>Overview</button><button className={tab === "logs" ? "is-active" : ""} onClick={() => changeTab("logs")}>Logs</button><button className={tab === "env" ? "is-active" : ""} onClick={() => changeTab("env")}>Environment</button><button className={tab === "deploys" ? "is-active" : ""} onClick={() => changeTab("deploys")}>Deployments</button></nav>
        {error && <div className="rd-alert rd-alert--error"><span>!</span><div>{error}</div><button onClick={() => setError("")}>×</button></div>}
        {tab === "overview" && <><div className="rd-detail-grid">{[["Service ID", selected.id], ["Region", selected.serviceDetails?.region || "Not provided"], ["Type", selected.type || "Unknown"], ["Last updated", timeAgo(selected.updatedAt)], ["Plan", selected.serviceDetails?.plan || selected.serviceDetails?.buildPlan || "—"], ["State", selected.suspended === "suspended" ? "Suspended" : "Not marked suspended"], ["Repository", selected.repo || "—"], ["Branch", selected.branch || "—"]].map(([label, value]) => <div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div><p className="rd-detail-tip">Restart and deploy actions require confirmation. Environment variables are updated individually to reduce accidental changes.</p></>}
        {tab === "logs" && <section className="rd-detail-section"><div className="rd-section-head"><div><h3>Recent logs</h3><p>Last hour · automatic refresh every 15 seconds</p></div><div className="rd-inline-tools"><select value={logType} onChange={(e) => { setLogType(e.target.value); void loadLogs(selected, e.target.value); }}><option value="app">Application</option><option value="request">Request</option><option value="build">Build</option></select><button className="rd-icon-btn" onClick={() => void loadLogs(selected, logType)}>↻</button></div></div><input className="rd-filter-input" placeholder="Filter log messages…" value={logSearch} onChange={(e) => setLogSearch(e.target.value)} />{detailBusy ? <div className="rd-loading">Loading logs…</div> : <div className="rd-logs">{logs.filter((l) => String(l.message || "").toLowerCase().includes(logSearch.toLowerCase())).map((l, i) => <div className="rd-log" key={l.id || i}><time>{l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : "—"}</time><code>{l.message || "(empty log entry)"}</code></div>)}{!logs.length && <div className="rd-empty">No logs returned for this period.</div>}</div>}</section>}
        {tab === "env" && <section className="rd-detail-section"><div className="rd-section-head"><div><h3>Environment variables</h3><p>Direct service variables only.</p></div><div className="rd-inline-tools"><button className="rd-btn rd-btn--quiet" onClick={() => setShowEnvValues((v) => !v)}>{showEnvValues ? "Mask values" : "Reveal values"}</button><button className="rd-icon-btn" onClick={() => void loadEnv(selected)}>↻</button></div></div><div className="rd-env-toolbar"><input className="rd-filter-input" placeholder="Filter variable names…" value={envSearch} onChange={(e) => setEnvSearch(e.target.value)} /><button className="rd-btn rd-btn--quiet" onClick={() => setNewEnv((v) => !v)}>＋ Add variable</button></div>{newEnv && <form className="rd-new-env" onSubmit={addEnv}><input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="VARIABLE_NAME" required /><input value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="Value" required /><button className="rd-btn rd-btn--primary">Add</button></form>}{envBusy ? <div className="rd-loading">Loading environment variables…</div> : <div className="rd-env-list">{envVars.filter((v) => v.key.toLowerCase().includes(envSearch.toLowerCase())).map((v) => <div className="rd-env-row" key={v.key}><strong>{v.key}{v.isNew && <small> NEW</small>}</strong><input type={showEnvValues ? "text" : "password"} value={v.value} onChange={(e) => setEnvVars((old) => old.map((x) => x.key === v.key ? { ...x, value: e.target.value } : x))} autoComplete="off" /><button className="rd-remove" onClick={() => void removeEnv(v)} disabled={actionBusy} title="Delete variable">×</button></div>)}{!envVars.length && <div className="rd-empty">No direct environment variables returned.</div>}</div>}<div className="rd-env-foot"><small>Changes are not deployed automatically.</small><button className="rd-btn rd-btn--primary" onClick={() => void saveEnv()} disabled={actionBusy || envBusy}>Save changes</button></div></section>}
        {tab === "deploys" && <section className="rd-detail-section"><div className="rd-section-head"><div><h3>Deployment history</h3><p>Recent deployments for this service</p></div><button className="rd-icon-btn" onClick={() => void loadDeployments(selected)}>↻</button></div>{detailBusy ? <div className="rd-loading">Loading deployments…</div> : <div className="rd-deploy-list">{deploys.map((d) => <article className="rd-deploy" key={d.id}><span className="rd-deploy-mark">↗</span><div><strong>{d.status || "Unknown status"}</strong><p>{d.commit?.message || d.id}</p><small>{d.commit?.id ? d.commit.id.slice(0, 8) + " · " : ""}{timeAgo(d.createdAt)}</small></div><time>{d.createdAt ? new Date(d.createdAt).toLocaleString() : "—"}</time></article>)}{!deploys.length && <div className="rd-empty">No deployments returned for this service.</div>}</div>}</section>}
      </section></div>}
    </main>
  );
}
