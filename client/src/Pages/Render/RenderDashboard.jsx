import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import {
  connectRenderAccount, deleteRenderAccount, getRenderAccounts, getRenderDeploys,
  getRenderEnvVars, getRenderLogs, getRenderServices, restartRenderService,
  triggerRenderDeploy, updateRenderEnvVar, deleteRenderEnvVar,
  checkRenderHealth, suspendRenderService, resumeRenderService, rollbackRenderDeploy,
  cancelRenderDeploy, createRenderSnapshot, getRenderSnapshots, restoreRenderSnapshot,
  getRenderAudit, getRenderMetrics, getRenderEnvGroups, getRenderDbExports, createRenderDbExport
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
const normalizeList = (payload, key) => {
  const plural = key === "envVar" ? "envVars" : key + "s";
  const rows = Array.isArray(payload) ? payload
    : Array.isArray(payload?.[plural]) ? payload[plural]
    : Array.isArray(payload?.[key]) ? payload[key]
    : Array.isArray(payload?.data) ? payload.data : [];
  return rows.map((x) => x?.[key] || x).filter(Boolean);
};
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
const dashboardUrl = (s) => s.dashboardUrl || "https://dashboard.render.com";
const normalizeMetricPoints = (payload) => {
  const series = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  return series.flatMap((item) => Array.isArray(item?.values) ? item.values : [])
    .filter((point) => Number.isFinite(Number(point?.value)))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .slice(-36);
};
const sumMetricPoints = (payload) => {
  const totals = new Map();
  normalizeMetricPoints(payload).forEach((point) => {
    const timestamp = new Date(point.timestamp).toISOString();
    const value = Number(point.value);
    if (!Number.isFinite(value)) return;
    const current = totals.get(timestamp);
    totals.set(timestamp, { timestamp, value: (current?.value || 0) + value, unit: point.unit || current?.unit || "" });
  });
  return [...totals.values()].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)).slice(-36);
};

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
  const [healthResult, setHealthResult] = useState(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [snapshots, setSnapshots] = useState([]);
  const [envGroups, setEnvGroups] = useState([]);
  const [envGroupsBusy, setEnvGroupsBusy] = useState(false);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [auditEvents, setAuditEvents] = useState([]);
  const [diagnosis, setDiagnosis] = useState("");
  const [metricType, setMetricType] = useState("cpu");
  const [metricsPayload, setMetricsPayload] = useState(null);
  const [metricsBusy, setMetricsBusy] = useState(false);
  const [dbExports, setDbExports] = useState([]);
  const [dbBusy, setDbBusy] = useState(false);
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [hideSuspended, setHideSuspended] = useState(false);
  const [checkedServices, setCheckedServices] = useState([]);
  const [serviceGroups, setServiceGroups] = useState(() => {
    try { return JSON.parse(localStorage.getItem("stashr_render_service_groups") || "[]"); } catch { return []; }
  });
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [groupMetricType, setGroupMetricType] = useState("cpu");
  const [groupMetrics, setGroupMetrics] = useState(null);
  const [groupHistory, setGroupHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem("stashr_render_group_history") || "[]"); } catch { return []; }
  });
  const [groupMetricBusy, setGroupMetricBusy] = useState(false);
  const [groupMonitoring, setGroupMonitoring] = useState(false);
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem("stashr_render_favorites") || "[]"); } catch { return []; }
  });
  const searchRef = useRef(null);

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

  const loadAudit = useCallback(async () => {
    try {
      const result = await getRenderAudit(50);
      setAuditEvents(Array.isArray(result.events) ? result.events : []);
    } catch { /* Audit history is supplemental; the dashboard remains usable. */ }
  }, []);

  useEffect(() => {
    void loadAccounts();
    void loadAudit();
  }, [loadAccounts, loadAudit]);

  useEffect(() => {
    const handler = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    try { localStorage.setItem("stashr_render_favorites", JSON.stringify(favorites)); } catch { /* optional preference */ }
  }, [favorites]);

  useEffect(() => {
    try { localStorage.setItem("stashr_render_service_groups", JSON.stringify(serviceGroups)); } catch { /* browser storage is optional */ }
  }, [serviceGroups]);

  const filtered = useMemo(() => services.filter((s) => {
    const haystack = [s.name, s.type, s.serviceDetails?.region, s.accountName, s.branch].join(" ").toLowerCase();
    return haystack.includes(query.toLowerCase())
      && (!favoriteOnly || favorites.includes(s.accountId + ":" + s.id))
      && (accountFilter === "all" || s.accountId === accountFilter)
      && (typeFilter === "all" || serviceKind(s) === typeFilter)
      && (!hideSuspended || s.suspended !== "suspended");
  }), [services, query, accountFilter, typeFilter, favoriteOnly, favorites, hideSuspended]);

  const selectedGroup = serviceGroups.find((group) => group.id === selectedGroupId) || null;
  const groupServices = selectedGroup
    ? selectedGroup.serviceKeys.map((key) => services.find((service) => service.accountId + ":" + service.id === key)).filter(Boolean)
    : [];

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
    setSelected(service); setTab("overview"); setLogs([]); setDeploys([]); setEnvVars([]); setSnapshots([]); setHealthResult(null); setMetricsPayload(null); setDiagnosis("");
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
    if (next === "env") { void loadEnv(selected); void loadEnvGroups(selectedAccount); }
    if (next === "database") void loadDatabaseExports(selected);
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

  const loadMetrics = async (service = selected, metric = metricType) => {
    if (!service) return;
    setMetricsBusy(true);
    try {
      const startTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const result = await getRenderMetrics(service.accountId, service.id, metric, startTime);
      setMetricsPayload(result);
      setError("");
    } catch (e) {
      setMetricsPayload(null);
      setError(e?.response?.data?.error || "Metrics are not available for this service or plan.");
    } finally { setMetricsBusy(false); }
  };

  const loadGroupMetrics = useCallback(async (groupId = selectedGroupId, metric = groupMetricType, quiet = false) => {
    const group = serviceGroups.find((item) => item.id === groupId);
    if (!group) return;
    const members = group.serviceKeys.map((key) => services.find((service) => service.accountId + ":" + service.id === key)).filter(Boolean);
    if (!members.length) {
      setGroupMetrics({ services: [], combinedPoints: [], checkedAt: new Date().toISOString() });
      return;
    }
    if (!quiet) setGroupMetricBusy(true);
    const startTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    try {
      const results = await Promise.all(members.map(async (service) => {
        try {
          const payload = await getRenderMetrics(service.accountId, service.id, metric, startTime);
          const points = sumMetricPoints(payload);
          const peak = points.reduce((best, point) => !best || point.value > best.value ? point : best, null);
          return { key: service.accountId + ":" + service.id, name: service.name, accountName: service.accountName,
            points, current: points.length ? points[points.length - 1].value : null,
            peak: peak?.value ?? null, peakAt: peak?.timestamp || null, unit: points[points.length - 1]?.unit || "",
            error: points.length ? "" : "No metric points returned" };
        } catch (e) {
          return { key: service.accountId + ":" + service.id, name: service.name, accountName: service.accountName, points: [], current: null, peak: null, peakAt: null, unit: "", error: e?.response?.data?.error || "Metrics unavailable" };
        }
      }));
      const combined = new Map();
      results.forEach((service) => service.points.forEach((point) => {
        const existing = combined.get(point.timestamp);
        combined.set(point.timestamp, { timestamp: point.timestamp, value: (existing?.value || 0) + point.value, unit: point.unit || existing?.unit || "" });
      }));
      const combinedPoints = [...combined.values()].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)).slice(-36);
      const snapshot = { groupId, metric, services: results, combinedPoints, checkedAt: new Date().toISOString() };
      setGroupMetrics(snapshot);
      try {
        const historyKey = "stashr_render_group_history";
        const history = JSON.parse(localStorage.getItem(historyKey) || "[]");
        const latest = combinedPoints[combinedPoints.length - 1];
        if (latest) {
          history.push({ groupId, metric, timestamp: snapshot.checkedAt, value: latest.value, unit: latest.unit || "" });
          const retainedHistory = history.filter((entry) => Date.now() - new Date(entry.timestamp).getTime() < 7 * 24 * 60 * 60 * 1000).slice(-2016);
          localStorage.setItem(historyKey, JSON.stringify(retainedHistory));
          setGroupHistory(retainedHistory);
        }
      } catch { /* optional local monitoring history */ }
    } finally { if (!quiet) setGroupMetricBusy(false); }
  }, [serviceGroups, services, selectedGroupId, groupMetricType]);

  useEffect(() => {
    if (!groupMonitoring || !selectedGroupId) return undefined;
    void loadGroupMetrics(selectedGroupId, groupMetricType, true);
    const timer = window.setInterval(() => { void loadGroupMetrics(selectedGroupId, groupMetricType, true); }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [groupMonitoring, selectedGroupId, groupMetricType, loadGroupMetrics]);

  const saveServiceGroup = () => {
    const keys = [...new Set(checkedServices)].filter((key) => services.some((service) => service.accountId + ":" + service.id === key));
    if (keys.length < 2) { toast.info("Select at least two services to create a group."); return; }
    const name = window.prompt("Name this server group (for example, Deal Radar):");
    if (!name || !name.trim()) return;
    const group = { id: "group-" + Date.now().toString(36), name: name.trim().slice(0, 60), serviceKeys: keys };
    setServiceGroups((old) => [...old, group]);
    setSelectedGroupId(group.id);
    setCheckedServices([]);
    setGroupMetrics(null);
    setGroupMonitoring(false);
    toast.success("Server group saved in this browser.");
  };

  const deleteServiceGroup = () => {
    if (!selectedGroup) return;
    if (!window.confirm("Delete the local group '" + selectedGroup.name + "'? This will not affect any Render services.")) return;
    setServiceGroups((old) => old.filter((group) => group.id !== selectedGroup.id));
    setSelectedGroupId("");
    setGroupMetrics(null);
    setGroupMonitoring(false);
  };

  const toggleServiceSelection = (service) => {
    const key = service.accountId + ":" + service.id;
    setCheckedServices((old) => old.includes(key) ? old.filter((item) => item !== key) : [...old, key]);
  };

  const runHealthCheck = async (service = selected, quiet = false) => {
    if (!service) return;
    if (!quiet) setHealthBusy(true);
    try {
      const result = await checkRenderHealth(service.accountId, service.id);
      setHealthResult((previous) => {
        if (alertsEnabled && previous && previous.state !== result.state && typeof window !== "undefined" && "Notification" in window && window.Notification.permission === "granted") {
          new window.Notification("Render health changed: " + service.name, { body: previous.state + " → " + result.state });
        }
        return result;
      });
      if (!quiet) toast.info("Health check: " + result.state);
      void loadAudit();
    } catch (e) {
      const result = { state: "unknown", checkedAt: new Date().toISOString(), message: e?.response?.data?.error || "Health check failed." };
      setHealthResult(result);
      if (!quiet) setError(result.message);
    } finally { if (!quiet) setHealthBusy(false); }
  };

  useEffect(() => {
    if (!selected || tab !== "overview") return undefined;
    void runHealthCheck(selected, true);
    const timer = window.setInterval(() => { void runHealthCheck(selected, true); }, 60000);
    return () => window.clearInterval(timer);
  }, [selected?.id, selected?.accountId, tab, alertsEnabled]);

  const enableAlerts = async () => {
    if (!("Notification" in window)) { toast.error("Browser notifications are not supported here."); return; }
    const permission = window.Notification.permission === "granted" ? "granted" : await window.Notification.requestPermission();
    if (permission !== "granted") { toast.info("Allow browser notifications to receive health-change alerts."); return; }
    setAlertsEnabled(true);
    toast.success("Health-change alerts enabled while this dashboard is open.");
  };

  const toggleFavorite = (service) => {
    const id = service.accountId + ":" + service.id;
    setFavorites((old) => old.includes(id) ? old.filter((x) => x !== id) : [...old, id]);
  };

  const loadDatabaseExports = async (service = selected) => {
    if (!service || serviceKind(service) !== "PostgreSQL") return;
    setDbBusy(true);
    try {
      const result = await getRenderDbExports(service.accountId, service.id);
      setDbExports(Array.isArray(result.exports) ? result.exports : []);
    } catch (e) { setError(e?.response?.data?.error || "Could not load database exports."); }
    finally { setDbBusy(false); }
  };

  const createDatabaseExport = async () => {
    if (!selected || serviceKind(selected) !== "PostgreSQL") return;
    if (!window.confirm("Start a PostgreSQL export for " + selected.name + "? The export may contain sensitive production data. Protect any downloaded file.")) return;
    setDbBusy(true);
    try {
      await createRenderDbExport(selected.accountId, selected.id);
      await loadDatabaseExports(selected);
      await loadAudit();
      toast.success("Database export requested. Refresh the list shortly for its download link.");
    } catch (e) { setError(e?.response?.data?.error || "Could not start database export."); }
    finally { setDbBusy(false); }
  };

  const loadEnvGroups = async (account = selectedAccount) => {
    if (!account) return;
    setEnvGroupsBusy(true);
    try {
      const result = await getRenderEnvGroups(account.id);
      const rows = Array.isArray(result) ? result : Array.isArray(result?.envGroups) ? result.envGroups : [];
      setEnvGroups(rows.map((item) => item?.envGroup || item).filter((item) => item && item.id));
    } catch (e) {
      setEnvGroups([]);
      setError(e?.response?.data?.error || "Could not load environment groups.");
    } finally { setEnvGroupsBusy(false); }
  };

  const loadSnapshots = async (service = selected) => {
    if (!service) return;
    setSnapshotBusy(true);
    try {
      const result = await getRenderSnapshots(service.accountId, service.id);
      setSnapshots(Array.isArray(result.snapshots) ? result.snapshots : []);
    } catch (e) { setError(e?.response?.data?.error || "Could not load environment snapshots."); }
    finally { setSnapshotBusy(false); }
  };

  const createSnapshot = async () => {
    if (!selected || !window.confirm("Create an encrypted snapshot of all current environment variables for " + selected.name + "?")) return;
    setSnapshotBusy(true);
    try {
      await createRenderSnapshot(selected.accountId, selected.id);
      await loadSnapshots(selected);
      await loadAudit();
      toast.success("Encrypted environment snapshot created.");
    } catch (e) { setError(e?.response?.data?.error || "Could not create a snapshot."); }
    finally { setSnapshotBusy(false); }
  };

  const restoreSnapshot = async (snapshot) => {
    if (!selected || !window.confirm("Restore " + snapshot.count + " environment variables from this snapshot? Variables absent from the snapshot will be deleted. This cannot be automatically undone. A deploy may be required.")) return;
    setSnapshotBusy(true);
    try {
      const result = await restoreRenderSnapshot(selected.accountId, selected.id, snapshot.id);
      await loadEnv(selected);
      await loadSnapshots(selected);
      await loadAudit();
      toast.success(result.message || "Snapshot restored.");
    } catch (e) { setError(e?.response?.data?.error || "Could not restore this snapshot."); }
    finally { setSnapshotBusy(false); }
  };

  const diagnoseLogs = () => {
    const text = logs.map((l) => String(l.message || "")).join("\n").toLowerCase();
    const findings = [];
    if (/econnrefused|connection refused|connect econn/.test(text)) findings.push("Connection refused: verify the target service is running, the hostname/port is correct, and private services share the expected network.");
    if (/econnreset|socket hang up|timeout|timed out/.test(text)) findings.push("Connection instability or timeout: check downstream latency, request timeouts, and whether the service is waking from a spin-down.");
    if (/out of memory|heap out of memory|oomkilled|memory limit/.test(text)) findings.push("Possible memory pressure: inspect memory usage, recent traffic and large in-memory operations.");
    if (/permission denied|unauthorized|forbidden|invalid token|401|403/.test(text)) findings.push("Authentication/permission failure: verify credential scope, token expiry and service-level access without pasting secrets into logs.");
    if (/missing environment|undefined|not configured|no such file|module not found/.test(text)) findings.push("Configuration or startup failure: compare required environment variables, root directory, build command and installed dependencies.");
    if (/syntaxerror|typeerror|referenceerror|uncaught exception|traceback|fatal/.test(text)) findings.push("Application exception detected: inspect the first stack trace and correlate it with the latest commit/deployment.");
    if (/429|rate limit|too many requests/.test(text)) findings.push("Rate limiting detected: review client retries, upstream quotas and request burst patterns.");
    if (/5\d\d|internal server error/.test(text)) findings.push("Server-side errors found: correlate request logs with app logs and compare against the last healthy deployment.");
    if (!findings.length) findings.push(logs.length ? "No common failure signature matched. Review the newest entries, deployment build logs and service health result." : "Load application or build logs first, then run diagnostics.");
    setDiagnosis(findings.join("\n\n"));
  };

  const toggleServiceState = async () => {
    if (!selected) return;
    const suspendedNow = selected.suspended === "suspended";
    const action = suspendedNow ? "resume" : "suspend";
    if (!window.confirm((suspendedNow ? "Resume " : "Suspend ") + selected.name + "? " + (suspendedNow ? "This may trigger a deployment or startup." : "This will make the service unavailable."))) return;
    setActionBusy(true);
    try {
      if (suspendedNow) await resumeRenderService(selected.accountId, selected.id);
      else await suspendRenderService(selected.accountId, selected.id);
      toast.success((suspendedNow ? "Resume" : "Suspend") + " requested.");
      setSelected((old) => old ? { ...old, suspended: suspendedNow ? "not_suspended" : "suspended" } : old);
      await refreshServices();
      await loadAudit();
    } catch (e) { setError(e?.response?.data?.error || "Could not change service state."); }
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
              <label className="rd-search"><span>⌕</span><input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search services, regions, branches… (Ctrl/⌘ K)" /><button onClick={() => setQuery("")} aria-label="Clear search">×</button></label>
              <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} aria-label="Filter by account"><option value="all">All accounts</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
              <button className={"rd-btn rd-btn--quiet" + (favoriteOnly ? " is-active" : "")} onClick={() => setFavoriteOnly((v) => !v)}>{favoriteOnly ? "★ Favorites" : "☆ Favorites"}</button><select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filter by service type"><option value="all">All types</option>{["Web service", "Static site", "Private service", "Cron job", "Background worker", "PostgreSQL"].map((t) => <option key={t}>{t}</option>)}</select>
              <label className="rd-hide-suspended"><input type="checkbox" checked={hideSuspended} onChange={(e) => setHideSuspended(e.target.checked)} /> Hide suspended</label>
              <button className="rd-btn rd-btn--quiet" disabled={checkedServices.length < 2} onClick={saveServiceGroup}>＋ Group selected ({checkedServices.length})</button>
            </div>
            <div className="rd-table-wrap"><table className="rd-table"><thead><tr><th>Select</th><th>Service</th><th>Account</th><th>Type</th><th>Region</th><th>Status</th><th /></tr></thead><tbody>
              {filtered.map((s) => <tr key={s.accountId + s.id} onClick={() => openService(s)}><td><input className="rd-service-check" type="checkbox" checked={checkedServices.includes(s.accountId + ":" + s.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggleServiceSelection(s)} aria-label={"Select " + s.name + " for a group"} /></td><td><div className="rd-service-cell"><span className="rd-service-icon">{serviceKind(s) === "PostgreSQL" ? "▤" : "▣"}</span><div><strong>{s.name}</strong><small>{s.id.slice(0, 15)}{s.branch ? " · " + s.branch : ""}</small></div></div></td><td><span className="rd-account-chip">{initials(s.accountName)} {s.accountName}</span></td><td>{serviceKind(s)}</td><td>{s.serviceDetails?.region || "—"}</td><td><span className={"rd-status " + (s.suspended === "suspended" ? "is-suspended" : "is-live")}><i />{s.suspended === "suspended" ? "Suspended" : "Not suspended"}</span></td><td><button className="rd-open" onClick={(e) => { e.stopPropagation(); toggleFavorite(s); }} aria-label={"Favorite " + s.name} title="Toggle favorite">{favorites.includes(s.accountId + ":" + s.id) ? "★" : "☆"}</button><button className="rd-open" onClick={(e) => { e.stopPropagation(); openService(s); }} aria-label={"Open " + s.name}>↗</button></td></tr>)}
              {!filtered.length && <tr><td colSpan="7"><div className="rd-empty"><span>▣</span><h3>{loading ? "Loading your services…" : services.length ? "No matching services" : "Your control center is ready"}</h3><p>{loading ? "Fetching your connected Render accounts." : services.length ? "Try changing your search or filters." : "Connect a Render API key to get started. The key is stored encrypted in your Stashr account."}</p>{!loading && !services.length && <button className="rd-btn rd-btn--primary" onClick={() => setModal(true)}>＋ Connect your first account</button>}</div></td></tr>}
            </tbody></table></div>
            <div className="rd-table-foot">Showing <b>{filtered.length}</b> of <b>{services.length}</b> services <span>•</span> {lastSync ? "Synced " + timeAgo(lastSync.toISOString()) : "Not synced yet"}</div>
            <section className="rd-group-panel">
              <div className="rd-group-heading"><div><h3>Multi-server monitoring</h3><p>Group services that work together—such as Deal Radar's fetcher, validator and user server.</p></div>
                <select value={selectedGroupId} onChange={(e) => { setSelectedGroupId(e.target.value); setGroupMetrics(null); setGroupMonitoring(false); }} aria-label="Select a server group"><option value="">Choose a saved group</option>{serviceGroups.map((group) => <option key={group.id} value={group.id}>{group.name} ({group.serviceKeys.length})</option>)}</select>
              </div>
              {selectedGroup ? <>
                <div className="rd-group-actions"><span>{groupServices.length} of {selectedGroup.serviceKeys.length} services currently available</span><button className="rd-btn rd-btn--quiet" onClick={() => { setGroupMonitoring((active) => !active); if (!groupMonitoring) void loadGroupMetrics(selectedGroup.id, groupMetricType); }}>{groupMonitoring ? "■ Stop monitoring" : "▶ Start monitoring"}</button><button className="rd-btn rd-btn--quiet" onClick={() => void loadGroupMetrics(selectedGroup.id, groupMetricType)}>↻ Sample now</button><button className="rd-btn rd-btn--quiet" onClick={deleteServiceGroup}>Delete group</button></div>
                <div className="rd-group-actions"><label>Metric <select value={groupMetricType} onChange={(e) => { setGroupMetricType(e.target.value); setGroupMetrics(null); }}>{[["cpu","CPU usage"],["memory","Memory usage"],["http-requests","HTTP requests"],["http-latency","HTTP latency"],["bandwidth","Bandwidth"],["instance-count","Instance count"]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><small>{groupMonitoring ? "Auto-sampling every 5 minutes while this page is open." : "Samples are fetched on demand; auto-monitoring only runs while this dashboard stays open."}</small></div>
                {groupMetricBusy && <div className="rd-loading">Sampling group metrics…</div>}
                {groupMetrics && <>
                  <div className="rd-group-kpis"><article><small>Latest combined value</small><strong>{groupMetrics.combinedPoints.length ? groupMetrics.combinedPoints[groupMetrics.combinedPoints.length - 1].value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"} <em>{groupMetrics.combinedPoints[groupMetrics.combinedPoints.length - 1]?.unit || ""}</em></strong></article><article><small>Peak in returned hour</small><strong>{groupMetrics.combinedPoints.length ? Math.max(...groupMetrics.combinedPoints.map((point) => point.value)).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</strong></article><article><small>Peak time (1h)</small><strong>{groupMetrics.combinedPoints.length ? new Date(groupMetrics.combinedPoints.reduce((best, point) => point.value > best.value ? point : best, groupMetrics.combinedPoints[0]).timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</strong></article><article><small>Saved peak (7d)</small><strong>{(() => { const entries = groupHistory.filter((entry) => entry.groupId === selectedGroup.id && entry.metric === groupMetricType); const peak = entries.reduce((best, entry) => !best || entry.value > best.value ? entry : best, null); return peak ? peak.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"; })()}</strong><small>{(() => { const entries = groupHistory.filter((entry) => entry.groupId === selectedGroup.id && entry.metric === groupMetricType); const peak = entries.reduce((best, entry) => !best || entry.value > best.value ? entry : best, null); return peak ? new Date(peak.timestamp).toLocaleString() : "Builds up while monitoring is on"; })()}</small></article></div>
                  {groupMetrics.combinedPoints.length ? <><div className="rd-metric-bars rd-group-bars" role="img" aria-label={"Combined " + groupMetricType + " across group services over the last hour"}>{groupMetrics.combinedPoints.map((point,index) => { const max = Math.max(1,...groupMetrics.combinedPoints.map((entry) => entry.value)); return <span key={point.timestamp + index} title={new Date(point.timestamp).toLocaleString() + ": " + point.value.toFixed(2) + " " + (point.unit || "")} style={{height:Math.max(4,point.value/max*82)+"px"}} />; })}</div><div className="rd-metric-axis"><span>{new Date(groupMetrics.combinedPoints[0].timestamp).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</span><span>{new Date(groupMetrics.combinedPoints[groupMetrics.combinedPoints.length-1].timestamp).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</span></div></> : <p className="rd-metric-empty">No combined metric points returned. Render may not expose this metric for every service or plan.</p>}
                  <div className="rd-table-wrap"><table className="rd-table rd-group-table"><thead><tr><th>Service</th><th>Account</th><th>Current</th><th>Peak (1h)</th><th>Peak time</th><th>Result</th></tr></thead><tbody>{groupMetrics.services.map((item) => <tr key={item.key}><td>{item.name}</td><td>{item.accountName}</td><td>{item.current == null ? "—" : item.current.toLocaleString(undefined,{maximumFractionDigits:2}) + " " + item.unit}</td><td>{item.peak == null ? "—" : item.peak.toLocaleString(undefined,{maximumFractionDigits:2}) + " " + item.unit}</td><td>{item.peakAt ? new Date(item.peakAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : "—"}</td><td>{item.error || "Available"}</td></tr>)}</tbody></table></div>
                  <p className="rd-group-note">Combined values sum the metric points returned for each selected service; they are a comparison signal, not a single machine's CPU or memory percentage. Render's returned metric window is about one hour. Samples are also kept in this browser for up to 7 days while monitoring is used.</p>
                  <small className="rd-group-synced">Last sampled {new Date(groupMetrics.checkedAt).toLocaleTimeString()}</small>
                </>}
              </> : <div className="rd-group-empty">{serviceGroups.length ? "Choose a group to view combined load and per-service peaks." : "Select at least two services in the table and choose “Group selected” to create your first server group."}</div>}
            </section>
          </div>

          <aside className="rd-side">
            <section className="rd-panel rd-connections">
              <div className="rd-panel-head"><div><h2>Connections</h2><p>Render accounts saved in Stashr</p></div><button className="rd-icon-btn" onClick={() => setModal(true)} aria-label="Add Render account">＋</button></div>
              {accounts.length ? accounts.map((a) => <div className="rd-connection" key={a.id}><span className="rd-avatar">{initials(a.name)}</span><div className="rd-connection-info"><strong>{a.name}</strong><small>{a.services.length} services{a.loadError ? " · error loading" : ""}</small></div><button className="rd-remove" onClick={() => void removeAccount(a)} aria-label={"Remove " + a.name} title="Disconnect">×</button></div>) : <div className="rd-connection-empty"><span>☁</span><strong>No connections yet</strong><p>Add a Render API key to see services here.</p></div>}
              <div className="rd-security-note"><span>♢</span><div><strong>Encrypted credential storage</strong><p>Keys are encrypted in your Stashr database and never returned to the browser after connection.</p></div></div>
            </section>
            <section className="rd-panel rd-quick"><h2>Operations timeline</h2><p>Recent actions across your Render connections.</p><div className="rd-audit-list">{auditEvents.slice(0, 6).map((event) => <article key={event.id}><strong>{String(event.action || "operation").replaceAll("_", " ")}</strong><small>{event.serviceId ? event.serviceId.slice(0, 12) + " · " : ""}{event.at ? timeAgo(event.at) : "recently"}</small></article>)}{!auditEvents.length && <small>No audited operations yet.</small>}</div><button className="rd-btn rd-btn--quiet" onClick={() => void loadAudit()}>Refresh timeline</button></section>
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
        <div className="rd-detail-actions"><a className="rd-btn rd-btn--quiet" href={dashboardUrl(selected)} target="_blank" rel="noreferrer">Open Render ↗</a><button className="rd-btn rd-btn--quiet" disabled={actionBusy} onClick={() => void toggleServiceState()}>{selected.suspended === "suspended" ? "▶ Resume" : "Ⅱ Suspend"}</button><button className="rd-btn rd-btn--quiet" disabled={actionBusy || serviceKind(selected) === "Cron job"} onClick={() => void restart()}>↻ Restart</button><button className="rd-btn rd-btn--primary" disabled={actionBusy} onClick={() => void deploy(false)}>Deploy latest</button><button className="rd-btn rd-btn--quiet" disabled={actionBusy} onClick={() => void deploy(true)}>Deploy + clear cache</button></div>
        <nav className="rd-tabs"><button className={tab === "overview" ? "is-active" : ""} onClick={() => changeTab("overview")}>Overview</button><button className={tab === "logs" ? "is-active" : ""} onClick={() => changeTab("logs")}>Logs</button><button className={tab === "env" ? "is-active" : ""} onClick={() => changeTab("env")}>Environment</button><button className={tab === "deploys" ? "is-active" : ""} onClick={() => changeTab("deploys")}>Deployments</button>{serviceKind(selected) === "PostgreSQL" && <button className={tab === "database" ? "is-active" : ""} onClick={() => changeTab("database")}>Database</button>}</nav>
        {error && <div className="rd-alert rd-alert--error"><span>!</span><div>{error}</div><button onClick={() => setError("")}>×</button></div>}
        {tab === "overview" && <><section className="rd-metrics-card"><div className="rd-section-head"><div><h3>Resource & request metrics</h3><p>Recent one-hour data from Render; availability depends on service type and plan.</p></div><div className="rd-inline-tools"><select value={metricType} onChange={(e) => { setMetricType(e.target.value); void loadMetrics(selected, e.target.value); }} aria-label="Select metric"><option value="cpu">CPU usage</option><option value="memory">Memory usage</option><option value="http-latency">HTTP latency</option><option value="http-requests">HTTP requests</option><option value="bandwidth">Bandwidth</option><option value="instance-count">Instance count</option></select><button className="rd-icon-btn" disabled={metricsBusy} onClick={() => void loadMetrics(selected)}>↻</button></div></div>{!metricsPayload && !metricsBusy && <p className="rd-metric-empty">Select a metric to load the latest hour of data.</p>}{metricsBusy && <div className="rd-loading">Loading metrics…</div>}{metricsPayload && (() => { const points = normalizeMetricPoints(metricsPayload); const max = Math.max(1, ...points.map((p) => Number(p.value))); return points.length ? <><div className="rd-metric-summary"><strong>{Number(points[points.length - 1].value).toLocaleString(undefined, { maximumFractionDigits: 2 })} <small>{points[points.length - 1].unit || ""}</small></strong><span>{points.length} data points · peak {max.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div><div className="rd-metric-bars" role="img" aria-label={metricType + " values over the last hour"}>{points.map((point, index) => <span key={point.timestamp + "-" + index} title={new Date(point.timestamp).toLocaleTimeString() + ": " + point.value + " " + (point.unit || "")} style={{ height: Math.max(4, Number(point.value) / max * 76) + "px" }} />)}</div><div className="rd-metric-axis"><span>{new Date(points[0].timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><span>{new Date(points[points.length - 1].timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div></> : <p className="rd-metric-empty">Render returned no metric points for this period.</p>; })()}</section><div className="rd-health-card"><div><strong>Live endpoint health</strong><p>{healthResult?.message || "Run a check against the service URL supplied by Render."}</p><small>{healthResult?.checkedAt ? "Checked " + new Date(healthResult.checkedAt).toLocaleTimeString() + (healthResult.latencyMs != null ? " · " + healthResult.latencyMs + " ms" : "") : "Not checked yet"}</small></div><span className={"rd-health-state " + (healthResult?.state || "unknown")}>{healthBusy ? "Checking…" : (healthResult?.state || "Unknown")}</span><button className="rd-btn rd-btn--quiet" disabled={healthBusy} onClick={() => void runHealthCheck(selected)}>Run check</button><button className="rd-btn rd-btn--quiet" onClick={() => void enableAlerts()}>{alertsEnabled ? "Alerts enabled" : "Enable alerts"}</button></div><div className="rd-detail-grid">{[["Service ID", selected.id], ["Region", selected.serviceDetails?.region || "Not provided"], ["Type", selected.type || "Unknown"], ["Last updated", timeAgo(selected.updatedAt)], ["Plan", selected.serviceDetails?.plan || selected.serviceDetails?.buildPlan || "—"], ["State", selected.suspended === "suspended" ? "Suspended" : "Not marked suspended"], ["Repository", selected.repo || "—"], ["Branch", selected.branch || "—"]].map(([label, value]) => <div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div><p className="rd-detail-tip">“Not suspended” is not a live health guarantee. Health checks probe the Render-provided HTTPS URL. Browser alerts run only while this dashboard is open.</p><div className="rd-related"><strong>Related services</strong><div>{services.filter((s) => s.accountId === selected.accountId && s.id !== selected.id && ((s.repo && s.repo === selected.repo) || (s.branch && s.branch === selected.branch))).slice(0, 6).map((s) => <button key={s.id} onClick={() => openService(s)}>{s.name} <span>{serviceKind(s)}</span></button>)}{!services.some((s) => s.accountId === selected.accountId && s.id !== selected.id && ((s.repo && s.repo === selected.repo) || (s.branch && s.branch === selected.branch))) && <small>No related services detected from repository/branch metadata.</small>}</div></div></>}
        {tab === "logs" && <section className="rd-detail-section"><div className="rd-section-head"><div><h3>Recent logs</h3><p>Last hour · automatic refresh every 15 seconds</p></div><div className="rd-inline-tools"><select value={logType} onChange={(e) => { setLogType(e.target.value); void loadLogs(selected, e.target.value); }}><option value="app">Application</option><option value="request">Request</option><option value="build">Build</option></select><button className="rd-icon-btn" onClick={() => void loadLogs(selected, logType)}>↻</button></div></div><button className="rd-btn rd-btn--quiet rd-diagnose-btn" onClick={diagnoseLogs}>✦ Diagnose logs</button>{diagnosis && <pre className="rd-diagnosis">{diagnosis}</pre>}<input className="rd-filter-input" placeholder="Filter log messages…" value={logSearch} onChange={(e) => setLogSearch(e.target.value)} />{detailBusy ? <div className="rd-loading">Loading logs…</div> : <div className="rd-logs">{logs.filter((l) => String(l.message || "").toLowerCase().includes(logSearch.toLowerCase())).map((l, i) => <div className="rd-log" key={l.id || i}><time>{l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : "—"}</time><code>{l.message || "(empty log entry)"}</code></div>)}{!logs.length && <div className="rd-empty">No logs returned for this period.</div>}</div>}</section>}
        {tab === "env" && <section className="rd-detail-section"><div className="rd-section-head"><div><h3>Environment variables</h3><p>Direct service variables only.</p></div><div className="rd-env-groups"><div><strong>Linked environment groups</strong><small>Read-only · group variables are managed in Render</small></div>{envGroupsBusy ? <span>Loading groups…</span> : envGroups.filter((group) => (group.serviceLinks || []).some((link) => link.id === selected.id)).map((group) => <article key={group.id}><b>{group.name}</b><small>{(group.serviceLinks || []).length} linked services</small><a href="https://dashboard.render.com" target="_blank" rel="noreferrer">Manage in Render ↗</a></article>)}{!envGroupsBusy && !envGroups.some((group) => (group.serviceLinks || []).some((link) => link.id === selected.id)) && <small>No linked environment groups were returned.</small>}</div><div className="rd-inline-tools"><button className="rd-btn rd-btn--quiet" onClick={() => setShowEnvValues((v) => !v)}>{showEnvValues ? "Mask values" : "Reveal values"}</button><button className="rd-icon-btn" onClick={() => void loadEnv(selected)}>↻</button></div></div><div className="rd-env-toolbar"><input className="rd-filter-input" placeholder="Filter variable names…" value={envSearch} onChange={(e) => setEnvSearch(e.target.value)} /><button className="rd-btn rd-btn--quiet" disabled={snapshotBusy} onClick={() => void createSnapshot()}>▣ Snapshot</button><button className="rd-btn rd-btn--quiet" disabled={snapshotBusy} onClick={() => void loadSnapshots(selected)}>Snapshots</button><button className="rd-btn rd-btn--quiet" onClick={() => setNewEnv((v) => !v)}>＋ Add variable</button></div>{snapshots.length > 0 && <div className="rd-snapshot-list"><strong>Encrypted snapshots</strong>{snapshots.map((snapshot) => <article key={snapshot.id}><div><b>{snapshot.serviceName}</b><small>{new Date(snapshot.createdAt).toLocaleString()} · {snapshot.count} variables</small></div><button className="rd-btn rd-btn--quiet" disabled={snapshotBusy} onClick={() => void restoreSnapshot(snapshot)}>Restore</button></article>)}</div>}{snapshotBusy && <div className="rd-loading">Processing encrypted snapshot…</div>}{newEnv && <form className="rd-new-env" onSubmit={addEnv}><input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="VARIABLE_NAME" required /><input value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="Value" required /><button className="rd-btn rd-btn--primary">Add</button></form>}{envBusy ? <div className="rd-loading">Loading environment variables…</div> : <div className="rd-env-list">{envVars.filter((v) => v.key.toLowerCase().includes(envSearch.toLowerCase())).map((v) => <div className="rd-env-row" key={v.key}><strong>{v.key}{v.isNew && <small> NEW</small>}</strong><input type={showEnvValues ? "text" : "password"} value={v.value} onChange={(e) => setEnvVars((old) => old.map((x) => x.key === v.key ? { ...x, value: e.target.value } : x))} autoComplete="off" /><button className="rd-remove" onClick={() => void removeEnv(v)} disabled={actionBusy} title="Delete variable">×</button></div>)}{!envVars.length && <div className="rd-empty">No direct environment variables returned.</div>}</div>}<div className="rd-env-foot"><small>Changes are not deployed automatically.</small><button className="rd-btn rd-btn--primary" onClick={() => void saveEnv()} disabled={actionBusy || envBusy}>Save changes</button></div></section>}
        {tab === "deploys" && <section className="rd-detail-section"><div className="rd-section-head"><div><h3>Deployment history</h3><p>Recent deployments for this service</p></div><button className="rd-icon-btn" onClick={() => void loadDeployments(selected)}>↻</button></div>{detailBusy ? <div className="rd-loading">Loading deployments…</div> : <div className="rd-deploy-list">{deploys.map((d) => <article className="rd-deploy" key={d.id}><span className="rd-deploy-mark">↗</span><div><strong>{d.status || "Unknown status"}</strong><p>{d.commit?.message || d.id}</p><small>{d.commit?.id ? d.commit.id.slice(0, 8) + " · " : ""}{timeAgo(d.createdAt)}</small><div className="rd-deploy-actions">{["created", "queued", "build_in_progress", "update_in_progress", "pre_deploy_in_progress"].includes(d.status) && <button className="rd-btn rd-btn--quiet" disabled={actionBusy} onClick={async () => { if (!window.confirm("Cancel this deployment?")) return; setActionBusy(true); try { await cancelRenderDeploy(selected.accountId, selected.id, d.id); toast.success("Cancellation requested."); await loadDeployments(selected); await loadAudit(); } catch (e) { setError(e?.response?.data?.error || "Could not cancel deployment."); } finally { setActionBusy(false); } }}>Cancel</button>}{["live", "deactivated", "build_failed", "update_failed"].includes(d.status) && <button className="rd-btn rd-btn--quiet" disabled={actionBusy || d.status !== "live"} onClick={async () => { if (!window.confirm("Roll back " + selected.name + " to this deployment? Autodeploy may later redeploy the latest branch commit.")) return; setActionBusy(true); try { await rollbackRenderDeploy(selected.accountId, selected.id, d.id); toast.success("Rollback requested."); await loadDeployments(selected); await loadAudit(); } catch (e) { setError(e?.response?.data?.error || "Could not roll back deployment."); } finally { setActionBusy(false); } }}>Rollback to this</button>}</div></div><time>{d.createdAt ? new Date(d.createdAt).toLocaleString() : "—"}</time></article>)}{!deploys.length && <div className="rd-empty">No deployments returned for this service.</div>}</div>}</section>}
      </section></div>}
    </main>
  );
}
