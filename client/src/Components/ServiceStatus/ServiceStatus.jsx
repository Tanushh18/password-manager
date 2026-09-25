import React, { useCallback, useEffect, useRef, useState } from "react";
import { checkHealth } from "../../api/client";
import "./ServiceStatus.css";

/**
 * Live vault-service indicator.
 * Polls the server's /health endpoint — the same endpoint the uptime cron job
 * hits — so the dot on screen reflects the real state of the API.
 */
export default function ServiceStatus({ compact = false, interval = 60000 }) {
  const [state, setState] = useState("checking"); // checking | online | waking | offline
  const [uptime, setUptime] = useState(null);
  const [latency, setLatency] = useState(null);
  const timer = useRef(null);
  const alive = useRef(true);

  const probe = useCallback(async () => {
    const startedAt = Date.now();
    try {
      const res = await checkHealth();
      if (!alive.current) return;
      const took = Date.now() - startedAt;
      setLatency(took);
      setUptime(res?.data?.uptime ?? null);
      // A cold free-tier instance answers slowly on its very first call
      setState(res?.status === 200 ? (took > 2500 ? "waking" : "online") : "offline");
    } catch (err) {
      if (!alive.current) return;
      // A status code means the server answered — it is awake even if this
      // deployment predates /health. Only a dead connection is "offline".
      if (err?.response?.status) {
        setLatency(Date.now() - startedAt);
        setUptime(null);
        setState("online");
      } else {
        setState("offline");
        setLatency(null);
      }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    probe();
    timer.current = setInterval(probe, interval);
    return () => {
      alive.current = false;
      clearInterval(timer.current);
    };
  }, [probe, interval]);

  const label = {
    checking: "Checking vault service…",
    online: "Vault service online",
    waking: "Vault service waking up…",
    offline: "Vault service unreachable",
  }[state];

  const detail =
    state === "online" && uptime != null
      ? `${formatUptime(uptime)} awake${latency ? ` · ${latency}ms` : ""}`
      : state === "waking"
      ? "free tier is stretching…"
      : state === "offline"
      ? "we will keep trying"
      : "";

  return (
    <span
      className={`status status--${state} ${compact ? "status--compact" : ""}`}
      title={label}
      role="status"
      aria-live="polite"
    >
      <span className="status__dot dot dot--live" />
      <span className="status__label">{label}</span>
      {!compact && detail && <span className="status__detail">{detail}</span>}
    </span>
  );
}

function formatUptime(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}
