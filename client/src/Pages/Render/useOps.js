import { useCallback, useMemo, useState } from "react";
import { toast } from "react-toastify";
import {
  getRenderOpsConfig, saveRenderOpsConfig, getRenderOpsHistory, getRenderOpsIncidents,
  runRenderOpsNow, testRenderOpsNotification, getRenderOpsReport, resolveRenderIncidents, clearRenderIncidents, getRenderOpsStatus
} from "../../api/client";
import { openIncidents, readStored, writeStored, errorMessage } from "./renderUtils";

export const DEFAULT_MONITOR = { enabled: false, intervalMinutes: 5, checkHealth: true, autoAll: true, thresholds: { cpu: 85, memory: 90, latencyMs: 1500 } };
const GROUPS_KEY = "stashr_render_service_groups";

const withFlags = (config, result) => ({ ...config, schedulerConfigured: Boolean(result.schedulerConfigured), aiDiagnosisAvailable: Boolean(result.aiDiagnosisAvailable) });

/** Server-side monitoring configuration, history and incidents for the Render control center. */
export function useOps() {
  const [config, setConfig] = useState(null);
  const [groups, setGroups] = useState(() => readStored(GROUPS_KEY, []));
  const [monitor, setMonitor] = useState(DEFAULT_MONITOR);
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [history, setHistory] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [status, setStatus] = useState(null); // when the background scheduler last ran

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [configResult, historyResult, incidentResult] = await Promise.all([getRenderOpsConfig(), getRenderOpsHistory(200), getRenderOpsIncidents(200)]);
      const next = configResult.config || {};
      const remoteGroups = Array.isArray(next.groups) ? next.groups : [];
      const localGroups = readStored(GROUPS_KEY, []);
      setConfig(withFlags(next, configResult));
      setMonitor(next.monitor || DEFAULT_MONITOR);
      setTelegramChatId(next.notifications?.telegramChatId || "");
      setHistory(Array.isArray(historyResult.history) ? historyResult.history : []);
      setIncidents(Array.isArray(incidentResult.incidents) ? incidentResult.incidents : []);
      setGroups(remoteGroups.length ? remoteGroups : localGroups);
      setLoadError("");
      getRenderOpsStatus().then(setStatus).catch(() => {});
      // One-time migration of groups that only exist in this browser.
      if (!remoteGroups.length && localGroups.length) {
        const saved = await saveRenderOpsConfig({ ...next, groups: localGroups });
        setConfig(withFlags(saved.config || next, saved));
        setGroups(saved.config?.groups || localGroups);
      }
    } catch (e) {
      setLoadError(errorMessage(e, "Could not load persistent monitoring. Check the Stashr API deployment."));
    } finally { setLoading(false); }
  }, []);

  // Lightweight: only the incident log (used by the incidents page to stay live).
  const refreshIncidents = useCallback(async () => {
    getRenderOpsStatus().then(setStatus).catch(() => {});
    try {
      const result = await getRenderOpsIncidents(200);
      setIncidents(Array.isArray(result.incidents) ? result.incidents : []);
    } catch { /* the next poll retries */ }
  }, []);

  const resolveIncidents = useCallback(async ({ ids, all, verified, reason } = {}) => {
    try {
      const result = await resolveRenderIncidents(all ? { all: true } : { ids, ...(verified ? { verified: true, reason } : {}) });
      await refreshIncidents();
      return result;
    } catch (e) { toast.error(errorMessage(e, "Could not resolve incidents.")); throw e; }
  }, [refreshIncidents]);

  const clearHistory = useCallback(async () => {
    try {
      const result = await clearRenderIncidents();
      await refreshIncidents();
      return result;
    } catch (e) { toast.error(errorMessage(e, "Could not clear incident history.")); throw e; }
  }, [refreshIncidents]);

  const persist = useCallback(async (overrides = {}, { silent = false } = {}) => {
    setSaving(true);
    try {
      const payload = {
        groups: overrides.groups ?? groups,
        monitor: overrides.monitor ?? monitor,
        notifications: overrides.notifications ?? { telegramBotToken: telegramBotToken.trim(), telegramChatId: telegramChatId.trim() }
      };
      const result = await saveRenderOpsConfig(payload);
      const next = result.config || {};
      setConfig(withFlags(next, result));
      setGroups(next.groups || payload.groups);
      setMonitor(next.monitor || payload.monitor);
      setTelegramBotToken("");
      writeStored(GROUPS_KEY, next.groups || payload.groups);
      if (!silent) toast.success("Monitoring settings saved securely.");
      return next;
    } catch (e) {
      toast.error(errorMessage(e, "Could not save monitoring settings."));
      throw e;
    } finally { setSaving(false); }
  }, [groups, monitor, telegramBotToken, telegramChatId]);

  const sampleNow = useCallback(async () => {
    setRunning(true);
    try {
      const result = await runRenderOpsNow();
      toast.success("Sample complete: " + (result.groupsChecked || 0) + " group(s), " + (result.incidentsOpened || 0) + " new incident(s).");
      await refresh();
      return result;
    } catch (e) { toast.error(errorMessage(e, "Could not sample monitoring data.")); return null; }
    finally { setRunning(false); }
  }, [refresh]);

  const testTelegram = useCallback(async () => {
    try {
      if (telegramBotToken.trim() || telegramChatId.trim()) await persist({}, { silent: true });
      await testRenderOpsNotification();
      toast.success("Telegram test message sent.");
      await refresh();
    } catch (e) { if (e?.response?.data?.error) toast.error(e.response.data.error); }
  }, [persist, refresh, telegramBotToken, telegramChatId]);

  const clearTelegram = useCallback(async () => {
    await persist({ notifications: { clearTelegramToken: true, clearTelegramChatId: true, telegramBotToken: "", telegramChatId: "" } });
    setTelegramChatId("");
  }, [persist]);

  const exportReport = useCallback(async (format = "csv") => {
    try {
      const result = await getRenderOpsReport(format);
      const blob = format === "csv" ? result : new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = "stashr-render-ops-report." + format; link.click();
      URL.revokeObjectURL(url);
      toast.success("Report exported.");
    } catch (e) { toast.error(errorMessage(e, "Could not export report.")); }
  }, []);

  const open = useMemo(() => openIncidents(incidents), [incidents]);

  return {
    config, groups, monitor, setMonitor, telegramBotToken, setTelegramBotToken, telegramChatId, setTelegramChatId,
    history, incidents, openIncidents: open, status, loading, saving, running, loadError,
    refresh, refreshIncidents, resolveIncidents, clearHistory, persist, sampleNow, testTelegram, clearTelegram, exportReport
  };
}
