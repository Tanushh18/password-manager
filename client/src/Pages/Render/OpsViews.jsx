import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import {
  getRenderMetrics, getRenderLogs, getRenderEnvVars, getRenderDeploys, triggerRenderDeploy,
  restartRenderService, checkRenderHealth
} from "../../api/client";
import { Kpi, Section, Skeleton, Empty, LineChart } from "./RenderUi";
import { usePolling } from "./renderHooks";
import {
  serviceKind, serviceKey, normalizeList, sumMetricPoints, peakOf, rangeStart, timeAgo, formatNumber, formatDateTime,
  formatTime, isErrorLog, errorMessage, METRIC_OPTIONS, RANGE_OPTIONS
} from "./renderUtils";

const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
const TERMINAL_FAILURE = new Set(["build_failed", "update_failed", "canceled", "cancelled", "deactivated"]);

/** Polls Render until a deploy is live and the endpoint probe passes (or fails / times out / is stopped). */
async function waitForServiceReady(service, { deployId = "", timeoutMs = 300000, shouldStop }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(10000);
    if (shouldStop()) return { ok: false, message: "Stopped by user." };
    if (deployId) {
      const deployments = normalizeList(await getRenderDeploys(service.accountId, service.id), "deploy");
      const found = deployments.find((item) => item.id === deployId);
      if (!found) continue;
      const status = String(found.status || "").toLowerCase();
      if (TERMINAL_FAILURE.has(status)) return { ok: false, message: "Deployment ended with status " + status + "." };
      if (status !== "live") continue;
    }
    try {
      const health = await checkRenderHealth(service.accountId, service.id);
      if (health.state === "healthy") return { ok: true };
      if (health.state === "unhealthy" || health.state === "timeout") return { ok: false, message: "Health probe returned " + health.state + "." };
      if (health.state === "unsupported" || health.state === "unknown") return { ok: true, note: "Render reports live; no supported public health probe." };
    } catch (e) {
      if (deployId && e?.response?.status >= 400 && e?.response?.status < 500) return { ok: false, message: "Health verification failed: " + errorMessage(e, "request rejected") };
    }
  }
  return { ok: false, message: "Timed out waiting for the service to become ready." };
}

/* ====================================================================== Monitoring */

export function MonitoringView({ services, ops, selectedGroupId, onSelectGroup, askConfirm, onOpenService, onRefreshServices, onAudit, onGoServices }) {
  const { groups, history, saving, running, persist, sampleNow } = ops;
  const group = groups.find((g) => g.id === selectedGroupId) || null;
  const members = useMemo(() => group ? group.serviceKeys.map((key) => services.find((s) => serviceKey(s) === key)).filter(Boolean) : [], [group, services]);

  const [metric, setMetric] = useState("memory");
  const [range, setRange] = useState("1h");
  const [live, setLive] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [metricBusy, setMetricBusy] = useState(false);
  const loadId = useRef(0);

  const loadMetrics = useCallback(async (quiet = false) => {
    if (!group) return;
    const mine = ++loadId.current;
    if (!quiet) setMetricBusy(true);
    const startTime = rangeStart(range);
    try {
      const results = await Promise.all(members.slice(0, 10).map(async (service) => {
        const base = { key: serviceKey(service), name: service.name, accountName: service.accountName };
        try {
          const points = sumMetricPoints(await getRenderMetrics(service.accountId, service.id, metric, startTime));
          const peak = peakOf(points);
          return { ...base, points, current: points.length ? points[points.length - 1].value : null, peak: peak?.value ?? null, peakAt: peak?.timestamp || null, unit: points[points.length - 1]?.unit || "", error: points.length ? "" : "No metric points returned" };
        } catch (e) { return { ...base, points: [], current: null, peak: null, peakAt: null, unit: "", error: errorMessage(e, "Metrics unavailable") }; }
      }));
      if (mine !== loadId.current) return; // a newer request superseded this one
      const combined = new Map();
      results.forEach((svc) => svc.points.forEach((p) => {
        const existing = combined.get(p.timestamp);
        combined.set(p.timestamp, { timestamp: p.timestamp, value: (existing?.value || 0) + p.value, unit: p.unit || existing?.unit || "" });
      }));
      setSnapshot({ groupId: group.id, metric, range, services: results, combined: [...combined.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)), checkedAt: new Date().toISOString() });
    } finally { if (mine === loadId.current && !quiet) setMetricBusy(false); }
  }, [group, members, metric, range]);

  // Reload whenever the group, metric or range changes (fixes the original, which ignored the range).
  useEffect(() => { setSnapshot(null); if (group) void loadMetrics(); }, [group?.id, metric, range]); // eslint-disable-line react-hooks/exhaustive-deps
  usePolling(() => loadMetrics(true), 5 * 60 * 1000, Boolean(group) && live);

  const savedPeak = useMemo(() => {
    if (!group) return null;
    return history.filter((h) => h.groupId === group.id)
      .map((h) => ({ at: h.sampledAt, value: h.combined?.[metric]?.currentSum }))
      .filter((h) => Number.isFinite(h.value))
      .reduce((best, h) => (!best || h.value > best.value ? h : best), null);
  }, [history, group, metric]);

  const latestSample = useMemo(() => group ? history.filter((h) => h.groupId === group.id).reduce((best, h) => (!best || Date.parse(h.sampledAt || 0) > Date.parse(best.sampledAt || 0) ? h : best), null) : null, [history, group]);
  const databases = (latestSample?.services || []).filter((s) => String(s.type || "").toLowerCase().includes("postgres") || String(s.serviceId || "").startsWith("dpg-"));

  /* --- group logs & drift --- */
  const [groupLogs, setGroupLogs] = useState([]);
  const [logsBusy, setLogsBusy] = useState(false);
  const [logSearch, setLogSearch] = useState("");
  const [drift, setDrift] = useState([]);
  const [driftBusy, setDriftBusy] = useState(false);
  useEffect(() => { setGroupLogs([]); setDrift([]); }, [group?.id]);

  const loadGroupLogs = async () => {
    setLogsBusy(true);
    try {
      const end = new Date(), start = new Date(end.getTime() - 3600000);
      const results = await Promise.all(members.slice(0, 10).map(async (service) => {
        if (!service.ownerId) return [];
        try {
          const result = await getRenderLogs(service.accountId, { ownerId: service.ownerId, resource: service.id, startTime: start.toISOString(), endTime: end.toISOString(), direction: "backward", limit: "100", type: "app" });
          return (Array.isArray(result.logs) ? result.logs : []).map((log) => ({ ...log, serviceName: service.name, serviceId: service.id }));
        } catch { return []; }
      }));
      setGroupLogs(results.flat().sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0)).slice(0, 300));
    } finally { setLogsBusy(false); }
  };

  const compareConfig = async () => {
    setDriftBusy(true);
    try {
      const results = await Promise.all(members.slice(0, 10).map(async (service) => {
        try {
          const keys = [...new Set(normalizeList(await getRenderEnvVars(service.accountId, service.id), "envVar").map((i) => String(i.key || "")).filter(Boolean))].sort();
          return { key: serviceKey(service), name: service.name, keys };
        } catch { return { key: serviceKey(service), name: service.name, keys: [], error: "Could not read variable names" }; }
      }));
      const all = [...new Set(results.flatMap((r) => r.keys))].sort();
      setDrift(results.map((r) => ({ ...r, missing: r.error ? [] : all.filter((k) => !r.keys.includes(k)) })));
      toast.info("Compared variable names only. Values were not read or saved.");
    } finally { setDriftBusy(false); }
  };

  /* --- group actions (sequential, observable, stoppable) --- */
  const [progress, setProgress] = useState(null);
  const stopRef = useRef(false);
  const runningBulk = progress?.running;

  const runBulk = async (action) => {
    const targets = members.filter((s) => action !== "restart" || serviceKind(s) !== "Cron job");
    if (!targets.length) return;
    const ok = await askConfirm({
      title: action === "deploy" ? "Deploy servers in order?" : "Restart servers in order?",
      message: "Sequentially " + (action === "deploy" ? "deploy and wait for readiness on " : "restart and verify health for ") + targets.length + " service(s) in “" + group.name + "”: " + targets.map((s) => s.name).join(" → ") + ". The next service waits for the current one to become ready; if readiness fails, times out, or you press Stop, remaining actions are skipped.",
      confirmLabel: action === "deploy" ? "Start deploy" : "Start restart", danger: action === "restart"
    });
    if (!ok) return;
    stopRef.current = false;
    const rows = targets.map((s) => ({ key: serviceKey(s), name: s.name, status: "pending", note: "" }));
    const update = (index, patch) => { rows[index] = { ...rows[index], ...patch }; setProgress({ running: true, action, rows: [...rows] }); };
    setProgress({ running: true, action, rows: [...rows] });
    const shouldStop = () => stopRef.current;
    try {
      for (let i = 0; i < targets.length; i += 1) {
        const service = targets[i];
        if (stopRef.current) break;
        update(i, { status: "running" });
        try {
          let result;
          if (action === "deploy") {
            const started = Date.now();
            const response = await triggerRenderDeploy(service.accountId, service.id, false);
            let deployId = response?.deploy?.id || response?.id || response?.deployId || "";
            if (!deployId) {
              const current = normalizeList(await getRenderDeploys(service.accountId, service.id), "deploy");
              deployId = current.find((item) => Date.parse(item.createdAt || 0) >= started - 5000)?.id || "";
            }
            if (!deployId) { update(i, { status: "failed", note: "Deploy was requested, but its ID could not be verified. Stopped before the next service." }); break; }
            result = await waitForServiceReady(service, { deployId, timeoutMs: 300000, shouldStop });
          } else {
            await restartRenderService(service.accountId, service.id);
            result = await waitForServiceReady(service, { timeoutMs: 90000, shouldStop });
          }
          update(i, { status: result.ok ? "done" : "failed", note: result.ok ? (result.note || "") : result.message });
          if (!result.ok) break;
        } catch (e) { update(i, { status: "failed", note: errorMessage(e, "Request failed.") }); break; }
      }
    } finally {
      const failed = rows.find((r) => r.status === "failed");
      const skipped = rows.filter((r) => r.status === "pending").length;
      setProgress({ running: false, action, rows: [...rows.map((r) => (r.status === "pending" ? { ...r, status: "skipped" } : r))] });
      if (failed) toast.error(failed.name + ": " + failed.note + (skipped ? " · " + skipped + " later service(s) not started" : ""));
      else if (stopRef.current) toast.info("Stopped. " + skipped + " service(s) were not started.");
      else toast.success("Completed " + rows.length + " sequential action(s).");
      await onRefreshServices();
      void onAudit();
    }
  };

  /* --- dependencies & cost --- */
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const updateGroup = async (patch) => { try { await persist({ groups: groups.map((g) => (g.id === group.id ? { ...g, ...patch } : g)) }, { silent: true }); } catch { /* toast already shown */ } };
  const addDependency = async () => {
    if (!from || !to || from === to) return;
    const current = group.dependencies || [];
    if (current.some((e) => e.from === from && e.to === to)) return;
    await updateGroup({ dependencies: [...current, { from, to }] });
  };
  const removeDependency = (a, b) => updateGroup({ dependencies: (group.dependencies || []).filter((e) => e.from !== a || e.to !== b) });
  const saveBudget = async (raw) => {
    const value = raw.trim() === "" ? 0 : Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 1000000) { toast.error("Enter a valid monthly budget in USD."); return; }
    await updateGroup({ monthlyBudgetUsd: Math.round(value * 100) / 100 });
  };
  const saveEstimate = async (key, raw) => {
    const estimates = { ...(group.serviceCostEstimates || {}) };
    if (raw.trim() === "") delete estimates[key];
    else {
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || value > 100000) { toast.error("Enter a valid monthly cost estimate in USD."); return; }
      estimates[key] = Math.round(value * 100) / 100;
    }
    await updateGroup({ serviceCostEstimates: estimates });
  };
  const deleteGroup = async () => {
    const ok = await askConfirm({ title: "Delete group?", message: "Delete the group “" + group.name + "”? This does not affect any Render services.", confirmLabel: "Delete group", danger: true });
    if (!ok) return;
    try { await persist({ groups: groups.filter((g) => g.id !== group.id) }); onSelectGroup(""); } catch { /* toast already shown */ }
  };

  const errorLogs = groupLogs.filter(isErrorLog);
  const combined = snapshot?.combined || [];
  const latest = combined[combined.length - 1];
  const peak = peakOf(combined);

  return (
    <div className="rd-stack">
      <Section title="Server groups" subtitle="Compare related Render services side by side — for example a Fetcher, Validator and User server."
        actions={<>
          <select aria-label="Select a server group" value={selectedGroupId} onChange={(e) => onSelectGroup(e.target.value)}>
            <option value="">{groups.length ? "Choose a saved group" : "No groups yet"}</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.serviceKeys.length})</option>)}
          </select>
          <button type="button" className="rd-btn rd-btn--quiet" onClick={onGoServices}>＋ New group</button>
        </>}>
        {!group && <Empty icon="◫" title={groups.length ? "Choose a group" : "Create your first group"} action={!groups.length && <button type="button" className="rd-btn rd-btn--primary" onClick={onGoServices}>Select services</button>}>
          {groups.length ? "Pick a saved group to see metrics, errors and group-level actions." : "Tick two or more services in the Services view, then choose “Group selected”."}
        </Empty>}

        {group && <>
          <div className="rd-toolrow">
            <label className="rd-inline">Metric<select value={metric} onChange={(e) => setMetric(e.target.value)}>{METRIC_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label className="rd-inline">Range<select value={range} onChange={(e) => setRange(e.target.value)}>{RANGE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label className="rd-check"><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Auto-refresh (5 min)</label>
            <span className="rd-spacer" />
            <button type="button" className="rd-btn rd-btn--quiet" disabled={metricBusy} onClick={() => void loadMetrics()}>↻ Refresh</button>
            <button type="button" className="rd-btn rd-btn--quiet" disabled={running} onClick={() => void sampleNow()}>{running ? "Sampling…" : "Sample all groups"}</button>
            <button type="button" className="rd-btn rd-btn--danger-quiet" onClick={() => void deleteGroup()}>Delete group</button>
          </div>
          <p className="rd-muted">{members.length} of {group.serviceKeys.length} services currently available{members.length < group.serviceKeys.length ? " — some members may belong to a disconnected account." : "."}</p>

          {metricBusy && !snapshot ? <Skeleton lines={6} height={18} /> : snapshot && <>
            <div className="rd-kpis">
              <Kpi label="Latest combined (sum)" value={latest ? formatNumber(latest.value) + " " + (latest.unit || "") : "—"} />
              <Kpi label="Peak in range" value={peak ? formatNumber(peak.value) : "—"} hint={peak ? "at " + formatTime(peak.timestamp) : undefined} />
              <Kpi label="Saved peak (recorded)" value={savedPeak ? formatNumber(savedPeak.value) : "—"} hint={savedPeak ? formatDateTime(savedPeak.at) : "Needs the background scheduler"} />
              <Kpi label="Last sampled" value={formatTime(snapshot.checkedAt)} />
            </div>
            <LineChart series={snapshot.services.map((s) => ({ key: s.key, name: s.name, points: s.points }))} metric={METRIC_OPTIONS.find(([v]) => v === metric)?.[1] || metric} />
            <div className="rd-tablewrap"><table className="rd-table rd-table--compact">
              <thead><tr><th scope="col">Service</th><th scope="col">Account</th><th scope="col">Current</th><th scope="col">Peak</th><th scope="col">Peak time</th><th scope="col">Result</th><th scope="col"><span className="rd-sr">Open</span></th></tr></thead>
              <tbody>{snapshot.services.map((item) => <tr key={item.key}><td>{item.name}</td><td>{item.accountName}</td><td>{item.current == null ? "—" : formatNumber(item.current) + " " + item.unit}</td><td>{item.peak == null ? "—" : formatNumber(item.peak) + " " + item.unit}</td><td>{item.peakAt ? formatTime(item.peakAt) : "—"}</td><td className={item.error ? "rd-warn" : ""}>{item.error || "Available"}</td><td><button type="button" className="rd-btn rd-btn--quiet" onClick={() => { const s = services.find((c) => serviceKey(c) === item.key); if (s) onOpenService(s); }}>Details</button></td></tr>)}</tbody>
            </table></div>
            <p className="rd-note">Combined values sum aligned samples; they are not a single host’s CPU or memory percentage. Missing samples are shown as unavailable, never as zero.</p>
          </>}
        </>}
      </Section>

      {group && <>
        <Section title="Group actions" subtitle="Run an operation across the group in dependency-friendly order, with live status.">
          <div className="rd-toolrow">
            <button type="button" className="rd-btn rd-btn--primary" disabled={runningBulk || !members.length} onClick={() => void runBulk("deploy")}>Deploy in order</button>
            <button type="button" className="rd-btn rd-btn--quiet" disabled={runningBulk || !members.length} onClick={() => void runBulk("restart")}>Restart in order</button>
            {runningBulk && <button type="button" className="rd-btn rd-btn--danger-quiet" onClick={() => { stopRef.current = true; }}>■ Stop after current</button>}
            <span className="rd-spacer" />
            <button type="button" className="rd-btn rd-btn--quiet" disabled={logsBusy} onClick={() => void loadGroupLogs()}>{logsBusy ? "Loading logs…" : "Find errors in logs"}</button>
            <button type="button" className="rd-btn rd-btn--quiet" disabled={driftBusy} onClick={() => void compareConfig()}>{driftBusy ? "Comparing…" : "Compare configuration"}</button>
          </div>
          {progress && <ol className="rd-progress" aria-live="polite">{progress.rows.map((r) => <li key={r.key} className={"is-" + r.status}><span className="rd-progress__mark" aria-hidden="true">{({ done: "✓", failed: "✕", running: "…", skipped: "–", pending: "·" })[r.status]}</span><div><strong>{r.name}</strong><small>{r.status}{r.note ? " — " + r.note : ""}</small></div></li>)}</ol>}
        </Section>

        {(groupLogs.length > 0 || drift.length > 0) && <Section title="Findings" subtitle="Best-effort scan of the last hour of application logs and variable names. Missing data is not treated as healthy.">
          {groupLogs.length > 0 && <>
            <div className="rd-toolrow"><strong>{errorLogs.length} error line(s) across {new Set(groupLogs.map((l) => l.serviceId)).size} service(s)</strong><span className="rd-spacer" /><input className="rd-field rd-field--inline" type="search" placeholder="Search all logs…" aria-label="Search group logs" value={logSearch} onChange={(e) => setLogSearch(e.target.value)} /></div>
            <div className="rd-logs" role="log" aria-label="Group logs">
              {groupLogs.filter((l) => !logSearch.trim() || (String(l.message || "") + " " + l.serviceName).toLowerCase().includes(logSearch.trim().toLowerCase())).map((l, i) => <div key={l.serviceId + "-" + (l.id || i)} className={"rd-log" + (isErrorLog(l) ? " is-error" : "")}><time>{l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : "—"} · {l.serviceName}</time><code>{l.message || "(empty log entry)"}</code></div>)}
            </div>
          </>}
          {drift.length > 0 && <div className="rd-drift">{drift.map((item) => <article key={item.key}><strong>{item.name}</strong><small>{item.error || item.keys.length + " variable names"}</small>{item.missing.length > 0 ? <span className="rd-warn">Missing: {item.missing.join(", ")}</span> : !item.error && <span className="rd-ok">In sync</span>}</article>)}</div>}
        </Section>}

        <Section title="Dependency map" subtitle="Document request or job flow. Informational only — this does not change Render routing.">
          <div className="rd-toolrow">
            <label className="rd-inline">Upstream<select value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Select service</option>{members.map((s) => <option key={serviceKey(s)} value={serviceKey(s)}>{s.name}</option>)}</select></label>
            <span aria-hidden="true">→</span>
            <label className="rd-inline">Downstream<select value={to} onChange={(e) => setTo(e.target.value)}><option value="">Select service</option>{members.map((s) => <option key={serviceKey(s)} value={serviceKey(s)}>{s.name}</option>)}</select></label>
            <button type="button" className="rd-btn rd-btn--quiet" disabled={saving || !from || !to || from === to} onClick={() => void addDependency()}>Add link</button>
          </div>
          <ul className="rd-edges">{(group.dependencies || []).map((edge) => <li key={edge.from + ">" + edge.to}><span>{members.find((s) => serviceKey(s) === edge.from)?.name || edge.from}</span><span aria-hidden="true">→</span><span>{members.find((s) => serviceKey(s) === edge.to)?.name || edge.to}</span><button type="button" className="rd-icon-btn rd-icon-btn--danger" aria-label="Remove dependency" onClick={() => void removeDependency(edge.from, edge.to)}>×</button></li>)}{!(group.dependencies || []).length && <li className="rd-muted">No dependencies mapped yet.</li>}</ul>
        </Section>

        <Section title="Cost & budget guardrails" subtitle="Enter your own approximate monthly cost per service. These are estimates, not live Render billing.">
          {(() => {
            const total = members.reduce((sum, s) => sum + Number(group.serviceCostEstimates?.[serviceKey(s)] || 0), 0);
            const budget = Number(group.monthlyBudgetUsd || 0);
            const covered = group.serviceKeys.filter((k) => Object.prototype.hasOwnProperty.call(group.serviceCostEstimates || {}, k)).length;
            const money = (n) => "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            return <>
              <div className="rd-kpis rd-kpis--3">
                <Kpi label="Configured estimate" value={money(total)} hint="USD / month · manual inputs" />
                <Kpi label="Monthly budget" value={budget > 0 ? money(budget) : "Not set"} tone={budget > 0 && covered === group.serviceKeys.length && total > budget ? "danger" : undefined} hint={covered < group.serviceKeys.length ? "Coverage " + covered + "/" + group.serviceKeys.length + " — complete all estimates to enable alerts" : budget > 0 && total > budget ? "Above budget — incident on next sample" : "Evaluated on each monitoring sample"} />
                <label className="rd-kpi rd-kpi--input"><span>Set monthly budget (USD)</span><input key={group.id + "-b"} className="rd-field" type="number" min="0" max="1000000" step="0.01" defaultValue={group.monthlyBudgetUsd || ""} placeholder="e.g. 25.00" onBlur={(e) => void saveBudget(e.target.value)} /></label>
              </div>
              <div className="rd-costrows">{members.map((s) => { const key = serviceKey(s); return <label key={group.id + key}><span>{s.name}<small>{s.serviceDetails?.plan || s.serviceDetails?.buildPlan || "Plan not provided"}</small></span><span className="rd-money"><i>$</i><input className="rd-field" type="number" min="0" max="100000" step="0.01" aria-label={"Monthly estimate for " + s.name} defaultValue={group.serviceCostEstimates?.[key] ?? ""} placeholder="0.00" onBlur={(e) => void saveEstimate(key, e.target.value)} /></span></label>; })}</div>
            </>;
          })()}
        </Section>

        {databases.length > 0 && <Section title="Database export freshness" subtitle="Latest manual export jobs returned by Render — not a view of automatic backups." actions={<button type="button" className="rd-btn rd-btn--quiet" disabled={running} onClick={() => void sampleNow()}>Refresh</button>}>
          <ul className="rd-edges">{databases.map((db) => <li key={db.key || db.serviceId}><span>{db.name || db.serviceId}</span><span className="rd-muted">{db.latestManualExport?.status === "unavailable" ? "Export history unavailable" : db.latestManualExport?.createdAt ? "Last manual export " + timeAgo(db.latestManualExport.createdAt) : "No manual export returned"}</span><span className="rd-muted">{db.latestManualExport?.status || "—"}</span></li>)}</ul>
        </Section>}
      </>}
    </div>
  );
}

/* ====================================================================== Incidents */

export function IncidentsView({ ops, onSample }) {
  const { incidents, openIncidents, loading, running } = ops;
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  // An "open" event is only still open if nothing later resolved it.
  const activeIds = useMemo(() => new Set(openIncidents.map((i) => i.id)), [openIncidents]);
  const isActive = (i) => i.state === "open" && activeIds.has(i.id);
  const rows = useMemo(() => [...incidents]
    .sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0))
    .filter((i) => (filter === "all" || (filter === "open" ? activeIds.has(i.id) : !activeIds.has(i.id))) && (!query.trim() || [i.message, i.type, i.groupName, i.serviceName].join(" ").toLowerCase().includes(query.trim().toLowerCase()))), [incidents, filter, query, activeIds]);

  return (
    <Section title="Incident timeline" subtitle="Health, resource-threshold and budget transitions recorded by persistent monitoring."
      actions={<button type="button" className="rd-btn rd-btn--quiet" disabled={running} onClick={onSample}>{running ? "Sampling…" : "Sample now"}</button>}>
      <div className="rd-kpis rd-kpis--3">
        <Kpi label="Open now" value={openIncidents.length} tone={openIncidents.length ? "danger" : "ok"} hint={openIncidents.length ? "Needs attention" : "All clear"} />
        <Kpi label="Events recorded" value={incidents.length} />
        <Kpi label="Latest event" value={incidents.length ? timeAgo(incidents.reduce((a, i) => (Date.parse(i.at || 0) > Date.parse(a || 0) ? i.at : a), 0)) : "—"} />
      </div>
      <div className="rd-toolrow">
        <div className="rd-segmented" role="group" aria-label="Filter incidents">{[["all", "All"], ["open", "Open"], ["resolved", "Resolved"]].map(([v, l]) => <button key={v} type="button" aria-pressed={filter === v} className={filter === v ? "is-active" : ""} onClick={() => setFilter(v)}>{l}</button>)}</div>
        <input className="rd-field rd-field--inline" type="search" placeholder="Search incidents…" aria-label="Search incidents" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {loading && !incidents.length ? <Skeleton lines={5} height={44} /> : (
        <ul className="rd-incidents">
          {rows.slice(0, 100).map((i, index) => (
            <li key={i.id || i._id || index} className={"rd-incident " + (isActive(i) ? "is-open" : "is-resolved")}>
              <span className="rd-incident__mark" aria-hidden="true">{isActive(i) ? "!" : "✓"}</span>
              <div><strong>{i.message || i.type}</strong><small>{i.groupName || "Group"} · {i.serviceName || "Service"} · {i.at ? formatDateTime(i.at) : "—"}</small></div>
              {i.severity && <span className={"rd-sev is-" + i.severity}>{i.severity}</span>}
              <span className="rd-incident__state">{i.state === "open" && !isActive(i) ? "superseded" : i.state || "event"}</span>
            </li>
          ))}
          {!rows.length && <Empty icon="✓" title={incidents.length ? "No incidents match" : "No incidents recorded"}>{incidents.length ? "Change the filter or search." : "Run a sample or enable monitoring after configuring a group."}</Empty>}
        </ul>
      )}
    </Section>
  );
}

/* ====================================================================== Alert policy */

export function AlertPolicyView({ ops, askConfirm }) {
  const { config, monitor, setMonitor, telegramBotToken, setTelegramBotToken, telegramChatId, setTelegramChatId, saving, running, persist, sampleNow, testTelegram, clearTelegram, exportReport } = ops;
  const setThreshold = (key, min, max) => (e) => {
    const n = Number(e.target.value);
    setMonitor((old) => ({ ...old, thresholds: { ...old.thresholds, [key]: Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : old.thresholds?.[key] } }));
  };
  const toggle = async () => {
    const next = { ...monitor, enabled: !monitor.enabled };
    setMonitor(next);
    try { await persist({ monitor: next }); } catch { setMonitor(monitor); }
  };
  const remove = async () => {
    const ok = await askConfirm({ title: "Remove Telegram channel?", message: "The saved bot token and chat ID will be deleted from your Stashr account.", confirmLabel: "Remove", danger: true });
    if (ok) { try { await clearTelegram(); } catch { /* toast shown */ } }
  };

  return (
    <div className="rd-stack">
      <Section title="Monitoring policy" subtitle="Encrypted in your Stashr account. A trusted scheduler must call the backend tick endpoint for sampling while the browser is closed (bounded to 15 unique services per user tick)."
        actions={<button type="button" className="rd-btn rd-btn--primary" disabled={saving} onClick={() => void persist()}>{saving ? "Saving…" : "Save settings"}</button>}>
        <div className="rd-statusline">
          <span className={"rd-pill " + (monitor.enabled ? "is-active" : "is-paused")}><i aria-hidden="true" />{monitor.enabled ? "Monitoring enabled" : "Monitoring paused"}</span>
          <span className={"rd-pill " + (config?.schedulerConfigured ? "is-active" : "is-suspended")}><i aria-hidden="true" />{config?.schedulerConfigured ? "Scheduler secret configured" : "Scheduler secret missing on API"}</span>
          <button type="button" className="rd-btn rd-btn--quiet" disabled={saving} onClick={() => void toggle()}>{monitor.enabled ? "■ Pause monitoring" : "▶ Enable monitoring"}</button>
        </div>
        <div className="rd-formgrid">
          <label>Sampling interval<select value={monitor.intervalMinutes || 5} onChange={(e) => setMonitor((o) => ({ ...o, intervalMinutes: Number(e.target.value) }))}><option value="5">5 minutes</option><option value="10">10 minutes</option><option value="15">15 minutes</option></select></label>
          <label className="rd-check rd-check--box"><input type="checkbox" checked={monitor.checkHealth !== false} onChange={(e) => setMonitor((o) => ({ ...o, checkHealth: e.target.checked }))} /> Probe service URLs for health</label>
          <label>CPU alert (%)<input className="rd-field" type="number" min="1" max="100" value={monitor.thresholds?.cpu ?? 85} onChange={setThreshold("cpu", 1, 100)} /></label>
          <label>Memory alert (%)<input className="rd-field" type="number" min="1" max="100" value={monitor.thresholds?.memory ?? 90} onChange={setThreshold("memory", 1, 100)} /></label>
          <label>Latency alert (ms)<input className="rd-field" type="number" min="100" max="60000" value={monitor.thresholds?.latencyMs ?? 1500} onChange={setThreshold("latencyMs", 100, 60000)} /></label>
        </div>
        <p className="rd-note">Samples CPU, memory and HTTP latency where Render exposes them. Metrics Render doesn’t return are shown as unavailable, not zero.</p>
      </Section>

      <Section title="Telegram notifications" subtitle={config?.notifications?.telegramConfigured ? "Configured — new incidents are sent to your chat." : "Not configured."}>
        <div className="rd-formgrid">
          <label>Bot token<input className="rd-field" type="password" autoComplete="new-password" placeholder={config?.notifications?.telegramConfigured ? "Saved securely (enter to rotate)" : "Paste bot token from BotFather"} value={telegramBotToken} onChange={(e) => setTelegramBotToken(e.target.value)} /></label>
          <label>Chat ID<input className="rd-field" autoComplete="off" placeholder="Chat or group ID" value={telegramChatId} onChange={(e) => setTelegramChatId(e.target.value)} /></label>
        </div>
        <div className="rd-toolrow">
          <button type="button" className="rd-btn rd-btn--quiet" disabled={saving} onClick={() => void testTelegram()}>Send test message</button>
          {config?.notifications?.telegramConfigured && <button type="button" className="rd-btn rd-btn--danger-quiet" disabled={saving} onClick={() => void remove()}>Remove channel</button>}
        </div>
      </Section>

      <Section title="Data & reports" subtitle="Download the stored monitoring history and incidents.">
        <div className="rd-toolrow">
          <button type="button" className="rd-btn rd-btn--quiet" disabled={running} onClick={() => void sampleNow()}>{running ? "Sampling…" : "Sample now"}</button>
          <button type="button" className="rd-btn rd-btn--quiet" onClick={() => void exportReport("csv")}>Export CSV</button>
          <button type="button" className="rd-btn rd-btn--quiet" onClick={() => void exportReport("json")}>Export JSON</button>
        </div>
      </Section>
    </div>
  );
}
