import React from "react";

export const ago = (value) => {
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return "—";
  const m = Math.max(0, Math.floor((Date.now() - t) / 60000));
  return m < 1 ? "just now" : m < 60 ? m + "m ago" : m < 1440 ? Math.floor(m / 60) + "h ago" : Math.floor(m / 1440) + "d ago";
};

export const HEALTH_BADGE = { green: "badge--ok", amber: "badge--warn", red: "badge--danger", unknown: "badge--muted" };
export const HEALTH_LABEL = { green: "Healthy", amber: "Needs a look", red: "Unhealthy", unknown: "No data yet" };
export const CI_BADGE = { passing: "badge--ok", failing: "badge--danger", running: "badge--warn", other: "badge--muted" };
export const CI_LABEL = { passing: "CI passing", failing: "CI failing", running: "CI running", other: "CI finished" };
export const safe = (url) => (/^https:\/\//.test(String(url || "")) ? url : null);

/** Compact badge for project cards. */
export function HealthBadge({ status }) {
  if (!status) return null;
  const { health } = status;
  const title = health.reasons.map((r) => r.text).join("\n");
  return <span className={"badge " + (HEALTH_BADGE[health.level] || "badge--muted")} title={title}>{HEALTH_LABEL[health.level]}{health.score != null ? " · " + health.score : ""}</span>;
}
