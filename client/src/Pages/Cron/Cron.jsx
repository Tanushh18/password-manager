import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import {
  getRenderAccounts, getRenderServices, getRenderOpsConfig, saveRenderOpsConfig, getRenderOpsStatus,
  getPingResults, runPingsNow, scanHealthRoutes, addHealthRoute
} from "../../api/client";
import { Section, Skeleton, Empty, useConfirm } from "../Render/RenderUi";
import { usePolling } from "../Render/renderHooks";
import { normalizeServices, serviceKey, serviceKind, timeAgo, safeUrl, errorMessage } from "../Render/renderUtils";
import { useVault } from "../../state/vault";
import { serviceProjectIndex } from "../../lib/serviceProjects";
import "../Render/RenderDashboard.css";
import "./Cron.css";

const EVERY = [5, 10, 15, 30, 60];
const isWeb = (s) => /web|static/i.test(String(s.type || "")) && Boolean(s.serviceDetails?.url);

function Result({ r }) {
  if (!r) return <span className="cr-dim">Not run yet</span>;
  if (r.ok) return <span className="cr-res is-ok">✓ {r.status} · {r.ms} ms · {timeAgo(r.at)}</span>;
  if (r.missingRoute) return <span className="cr-res is-warn">404 — no route here · {timeAgo(r.at)}</span>;
  return <span className="cr-res is-bad">✕ {r.status || r.error || "failed"} · {timeAgo(r.at)}</span>;
}

/** Stashr's cron: ping jobs per server, /health routes, Render cron jobs and the background scheduler. */
export default function Cron() {
  const { projects } = useVault();
  const projectOf = useMemo(() => serviceProjectIndex(projects), [projects]);
  const [ask, confirmDialog] = useConfirm();
  const [services, setServices] = useState([]);
  const [pings, setPings] = useState([]);
  const [pingAll, setPingAll] = useState(true); // every running web service pinged every 10 min unless it has its own job
  const [results, setResults] = useState({});
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [scan, setScan] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [fixing, setFixing] = useState([]);
  const [selected, setSelected] = useState([]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [acc, cfg, st, pr] = await Promise.all([getRenderAccounts(), getRenderOpsConfig(), getRenderOpsStatus().catch(() => null), getPingResults().catch(() => ({ results: {} }))]);
      const all = await Promise.all((acc.accounts || []).map(async (a) => {
        try { const d = await getRenderServices(a.id); return normalizeServices(d.services).map((s) => ({ ...s, accountId: a.id, accountName: a.name })); } catch { return []; }
      }));
      setServices(all.flat());
      setPings(cfg.config?.pings || []);
      setPingAll(cfg.config?.pingAll !== false);
      setStatus(st);
      setResults(pr.results || {});
    } catch (e) { if (!quiet) toast.error(errorMessage(e, "Could not load cron jobs.")); }
    finally { if (!quiet) setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  usePolling(() => load(true), 60000, true);

  const web = useMemo(() => services.filter((s) => isWeb(s) && s.suspended !== "suspended").sort((a, b) => a.name.localeCompare(b.name)), [services]);
  const crons = useMemo(() => services.filter((s) => /cron/i.test(String(s.type || ""))), [services]);
  // A server with no job of its own follows the default (on, every 10 minutes, /health) while pingAll is on.
  const jobOf = (key) => pings.find((p) => p.serviceKey === key) || (pingAll ? { serviceKey: key, path: "/health", everyMinutes: 10, enabled: true, auto: true } : undefined);
  const toggleAll = async (on) => {
    setSaving(true);
    try { const r = await saveRenderOpsConfig({ pingAll: on }); setPingAll(r.config?.pingAll !== false); toast.success(on ? "Every server is pinged every 10 minutes by default." : "Default pings off. Only servers you switch on are pinged."); }
    catch (e) { toast.error(errorMessage(e, "Could not save.")); }
    finally { setSaving(false); }
  };

  const save = async (next, message) => {
    setSaving(true);
    try { const r = await saveRenderOpsConfig({ pings: next }); setPings(r.config?.pings || next); if (message) toast.success(message); }
    catch (e) { toast.error(errorMessage(e, "Could not save.")); }
    finally { setSaving(false); }
  };
  const upsert = (list, s, patch) => {
    const key = serviceKey(s);
    const existing = list.find((p) => p.serviceKey === key);
    const job = { serviceKey: key, name: s.name, url: safeUrl(s.serviceDetails.url).replace(/\/$/, ""), path: "/health", everyMinutes: 10, enabled: true, ...(existing || {}), ...patch };
    return existing ? list.map((p) => (p.serviceKey === key ? job : p)) : [...list, job];
  };
  const setFor = (targets, patch, message) => void save(targets.reduce((list, s) => upsert(list, s, patch), pings), message);
  const remove = (targets) => void save(pings.filter((p) => !targets.some((s) => serviceKey(s) === p.serviceKey)), "Ping job removed.");
  const runNow = async () => {
    setRunning(true);
    try { const r = await runPingsNow(); setResults(r.results || {}); toast.success("Ran " + r.ran + " ping job" + (r.ran === 1 ? "" : "s") + "."); }
    catch (e) { toast.error(errorMessage(e, "Could not run the jobs.")); }
    finally { setRunning(false); }
  };

  const runScan = async () => {
    setScanning(true);
    try { const r = await scanHealthRoutes(); setScan(r.services || []); }
    catch (e) { toast.error(errorMessage(e, "Could not scan.")); }
    finally { setScanning(false); }
  };
  const missing = (scan || []).filter((r) => r.missingRoute && r.repo);
  const fix = async (rows) => {
    const list = rows.filter((r) => r.repo);
    if (!list.length) return;
    const ok = await ask({
      title: "Add /health to " + (list.length === 1 ? list[0].name : list.length + " apps") + "?",
      message: "For each repo Stashr adds a small GET /health route, opens a pull request and merges it into the default branch right away. Render then redeploys the app. " + list.map((r) => r.repo.replace(/^https:\/\/github\.com\//, "")).join(", "),
      confirmLabel: "Add, open PR and merge", danger: false
    });
    if (!ok) return;
    const done = [], failed = [];
    for (const row of list) {
      setFixing((old) => [...old, row.serviceKey]);
      try {
        const r = await addHealthRoute(row.repo, row.rootDir || "", true);
        if (r.already) done.push(row.name + " (already had one)");
        else if (r.merged) done.push(row.name);
        else failed.push(row.name + ": PR opened but not merged — " + (r.mergeError || "") + " " + (r.prUrl || ""));
      } catch (e) { failed.push(row.name + ": " + errorMessage(e, "failed")); }
      setFixing((old) => old.filter((k) => k !== row.serviceKey));
    }
    if (done.length) toast.success("/health added and merged: " + done.join(", ") + ". Render is redeploying.", { autoClose: 9000 });
    if (failed.length) toast.error(failed.join(" · "), { autoClose: 15000 });
  };

  const allSelected = web.length > 0 && web.every((s) => selected.includes(serviceKey(s)));
  const chosen = web.filter((s) => selected.includes(serviceKey(s)));
  const enabledCount = web.filter((s) => jobOf(serviceKey(s))?.enabled).length;
  const lastTickAge = status?.lastTick?.completedAt ? Date.now() - Date.parse(status.lastTick.completedAt) : null;

  return (
    <main className="rd-page cr-page">
      <header className="rd-topbar">
        <div className="rd-shell rd-topbar__inner">
          <div className="rd-topbar__title"><div className="rd-eyebrow"><span />AUTOMATION</div><h1>Cron jobs</h1></div>
          <div className="rd-topbar__tools">
            <button type="button" className="rd-btn rd-btn--quiet" onClick={() => void load()}>↻ Refresh</button>
            <button type="button" className="rd-btn rd-btn--primary" disabled={running || !enabledCount} onClick={() => void runNow()}>{running ? "Running…" : "▶ Run all pings now"}</button>
          </div>
        </div>
      </header>
      <div className="rd-shell rd-content cr-stack">
        <div className="cr-kpis">
          <div><span>Background scheduler</span><b className={lastTickAge != null && lastTickAge < 15 * 60000 ? "is-ok" : "is-warn"}>{status?.lastTick ? "Ran " + timeAgo(status.lastTick.completedAt) : status?.schedulerEnabled === false ? "Off" : "Starting…"}</b><small>{status?.lastTick ? "every 5 min · monitoring, sync, pings" : "first run ~90 s after the server starts"}</small></div>
          <div><span>Ping jobs</span><b>{enabledCount}</b><small>of {web.length} running web services</small></div>
          <div><span>/health routes</span><b className={missing.length ? "is-warn" : ""}>{scan ? (scan.length - (scan.filter((r) => r.missingRoute).length)) + " / " + scan.length : "—"}</b><small>{scan ? missing.length + " missing" : "run a scan below"}</small></div>
          <div><span>Render cron jobs</span><b>{crons.length}</b><small>across all accounts</small></div>
        </div>

        <Section title="Ping jobs" subtitle="Stashr calls each server's URL on a schedule: it keeps free Render services awake and shows straight away if one stops answering." className="rd-card--flush"
          actions={<label className="cr-switch cr-switch--main" title="New servers are added automatically"><input type="checkbox" checked={pingAll} disabled={saving} onChange={(e) => void toggleAll(e.target.checked)} /><span>Ping every server by default (every 10 min)</span></label>}>
          {selected.length > 0 && (
            <div className="rd-selectbar">
              <strong>{selected.length} selected</strong>
              <button type="button" className="rd-btn rd-btn--quiet" disabled={saving} onClick={() => setFor(chosen, { enabled: true }, "Enabled.")}>Enable</button>
              <button type="button" className="rd-btn rd-btn--quiet" disabled={saving} onClick={() => setFor(chosen, { enabled: false }, "Paused.")}>Pause</button>
              {EVERY.map((m) => <button key={m} type="button" className="rd-btn rd-btn--quiet" disabled={saving} onClick={() => setFor(chosen, { everyMinutes: m }, "Every " + m + " min.")}>{m} min</button>)}
              <button type="button" className="rd-btn rd-btn--danger-quiet" disabled={saving} onClick={() => remove(chosen)}>Remove</button>
              <button type="button" className="rd-btn rd-btn--link" onClick={() => setSelected([])}>Clear</button>
            </div>
          )}
          {loading ? <div className="cr-pad"><Skeleton lines={5} height={34} /></div> : !web.length ? <Empty icon="⏱" title="No running web services">Connect a Render account on the Render page.</Empty> : (
            <div className="rd-tablewrap">
              <table className="rd-table cr-table">
                <thead><tr>
                  <th className="rd-col-check"><input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? [] : web.map(serviceKey))} aria-label="Select all" /></th>
                  <th>Service</th><th>Project</th><th>Ping</th><th>Path</th><th>Every</th><th>Last result</th>
                </tr></thead>
                <tbody>{web.map((s) => {
                  const key = serviceKey(s), job = jobOf(key), project = projectOf.get(s.id);
                  return (
                    <tr key={key} id={"svc-" + key}>
                      <td className="rd-col-check"><input type="checkbox" checked={selected.includes(key)} onChange={() => setSelected((o) => (o.includes(key) ? o.filter((k) => k !== key) : [...o, key]))} aria-label={"Select " + s.name} /></td>
                      <td><strong>{s.name}</strong><a className="rd-url" href={safeUrl(s.serviceDetails.url)} target="_blank" rel="noreferrer noopener">{s.serviceDetails.url.replace(/^https?:\/\//, "")}</a><small className="cr-dim">{s.accountName}</small></td>
                      <td>{project ? <Link className="rd-project" to={"/projects/" + project.id}>{project.name}</Link> : <span className="cr-dim">—</span>}</td>
                      <td><label className="cr-switch"><input type="checkbox" checked={Boolean(job?.enabled)} disabled={saving} onChange={(e) => setFor([s], { enabled: e.target.checked }, e.target.checked ? "Ping job on for " + s.name + "." : "Paused.")} /><span>{job?.enabled ? (job.auto ? "On · default" : "On") : job ? "Paused" : "Off"}</span></label></td>
                      <td><input className="rd-field cr-path" defaultValue={job?.path || "/health"} disabled={saving} onBlur={(e) => { const v = e.target.value.trim() || "/health"; if (v !== (job?.path || "/health")) setFor([s], { path: v.startsWith("/") ? v : "/" + v }, "Path saved."); }} aria-label={"Path for " + s.name} /></td>
                      <td><select className="rd-field" value={job?.everyMinutes || 10} disabled={saving} onChange={(e) => setFor([s], { everyMinutes: Number(e.target.value) }, "Saved.")} aria-label={"Interval for " + s.name}>{EVERY.map((m) => <option key={m} value={m}>{m} min</option>)}</select></td>
                      <td><Result r={results[key]} /></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="/health routes" subtitle="Checks which servers answer GET /health. A missing route can be added to the repo for you: Stashr opens a pull request and merges it in the same click."
          actions={<>
            {missing.length > 0 && <button type="button" className="rd-btn rd-btn--primary" disabled={fixing.length > 0} onClick={() => void fix(missing)}>Fix all missing ({missing.length})</button>}
            <button type="button" className="rd-btn rd-btn--quiet" disabled={scanning} onClick={() => void runScan()}>{scanning ? "Scanning…" : "🔍 Scan all servers"}</button>
          </>}>
          {!scan ? <p className="cr-dim">Run a scan to see which servers have a /health route.</p> : (
            <div className="rd-tablewrap">
              <table className="rd-table cr-table">
                <thead><tr><th>Service</th><th>GET /health</th><th>Repo</th><th /></tr></thead>
                <tbody>{scan.map((r) => (
                  <tr key={r.serviceKey}>
                    <td><strong>{r.name}</strong><small className="cr-dim">{r.url.replace(/^https?:\/\//, "")}</small></td>
                    <td><Result r={r} /></td>
                    <td>{r.repo ? <a href={safeUrl(r.repo)} target="_blank" rel="noreferrer noopener">{r.repo.replace(/^https:\/\/github\.com\//, "")}</a> : <span className="cr-dim">no repo</span>}{r.rootDir ? <small className="cr-dim">root: {r.rootDir}</small> : null}</td>
                    <td className="cr-right">{r.missingRoute && r.repo ? <button type="button" className="rd-btn rd-btn--primary" disabled={fixing.includes(r.serviceKey)} onClick={() => void fix([r])}>{fixing.includes(r.serviceKey) ? "Adding…" : "Add /health + merge"}</button> : r.ok ? <span className="cr-res is-ok">Has /health</span> : null}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="Render cron jobs" subtitle="Cron job services on your Render accounts. Create or change their schedule in Render.">
          {!crons.length ? <p className="cr-dim">No cron job services on your connected accounts.</p> : (
            <div className="rd-tablewrap">
              <table className="rd-table cr-table">
                <thead><tr><th>Name</th><th>Schedule</th><th>Project</th><th>Account</th><th>Status</th><th>Updated</th><th /></tr></thead>
                <tbody>{crons.map((s) => (
                  <tr key={serviceKey(s)}>
                    <td><strong>{s.name}</strong><small className="cr-dim">{serviceKind(s)}{s.branch ? " · " + s.branch : ""}</small></td>
                    <td><code>{s.serviceDetails?.schedule || "—"}</code></td>
                    <td>{projectOf.get(s.id) ? <Link className="rd-project" to={"/projects/" + projectOf.get(s.id).id}>{projectOf.get(s.id).name}</Link> : <span className="cr-dim">—</span>}</td>
                    <td>{s.accountName}</td>
                    <td>{s.suspended === "suspended" ? <span className="cr-res is-warn">Suspended</span> : <span className="cr-res is-ok">Active</span>}</td>
                    <td>{timeAgo(s.updatedAt)}</td>
                    <td className="cr-right"><a className="rd-btn rd-btn--quiet" href={safeUrl(s.dashboardUrl)} target="_blank" rel="noreferrer noopener">Open in Render ↗</a></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
      {confirmDialog}
    </main>
  );
}
