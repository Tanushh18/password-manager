import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import { Link } from "react-router-dom";
import {
  getRenderMetrics, getRenderLogs, getRenderEnvVars, getRenderDeploys, triggerRenderDeploy, getRenderEvents,
  restartRenderService, checkRenderHealth
} from "../../api/client";
import { Kpi, Section, Skeleton, Empty, LineChart, Sparkline } from "./RenderUi";
import { usePolling } from "./renderHooks";
import { RobotSquad } from "./RobotArmy";
import {
  serviceKind, serviceKey, normalizeList, sumMetricPoints, peakOf, rangeStart, timeAgo, formatDateTime,
  formatTime, isErrorLog, errorMessage, remediationFor, incidentTypeLabel, formatDuration, formatMetric, groupServices, METRIC_OPTIONS, RANGE_OPTIONS
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

export function MonitoringView({ services, series, ops, selectedGroupId, onSelectGroup, askConfirm, onOpenService, onRefreshServices, onAudit, onGoServices }) {
  const { groups, history, saving, running, persist, sampleNow } = ops;
  // Every app (servers from the same repo) is a ready-made group; your own groups come first.
  const appGroups = useMemo(() => groupServices(services.filter((s) => s.suspended !== "suspended"))
    .map((g) => ({ id: "app:" + g.key, name: g.name, serviceKeys: g.members.map(serviceKey), app: true })), [services]);
  const group = groups.find((g) => g.id === selectedGroupId) || appGroups.find((g) => g.id === selectedGroupId) || null;
  useEffect(() => { if (!selectedGroupId && appGroups.length) onSelectGroup(groups[0]?.id || appGroups[0].id); }, [selectedGroupId, appGroups, groups]); // eslint-disable-line react-hooks/exhaustive-deps
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

  /* Extra tools are off by default to keep the page simple; switched on per browser. */
  const EXTRAS = [["findings", "Logs & config compare"], ["deps", "Dependency map"], ["cost", "Cost & budget"], ["db", "Database exports"]];
  const [extras, setExtras] = useState(() => { try { return JSON.parse(localStorage.getItem("stashr_monitor_extras") || "{}"); } catch { return {}; } });
  const toggleExtra = (k) => setExtras((old) => { const next = { ...old, [k]: !old[k] }; try { localStorage.setItem("stashr_monitor_extras", JSON.stringify(next)); } catch { /* private mode */ } return next; });

  /* Render's event log for every member: crashes, restarts, deploys (newest first). */
  const [events, setEvents] = useState([]);
  useEffect(() => {
    let live = true;
    setEvents([]);
    if (!group || !members.length) return undefined;
    Promise.all(members.slice(0, 10).map(async (s) => {
      try { const r = await getRenderEvents(s.accountId, s.id, rangeStart(range)); return (r.events || []).map((e) => ({ ...e, serviceName: s.name, key: serviceKey(s) })); }
      catch { return []; }
    })).then((lists) => { if (live) setEvents(lists.flat().filter((e) => e.at && Date.parse(e.at) >= Date.parse(rangeStart(range))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))); });
    return () => { live = false; };
  }, [group?.id, range, members.length]); // eslint-disable-line react-hooks/exhaustive-deps


  const latestSample = useMemo(() => group ? history.filter((h) => h.groupId === group.id).reduce((best, h) => (!best || Date.parse(h.sampledAt || 0) > Date.parse(best.sampledAt || 0) ? h : best), null) : null, [history, group]);
  const databases = (latestSample?.services || []).filter((s) => String(s.type || "").toLowerCase().includes("postgres") || String(s.serviceId || "").startsWith("dpg-"));

  /* --- group logs & drift --- */
  const [groupLogs, setGroupLogs] = useState([]);
  const [logsBusy, setLogsBusy] = useState(false);
  const [logSearch, setLogSearch] = useState("");
  const [simpleGroupLogs, setSimpleGroupLogs] = useState(true);
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

  const errorLogs = groupLogs.filter(isErrorLog);  const displayGroupLogs = useMemo(() => {
    if (!simpleGroupLogs) return groupLogs.map((entry) => ({ ...entry, repeatCount: 1 }));
    const rows = [];
    for (const entry of groupLogs) {
      const normalized = String(entry.message || "(empty log entry)").replace(/\s+/g, " ").trim();
      const previous = rows[rows.length - 1];
      if (previous && previous.serviceId === entry.serviceId && previous.normalized === normalized) previous.repeatCount += 1;
      else rows.push({ ...entry, normalized, repeatCount: 1 });
    }
    return rows;
  }, [groupLogs, simpleGroupLogs]);

  return (
    <div className="rd-stack">
      <Section title="Server groups" subtitle="Compare related Render services side by side — for example a Fetcher, Validator and User server."
        actions={<>
          <select aria-label="Select a server group" value={selectedGroupId} onChange={(e) => onSelectGroup(e.target.value)}>
            <option value="">Choose an app or group</option>
            {groups.length > 0 && <optgroup label="Your groups">{groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.serviceKeys.length})</option>)}</optgroup>}
            <optgroup label="Apps (automatic)">{appGroups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.serviceKeys.length} server{g.serviceKeys.length === 1 ? "" : "s"})</option>)}</optgroup>
          </select>
          <button type="button" className="rd-btn rd-btn--quiet" onClick={onGoServices}>＋ New group</button>
        </>}>
        {!group && <Empty icon="◫" title={groups.length ? "Choose a group" : "Create your first group"} action={!groups.length && <button type="button" className="rd-btn rd-btn--primary" onClick={onGoServices}>Select servers</button>}>
          {groups.length ? "Pick a saved group to see metrics, errors and group-level actions." : "Tick two or more servers in the Servers view, then choose “Group selected”."}
        </Empty>}

        {group && <>
          <div className="rd-toolrow">
            <label className="rd-inline">Metric<select value={metric} onChange={(e) => setMetric(e.target.value)}>{METRIC_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label className="rd-inline">Range<select value={range} onChange={(e) => setRange(e.target.value)}>{RANGE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label className="rd-check" title="Re-reads this chart from Render every 5 minutes"><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Refresh chart every 5 min</label>
            <span className="rd-spacer" />
            <button type="button" className="rd-btn rd-btn--quiet" disabled={metricBusy} onClick={() => void loadMetrics()}>↻ Refresh</button>
            <button type="button" className="rd-btn rd-btn--quiet" disabled={running} onClick={() => void sampleNow()} title="Runs the monitor right now for every server: health check, last deploy and CPU / memory / latency. Problems open an incident. It also runs on its own every 5 minutes.">{running ? "Checking…" : "Check all servers now"}</button>
            {!group.app && <button type="button" className="rd-btn rd-btn--danger-quiet" onClick={() => void deleteGroup()}>Delete group</button>}
          </div>
          {series && <RobotSquad services={members} series={series} onOpen={(key) => { const s = members.find((m) => serviceKey(m) === key); if (s) onOpenService(s); }} title={group.name + " squad"} />}
          <p className="rd-muted">{members.length} of {group.serviceKeys.length} services currently available{members.length < group.serviceKeys.length ? " — some members may belong to a disconnected account." : "."}</p>

          {metricBusy && !snapshot ? <Skeleton lines={6} height={18} /> : snapshot && (() => {
            const fmt = (v, u) => formatMetric(v, u, metric);
            const metricLabel = METRIC_OPTIONS.find(([v]) => v === metric)?.[1] || metric;
            const withData = snapshot.services.filter((s) => s.points.length);
            const busiest = withData.reduce((b, s) => (!b || (s.current ?? -1) > (b.current ?? -1) ? s : b), null);
            const top = withData.reduce((b, s) => (!b || (s.peak ?? -1) > (b.peak ?? -1) ? s : b), null);
            const crashes = events.filter((e) => e.type === "server_failed");
            const restarts = events.filter((e) => e.type === "server_restarted");
            const countFor = (list, key) => list.filter((e) => e.key === key).length;
            const EVENT = {
              server_failed: ["bad", "crashed"], server_restarted: ["mid", "restarted"], server_available: ["ok", "is back up"],
              deploy_started: ["mid", "deploy started"], deploy_ended: ["ok", "deploy finished"], build_started: ["mid", "build started"], build_ended: ["ok", "build finished"],
              service_suspended: ["mid", "was suspended"], service_resumed: ["ok", "was resumed"], suspended: ["mid", "was suspended"], resumed: ["ok", "was resumed"]
            };
            const describe = (e) => {
              const [tone, text] = EVENT[e.type] || ["mid", e.type.replace(/_/g, " ")];
              const failed = /fail|cancel/i.test(String(e.details?.status || ""));
              return [failed ? "bad" : tone, text + (e.details?.status && /ended|finished/.test(text) ? " (" + String(e.details.status).replace(/_/g, " ") + ")" : "") + (e.details?.reason ? " — " + e.details.reason : "") + (e.details?.trigger ? " · by " + e.details.trigger.replace(/_/g, " ") : "")];
            };
            const timeline = [
              ...events.map((e) => ({ at: e.at, who: e.serviceName, key: e.key, ...(([tone, text]) => ({ tone, text }))(describe(e)) })),
              ...withData.filter((s) => s.peakAt).map((s) => ({ at: s.peakAt, who: s.name, key: s.key, tone: "peak", text: "peak " + metricLabel.toLowerCase() + ": " + fmt(s.peak, s.unit) }))
            ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 60);
            return <>
              <div className="rd-kpis">
                <Kpi label={"Busiest now · " + metricLabel} value={busiest ? fmt(busiest.current, busiest.unit) : "—"} hint={busiest ? busiest.name : "No data"} />
                <Kpi label="Highest peak in range" value={top ? fmt(top.peak, top.unit) : "—"} hint={top ? top.name + " at " + formatTime(top.peakAt) : "No data"} />
                <Kpi label="Crashes in range" value={crashes.length} tone={crashes.length ? "danger" : "ok"} hint={crashes.length ? crashes[0].serviceName + " · last " + timeAgo(crashes[0].at) : "None"} />
                <Kpi label="Restarts in range" value={restarts.length} tone={restarts.length ? "warn" : undefined} hint={restarts.length ? restarts[0].serviceName + " · last " + timeAgo(restarts[0].at) : "None"} />
              </div>
              <div className="rd-monitor">
                <div className="rd-monitor__chart">
                  <h3 className="rd-monitor__title">{metricLabel} per server <small>red lines = crashes · hover for exact values</small></h3>
                  <LineChart series={snapshot.services.map((s) => ({ key: s.key, name: s.name, points: s.points }))} metric={metricLabel} format={fmt}
                    markers={Object.values(crashes.reduce((acc, e) => { const k = String(e.at).slice(0, 16); (acc[k] = acc[k] || { at: e.at, names: [] }).names.push(e.serviceName); return acc; }, {}))
                      .map((m) => ({ at: m.at, label: m.names.length > 1 ? m.names.length + " crashed" : m.names[0], title: [...new Set(m.names)].join(", ") + " crashed at " + formatDateTime(m.at) }))} />
                </div>
                <div className="rd-monitor__log">
                  <h3 className="rd-monitor__title">What happened <small>{RANGE_OPTIONS.find(([v]) => v === range)?.[1]}</small></h3>
                  {timeline.length ? <ol className="rd-timeline">{timeline.map((t, i) => (
                    <li key={i} className={"is-" + t.tone}><time title={formatDateTime(t.at)}>{formatTime(t.at)}</time><div><strong>{t.who}</strong> {t.text}<small>{timeAgo(t.at)}</small></div></li>
                  ))}</ol> : <p className="rd-muted">Nothing recorded in this period: no crashes, restarts or deploys.</p>}
                </div>
              </div>
              <div className="rd-tablewrap"><table className="rd-table rd-table--compact">
                <thead><tr><th scope="col">Server</th><th scope="col">Account</th><th scope="col">Now</th><th scope="col">Peak</th><th scope="col">Peak at</th><th scope="col">Crashes</th><th scope="col">Restarts</th><th scope="col"><span className="rd-sr">Open</span></th></tr></thead>
                <tbody>{snapshot.services.map((item) => <tr key={item.key}>
                  <td><strong>{item.name}</strong>{item.error ? <small className="rd-warn" style={{ display: "block" }}>{item.error}</small> : null}</td><td>{item.accountName}</td>
                  <td>{fmt(item.current, item.unit)}</td><td>{fmt(item.peak, item.unit)}</td><td>{item.peakAt ? formatDateTime(item.peakAt) : "—"}</td>
                  <td className={countFor(crashes, item.key) ? "rd-warn" : ""}>{countFor(crashes, item.key)}</td><td>{countFor(restarts, item.key)}</td>
                  <td><button type="button" className="rd-btn rd-btn--quiet" onClick={() => { const s = services.find((c) => serviceKey(c) === item.key); if (s) onOpenService(s); }}>Details</button></td>
                </tr>)}</tbody>
              </table></div>
            </>;
          })()}
        </>}
      </Section>

      {group && <>
        <Section title="Group actions" subtitle="Run an operation across the group in dependency-friendly order, with live status.">
          <div className="rd-toolrow">
            <button type="button" className="rd-btn rd-btn--primary" disabled={runningBulk || !members.length} onClick={() => void runBulk("deploy")}>Deploy in order</button>
            <button type="button" className="rd-btn rd-btn--quiet" disabled={runningBulk || !members.length} onClick={() => void runBulk("restart")}>Restart in order</button>
            {runningBulk && <button type="button" className="rd-btn rd-btn--danger-quiet" onClick={() => { stopRef.current = true; }}>■ Stop after current</button>}
            <span className="rd-spacer" />
            {extras.findings && <button type="button" className="rd-btn rd-btn--quiet" disabled={logsBusy} onClick={() => void loadGroupLogs()}>{logsBusy ? "Loading logs…" : "Find errors in logs"}</button>}
            {extras.findings && <button type="button" className="rd-btn rd-btn--quiet" disabled={driftBusy} onClick={() => void compareConfig()}>{driftBusy ? "Comparing…" : "Compare configuration"}</button>}
          </div>
          {progress && <ol className="rd-progress" aria-live="polite">{progress.rows.map((r) => <li key={r.key} className={"is-" + r.status}><span className="rd-progress__mark" aria-hidden="true">{({ done: "✓", failed: "✕", running: "…", skipped: "–", pending: "·" })[r.status]}</span><div><strong>{r.name}</strong><small>{r.status}{r.note ? " — " + r.note : ""}</small></div></li>)}</ol>}
        </Section>

        <div className="rd-extras" role="group" aria-label="More tools">
          <span>More tools</span>
          {EXTRAS.filter(([k]) => !group.app || k === "findings" || k === "db").map(([k, label]) => <label key={k} className="rd-check"><input type="checkbox" checked={Boolean(extras[k])} onChange={() => toggleExtra(k)} /> {label}</label>)}
          {group.app && <small className="rd-muted">Cost and dependency tools are available for groups you create.</small>}
        </div>

        {extras.findings && (groupLogs.length > 0 || drift.length > 0) && <Section title="Findings" subtitle="Best-effort scan of the last hour of application logs and variable names. Missing data is not treated as healthy.">
          {groupLogs.length > 0 && <>
            <div className="rd-toolrow"><strong>{errorLogs.length} error line(s) across {new Set(groupLogs.map((l) => l.serviceId)).size} service(s)</strong><span className="rd-spacer" /><input className="rd-field rd-field--inline" type="search" placeholder="Search all logs…" aria-label="Search group logs" value={logSearch} onChange={(e) => setLogSearch(e.target.value)} /><button type="button" className={"rd-btn rd-btn--quiet" + (simpleGroupLogs ? " is-active" : "")} aria-pressed={simpleGroupLogs} onClick={() => setSimpleGroupLogs((v) => !v)}>{simpleGroupLogs ? "Simple view" : "Raw lines"}</button></div>
            <div className="rd-logs" role="log" aria-label="Group logs">
              {displayGroupLogs.filter((l) => !logSearch.trim() || (String(l.message || "") + " " + l.serviceName).toLowerCase().includes(logSearch.trim().toLowerCase())).map((l, i) => <div key={l.serviceId + "-" + (l.id || i)} className={"rd-log" + (isErrorLog(l) ? " is-error" : "")}><time>{l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : "—"} · {l.serviceName}</time><code>{l.message || "(empty log entry)"}</code>{l.repeatCount > 1 && <span className="rd-log__repeat">×{l.repeatCount}</span>}</div>)}
            </div>
          </>}
          {drift.length > 0 && <div className="rd-drift">{drift.map((item) => <article key={item.key}><strong>{item.name}</strong><small>{item.error || item.keys.length + " variable names"}</small>{item.missing.length > 0 ? <span className="rd-warn">Missing: {item.missing.join(", ")}</span> : !item.error && <span className="rd-ok">In sync</span>}</article>)}</div>}
        </Section>}

        {extras.deps && !group.app && <Section title="Dependency map" subtitle="Document request or job flow. Informational only — this does not change Render routing.">
          <div className="rd-toolrow">
            <label className="rd-inline">Upstream<select value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Select service</option>{members.map((s) => <option key={serviceKey(s)} value={serviceKey(s)}>{s.name}</option>)}</select></label>
            <span aria-hidden="true">→</span>
            <label className="rd-inline">Downstream<select value={to} onChange={(e) => setTo(e.target.value)}><option value="">Select service</option>{members.map((s) => <option key={serviceKey(s)} value={serviceKey(s)}>{s.name}</option>)}</select></label>
            <button type="button" className="rd-btn rd-btn--quiet" disabled={saving || !from || !to || from === to} onClick={() => void addDependency()}>Add link</button>
          </div>
          <ul className="rd-edges">{(group.dependencies || []).map((edge) => <li key={edge.from + ">" + edge.to}><span>{members.find((s) => serviceKey(s) === edge.from)?.name || edge.from}</span><span aria-hidden="true">→</span><span>{members.find((s) => serviceKey(s) === edge.to)?.name || edge.to}</span><button type="button" className="rd-icon-btn rd-icon-btn--danger" aria-label="Remove dependency" onClick={() => void removeDependency(edge.from, edge.to)}>×</button></li>)}{!(group.dependencies || []).length && <li className="rd-muted">No dependencies mapped yet.</li>}</ul>
        </Section>}

        {extras.cost && !group.app && <Section title="Cost & budget guardrails" subtitle="Enter your own approximate monthly cost per service. These are estimates, not live Render billing.">
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
        </Section>}

        {extras.db && databases.length > 0 && <Section title="Database export freshness" subtitle="Latest manual export jobs returned by Render — not a view of automatic backups." actions={<button type="button" className="rd-btn rd-btn--quiet" disabled={running} onClick={() => void sampleNow()}>Refresh</button>}>
          <ul className="rd-edges">{databases.map((db) => <li key={db.key || db.serviceId}><span>{db.name || db.serviceId}</span><span className="rd-muted">{db.latestManualExport?.status === "unavailable" ? "Export history unavailable" : db.latestManualExport?.createdAt ? "Last manual export " + timeAgo(db.latestManualExport.createdAt) : "No manual export returned"}</span><span className="rd-muted">{db.latestManualExport?.status || "—"}</span></li>)}</ul>
        </Section>}
      </>}
    </div>
  );
}

/* ====================================================================== Incidents */

const PAGE = 40;
const RESOLVED_BY = { recovered: "Recovered on its own", manual: "Closed manually", auto: "Closed automatically", check: "Verified by a check" };

/* ====================================================================== Incident details */

const clock = (value) => (value ? new Date(value).toISOString().slice(11, 16) + " UTC" : "—");
const pctText = (value) => (value == null ? "—" : value + "%");

/** Everything known about one incident: cause, timeline, load at the time, the deploy it followed, and what to do next. */
function IncidentDetails({ event }) {
  const d = event?.details || {};
  const t = d.timeline || {};
  const load = d.load || {};
  const trend = d.trend || [];
  const hasLoad = load.cpuPct != null || load.memoryPct != null || load.latencyMs != null;
  return (
    <div className="rd-inc__details">
      {d.hints?.length ? <ul className="rd-inc__hints">{d.hints.map((h) => <li key={h}>💡 {h}</li>)}</ul> : null}
      <dl className="rd-kv rd-inc__facts">
        {t.lastHealthyAt && <div><dt>Last healthy</dt><dd>{clock(t.lastHealthyAt)}</dd></div>}
        {t.firstFailureAt && <div><dt>First failure</dt><dd>{clock(t.firstFailureAt)}</dd></div>}
        <div><dt>Incident opened</dt><dd>{clock(t.openedAt || event.openedAt)}</dd></div>
        {t.peakAt && <div><dt>Load peaked</dt><dd>{clock(t.peakAt)}</dd></div>}
        {d.probe && <div className="rd-kv__wide"><dt>Last probe</dt><dd>{d.probe.state}{d.probe.status ? " · HTTP " + d.probe.status : ""}{d.probe.path ? " on " + d.probe.path : ""}{d.probe.latencyMs != null ? " · " + d.probe.latencyMs + " ms" : ""}</dd></div>}
        {hasLoad && <div className="rd-kv__wide"><dt>Load then</dt><dd>CPU {pctText(load.cpuPct)} (peak {pctText(load.cpuPeakPct)}) · memory {pctText(load.memoryPct)} (peak {pctText(load.memoryPeakPct)}){load.latencyMs != null ? " · " + load.latencyMs + " ms" : ""}</dd></div>}
        {d.deploy && <div className="rd-kv__wide"><dt>Latest deploy</dt><dd>{String(d.deploy.status).replace(/_/g, " ")}{d.deploy.ageMinutes != null ? " · " + formatDuration(d.deploy.ageMinutes * 60000) + " before" : ""}{d.deploy.commitMessage ? " · “" + d.deploy.commitMessage + "”" : ""}</dd></div>}
        {d.plan && <div><dt>Plan</dt><dd>{d.plan}</dd></div>}
        {d.flapsLastHour > 0 && <div><dt>Flapping</dt><dd>{d.flapsLastHour} earlier in the last hour</dd></div>}
      </dl>
      {trend.length > 1 && (
        <div className="rd-inc__trend" aria-label="The last checks before and during the incident">
          <div className="rd-inc__dots" role="img" aria-label="Health of the last checks">{trend.map((p, n) => <i key={n} className={"is-" + (p.state === "healthy" ? "ok" : p.state === "unhealthy" || p.state === "timeout" ? "bad" : "mid")} title={clock(p.at) + " · " + (p.state || "unknown")} />)}</div>
          <div><span>CPU</span><Sparkline values={trend.map((p) => p.cpuPct)} max={100} label="CPU before and during the incident" /></div>
          <div><span>Memory</span><Sparkline values={trend.map((p) => p.memoryPct)} max={100} label="Memory before and during the incident" /></div>
          <div><span>Latency</span><Sparkline values={trend.map((p) => p.latencyMs)} label="Latency before and during the incident" /></div>
        </div>
      )}
    </div>
  );
}

/** Incident management: real incidents (not raw events), stale ones flagged, and every state closable. */
export function IncidentsView({ ops, incidents, projectOf, onSample, askConfirm, onOpenService, onGoMonitoring }) {
  const { loading, running, groups, monitor } = ops;
  const [fixing, setFixing] = useState("");
  const [busy, setBusy] = useState("");
  const [tab, setTab] = useState("open");
  const [severity, setSeverity] = useState("all");
  const [groupId, setGroupId] = useState("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [checks, setChecks] = useState({}); // incident id -> { at, ok, text } (latest check result)
  const [checking, setChecking] = useState([]);
  const [expanded, setExpanded] = useState({}); // incident id -> details open

  const open = useMemo(() => incidents.filter((i) => i.status === "open" && !i.stale), [incidents]);
  const stale = useMemo(() => incidents.filter((i) => i.status === "open" && i.stale), [incidents]);
  const resolved = useMemo(() => incidents.filter((i) => i.status === "resolved"), [incidents]);
  const mttr = resolved.length ? resolved.reduce((sum, i) => sum + i.durationMs, 0) / resolved.length : null;
  const tabs = [["open", "Open", open.length], ...(stale.length ? [["stale", "Stale", stale.length]] : []), ["resolved", "Resolved", resolved.length], ["all", "All", incidents.length]];
  useEffect(() => { if (tab === "stale" && !stale.length) setTab("open"); }, [tab, stale.length]);
  useEffect(() => { setLimit(PAGE); }, [tab, severity, groupId, query]);

  const rows = useMemo(() => {
    const pool = tab === "open" ? open : tab === "stale" ? stale : tab === "resolved" ? resolved : incidents;
    const q = query.trim().toLowerCase();
    return pool.filter((i) => (severity === "all" || i.severity === severity) && (groupId === "all" || i.groupId === groupId)
      && (!q || [i.message, i.type, i.groupName, i.serviceName].join(" ").toLowerCase().includes(q)));
  }, [tab, open, stale, resolved, incidents, severity, groupId, query]);
  const groupOptions = useMemo(() => [...new Map(incidents.map((i) => [i.groupId, i.groupName])).entries()], [incidents]);

  const fix = async (incident) => {
    const plan = remediationFor(incident.event);
    if (!plan || fixing) return;
    const ok = await askConfirm({ title: plan.label + " " + incident.serviceName + "?", message: plan.confirm, confirmLabel: plan.label, danger: false });
    if (!ok) return;
    setFixing(incident.id);
    try {
      if (plan.action === "deploy") await triggerRenderDeploy(plan.target.accountId, plan.target.id, false);
      else await restartRenderService(plan.target.accountId, plan.target.id);
      toast.info(plan.label + " requested. Waiting for the service to recover…");
      const result = await waitForServiceReady(plan.target, { timeoutMs: plan.action === "deploy" ? 300000 : 90000, shouldStop: () => false });
      if (result.ok) toast.success(incident.serviceName + " is healthy again.");
      else toast.error(result.message || "The service has not recovered yet.");
      onSample();
    } catch (e) { toast.error(errorMessage(e, "Could not run the fix.")); }
    finally { setFixing(""); }
  };

  /* Check one incident against the live service. Health / deploy incidents can be verified directly and are closed
     when the problem is gone; resource and budget incidents need a fresh monitoring sample, which closes them itself. */
  const checkOne = async (incident) => {
    const [accountId, ...rest] = String(incident.serviceKey || "").split(":");
    const serviceId = rest.join(":");
    const note = (ok, text) => setChecks((old) => ({ ...old, [incident.id]: { at: new Date().toISOString(), ok, text } }));
    try {
      if (incident.type === "health" && accountId && serviceId) {
        const h = await checkRenderHealth(accountId, serviceId);
        if (h.state === "healthy") {
          await ops.resolveIncidents({ ids: [incident.id], verified: true, reason: "Verified healthy by a manual check" + (h.status ? " (HTTP " + h.status + ")" : "") + "." });
          note(true, "Healthy now" + (h.status ? " (HTTP " + h.status + ")" : "") + " — incident closed.");
          return "fixed";
        }
        note(false, h.state === "suspended" ? "The service is suspended." : "Still " + (h.state || "unhealthy") + (h.status ? " (HTTP " + h.status + ")" : "") + (h.message ? ": " + h.message : "") + ".");
        return "failing";
      }
      if (incident.type === "deploy_failure" && accountId && serviceId) {
        const deploys = normalizeList(await getRenderDeploys(accountId, serviceId), "deploy").sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
        const status = String(deploys[0]?.status || "unknown").toLowerCase();
        if (status === "live") {
          await ops.resolveIncidents({ ids: [incident.id], verified: true, reason: "Verified by a manual check: the latest deploy is live." });
          note(true, "Latest deploy is live — incident closed.");
          return "fixed";
        }
        note(false, "Latest deploy is " + status.replace(/_/g, " ") + (deploys[0]?.createdAt ? " (" + timeAgo(deploys[0].createdAt) + ")" : "") + ".");
        return "failing";
      }
      await onSample(); // CPU, memory, latency and budget: the monitor re-reads the numbers and closes it if it recovered
      note(true, "Re-checked metrics just now. If the numbers are back under the limit it closes automatically.");
      return "sampled";
    } catch (e) { note(false, errorMessage(e, "The check failed.")); return "error"; }
  };
  const runChecks = async (list) => {
    if (!list.length || checking.length) return;
    setChecking(list.map((i) => i.id));
    const results = [];
    for (const incident of list) { results.push(await checkOne(incident)); setChecking((old) => old.filter((id) => id !== incident.id)); }
    setChecking([]);
    const fixed = results.filter((r) => r === "fixed").length, failing = results.filter((r) => r === "failing" || r === "error").length;
    if (list.length > 1) (failing ? toast.info : toast.success)(fixed + " closed · " + failing + " still failing" + (results.length - fixed - failing ? " · " + (results.length - fixed - failing) + " re-sampled" : "") + ".");
    else if (results[0] === "fixed") toast.success("Healthy again — incident closed.");
    else if (results[0] === "failing") toast.error("Still failing. Details are under the incident.");
  };

  const resolve = async (list, title, message) => {
    if (!list.length || busy) return;
    const ok = await askConfirm({ title, message, confirmLabel: "Mark resolved", danger: false });
    if (!ok) return;
    setBusy("resolve");
    try { const r = await ops.resolveIncidents({ ids: list.map((i) => i.id) }); toast.success(r.resolved + " incident" + (r.resolved === 1 ? "" : "s") + " closed."); }
    catch { /* toast shown */ }
    finally { setBusy(""); }
  };
  const clearClosed = async () => {
    if (!resolved.length || busy) return;
    const ok = await askConfirm({ title: "Clear resolved history?", message: "Deletes the " + resolved.length + " resolved incident" + (resolved.length === 1 ? "" : "s") + " from your log. Open incidents are kept.", confirmLabel: "Clear history", danger: true });
    if (!ok) return;
    setBusy("clear");
    try { const r = await ops.clearHistory(); toast.success("Removed " + r.removed + " log entr" + (r.removed === 1 ? "y" : "ies") + "."); }
    catch { /* toast shown */ }
    finally { setBusy(""); }
  };

  const noGroups = !groups.length && monitor?.autoAll === false;
  return (
    <Section title="Incidents" subtitle="Each outage appears once, from the moment it opens until it is resolved. Stale ones are flagged so nothing is stuck open."
      actions={<>
        <button type="button" className="rd-btn rd-btn--quiet" onClick={() => void ops.exportReport("csv")} title="Download the incident log">⇩ Export</button>
        <button type="button" className="rd-btn rd-btn--quiet" disabled={running} onClick={onSample} title="Runs the monitor right now for every server (health, deploys, CPU / memory / latency). New problems open incidents; recovered ones close.">{running ? "Checking…" : "↻ Check all servers now"}</button>
      </>}>
      <div className="rd-kpis">
        <Kpi label="Open now" value={open.length} tone={open.length ? "danger" : "ok"} hint={open.length ? "Needs attention" : "All clear"} />
        <Kpi label="Stale" value={stale.length} tone={stale.length ? "warn" : undefined} hint={stale.length ? "Service or group is gone" : "None"} />
        <Kpi label="Resolved" value={resolved.length} hint="In the log" />
        <Kpi label="Avg time to fix" value={mttr == null ? "—" : formatDuration(mttr)} hint="Across resolved incidents" />
      </div>

      {noGroups && (
        <div className="rd-alert"><span aria-hidden="true">i</span><div>Incidents are recorded for <strong>server groups</strong>. Select two or more services in Services → “Group selected”, then turn monitoring on in Settings.{" "}
          {onGoMonitoring && <button type="button" className="rd-btn rd-btn--link" onClick={onGoMonitoring}>Open Monitoring</button>}</div></div>
      )}
      {(() => {
        const t = ops.status?.lastTick;
        const age = t ? Date.now() - Date.parse(t.completedAt) : null;
        if (!monitor?.enabled) return null;
        if (!t) return <div className="rd-alert rd-alert--warn"><span aria-hidden="true">▲</span><div>The background monitor has not run since the server last started{ops.status?.serverStartedAt ? " (" + timeAgo(ops.status.serverStartedAt) + ")" : ""}. It starts about 90 seconds after start-up and then runs every 5 minutes. Use “Check all servers now” to run it at once.</div></div>;
        return <div className={"rd-alert" + (age > 15 * 60000 ? " rd-alert--warn" : "")}><span aria-hidden="true">{age > 15 * 60000 ? "▲" : "✓"}</span><div>Monitor last ran {timeAgo(t.completedAt)} ({t.source === "external" ? "GitHub scheduler" : "server scheduler"}): checked {t.groupsChecked} app group{t.groupsChecked === 1 ? "" : "s"}, opened {t.incidentsOpened} new incident{t.incidentsOpened === 1 ? "" : "s"}.{age > 15 * 60000 ? " That is longer than usual — the server may have restarted or be asleep." : " Runs every 5 minutes."}</div></div>;
      })()}
      {!noGroups && !monitor?.enabled && (
        <div className="rd-alert"><span aria-hidden="true">i</span><div>Monitoring is off, so no new incidents are being recorded. Turn it on in Settings → Alert policy.</div></div>
      )}
      {monitor?.enabled && monitor?.autoAll !== false && (
        <div className="rd-alert"><span aria-hidden="true">i</span><div>Every running service is watched automatically (grouped by app), plus any groups you made. Server down, failed deploys and high CPU / memory / latency open an incident here.</div></div>
      )}
      {stale.length > 0 && (
        <div className="rd-alert rd-alert--warn" role="status"><span aria-hidden="true">▲</span>
          <div>{stale.length} open incident{stale.length === 1 ? " belongs" : "s belong"} to services or groups that no longer exist, so {stale.length === 1 ? "it" : "they"} can never recover on {stale.length === 1 ? "its" : "their"} own.</div>
          <button type="button" disabled={Boolean(busy)} onClick={() => void resolve(stale, "Close " + stale.length + " stale incident" + (stale.length === 1 ? "" : "s") + "?", "Their service or monitoring group no longer exists. They are marked resolved and kept in the log.")}>Close {stale.length === 1 ? "it" : "all"}</button>
        </div>
      )}

      <div className="rd-toolrow">
        <div className="rd-segmented" role="tablist" aria-label="Incident status">{tabs.map(([id, label, count]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}>{label} <small>{count}</small></button>)}</div>
        <select className="rd-field rd-field--inline" value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Filter by severity"><option value="all">Any severity</option><option value="critical">Critical</option><option value="warning">Warning</option></select>
        {groupOptions.length > 1 && <select className="rd-field rd-field--inline" value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label="Filter by group"><option value="all">All groups</option>{groupOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>}
        <input className="rd-field rd-field--inline" type="search" placeholder="Search incidents…" aria-label="Search incidents" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {(open.length > 0 || resolved.length > 0) && (
        <div className="rd-toolrow rd-toolrow--end">
          {open.length > 0 && <button type="button" className="rd-btn rd-btn--primary" disabled={Boolean(busy) || checking.length > 0} onClick={() => void runChecks(open)} title="Test every open incident against the live service and close the ones that are fixed">{checking.length ? "Checking " + checking.length + "…" : "🔍 Check all open (" + open.length + ")"}</button>}
          {open.length > 1 && <button type="button" className="rd-btn rd-btn--quiet" disabled={Boolean(busy)} onClick={() => void resolve(open, "Mark " + open.length + " incidents resolved?", "Use this once you have dealt with them. If a problem is still there, monitoring opens a fresh incident on the next check.")}>✓ Resolve all open ({open.length})</button>}
          {resolved.length > 0 && <button type="button" className="rd-btn rd-btn--danger-quiet" disabled={Boolean(busy)} onClick={() => void clearClosed()}>🗑 Clear resolved ({resolved.length})</button>}
        </div>
      )}

      {loading && !incidents.length ? <Skeleton lines={5} height={64} /> : (
        <ul className="rd-incidents">
          {rows.slice(0, limit).map((i) => {
            const plan = i.status === "open" && !i.stale ? remediationFor(i.event) : null;
            const state = i.status === "resolved" ? "resolved" : i.stale ? "stale" : "open";
            return (
              <li key={i.id} className={"rd-inc is-" + state}>
                <span className="rd-incident__mark" aria-hidden="true">{state === "open" ? "!" : state === "stale" ? "▲" : "✓"}</span>
                <div className="rd-inc__body">
                  <div className="rd-inc__top">
                    <strong>{i.message || incidentTypeLabel(i.type)}</strong>
                    <span className={"rd-sev is-" + i.severity}>{i.severity}</span>
                    <span className="rd-inc__type">{incidentTypeLabel(i.type)}</span>
                    {i.event?.causeLabel ? <span className="rd-inc__cause" title="Why Stashr thinks this happened, from the evidence at the time">{i.event.causeLabel}</span> : null}
                    {(i.event?.labels || []).filter((l) => l !== i.event?.cause).map((l) => <span key={l} className="rd-tag">{l}</span>)}
                  </div>
                  <small>
                    {i.serviceKey !== "group-budget" && onOpenService && state !== "stale"
                      ? <button type="button" className="rd-btn rd-btn--link rd-inc__svc" onClick={() => onOpenService(i.serviceKey)}>{i.serviceName}</button> : i.serviceName}
                    {(() => { const p = projectOf?.get(String(i.serviceKey || "").split(":").slice(1).join(":")); return p ? <> · project <Link className="rd-project" to={"/projects/" + p.id}>{p.name}</Link></> : null; })()}
                    {" · "}{i.groupName} · opened {timeAgo(i.openedAt)}
                    {state === "open" && " · down for " + formatDuration(i.durationMs)}
                    {state === "resolved" && " · " + (RESOLVED_BY[i.resolvedBy] || "Resolved") + " after " + formatDuration(i.durationMs)}
                    {state === "stale" && " · " + i.staleReason}
                  </small>
                  {i.event?.details ? <button type="button" className="rd-btn rd-btn--link rd-inc__toggle" aria-expanded={Boolean(expanded[i.id])} onClick={() => setExpanded((old) => ({ ...old, [i.id]: !old[i.id] }))}>{expanded[i.id] ? "Hide details ▴" : "Details: cause, timeline, load ▾"}</button> : null}
                  {expanded[i.id] && i.event ? <IncidentDetails event={i.event} /> : null}
                  {checks[i.id] && state !== "resolved" && <small className={"rd-inc__check " + (checks[i.id].ok ? "is-ok" : "is-bad")}>{checks[i.id].ok ? "✓" : "✕"} Checked {timeAgo(checks[i.id].at)}: {checks[i.id].text}</small>}
                </div>
                <div className="rd-inc__actions">
                  {state === "open" && <button type="button" className="rd-btn rd-btn--quiet" disabled={checking.length > 0 || Boolean(busy)} onClick={() => void runChecks([i])} title="Test this incident against the live service now">{checking.includes(i.id) ? "Checking…" : "🔍 Check"}</button>}
                  {plan && <button type="button" className="rd-btn rd-btn--primary" disabled={Boolean(fixing) || Boolean(busy)} onClick={() => void fix(i)}>{fixing === i.id ? "Fixing…" : plan.label}</button>}
                  {state !== "resolved" && <button type="button" className="rd-btn rd-btn--quiet" disabled={Boolean(busy)} onClick={() => void resolve([i], (state === "stale" ? "Close" : "Mark resolved") + ": " + i.serviceName + "?", state === "stale" ? "It is marked resolved and kept in the log." : "Use this once you have dealt with it. If the problem is still there, monitoring opens a fresh incident on the next check.")}>{state === "stale" ? "Close" : "✓ Resolve"}</button>}
                </div>
              </li>
            );
          })}
          {!rows.length && <Empty icon="✓" title={incidents.length ? (tab === "open" ? "Nothing is open" : "No incidents here") : "No incidents recorded"}>{incidents.length ? (tab === "open" && !query ? "Every service is healthy. Resolved incidents are under the Resolved tab." : "Change the tab, filters or search.") : "Once monitoring is on for a server group, outages show up here."}</Empty>}
        </ul>
      )}
      {rows.length > limit && <div className="rd-toolrow rd-toolrow--end"><button type="button" className="rd-btn rd-btn--quiet" onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, rows.length - limit)} more ({rows.length - limit} left)</button></div>}
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
          <label className="rd-check rd-check--box" title="When a server answers but has no /health route, Stashr adds one to its GitHub repository (a pull request that is merged, so Render redeploys) instead of raising an incident. Needs a GitHub token with the repo scope."><input type="checkbox" checked={monitor.autoHealthRoute !== false} onChange={(e) => setMonitor((o) => ({ ...o, autoHealthRoute: e.target.checked }))} /> Add a missing /health route automatically</label>
          <label className="rd-check rd-check--box" title="Watches every running service in every connected account, grouped by app. Your own groups are still used for the services in them."><input type="checkbox" checked={monitor.autoAll !== false} onChange={(e) => setMonitor((o) => ({ ...o, autoAll: e.target.checked }))} /> Watch every running service automatically</label>
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
