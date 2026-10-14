/* Pure: turns a project's live signals into one score. Signals that are unavailable are skipped, never guessed. */

const FAILED_DEPLOY = new Set(["build_failed", "update_failed", "pre_deploy_failed"]);

/** Number of monitoring incidents still open for one service (latest event per group/service/type wins). */
function openIncidentCount(incidents, serviceKey) {
  const latest = new Map();
  [...(Array.isArray(incidents) ? incidents : [])]
    .filter((i) => i && i.serviceKey === serviceKey)
    .sort((a, b) => Date.parse(a.at || a.openedAt || 0) - Date.parse(b.at || b.openedAt || 0))
    .forEach((i) => latest.set([i.groupId, i.serviceKey, i.type].join(":"), i));
  return [...latest.values()].filter((i) => i.state === "open").length;
}

/**
 * signals: { suspended?, deployStatus?, ciState?, ciBranch?, behindBy?, driftStatus?, branch?,
 *            openIncidents?, envSyncAgeHours?, autoSync? }   (undefined = unknown)
 */
function projectHealth(s = {}) {
  let score = 100;
  let known = 0;
  const reasons = [];
  const hit = (points, severity, text) => { score -= points; reasons.push({ severity, text }); };

  if (s.suspended !== undefined) { known += 1; if (s.suspended) hit(25, "warn", "Render service is suspended"); }
  if (s.deployStatus) {
    known += 1;
    if (FAILED_DEPLOY.has(String(s.deployStatus).toLowerCase())) hit(35, "critical", "Latest deployment failed");
  }
  if (s.ciState) {
    known += 1;
    if (s.ciState === "failing") hit(30, "critical", "CI is failing" + (s.ciBranch ? " on " + s.ciBranch : ""));
  }
  if (s.driftStatus) {
    known += 1;
    if (Number(s.behindBy) > 0) hit(Math.min(20, Number(s.behindBy) * 4), "warn", s.behindBy + " commit" + (s.behindBy === 1 ? "" : "s") + " not deployed yet" + (s.branch ? " (" + s.branch + ")" : ""));
    else if (s.driftStatus === "diverged") hit(10, "warn", "Deployed commit has diverged from the branch");
  }
  if (s.openIncidents !== undefined) {
    known += 1;
    if (s.openIncidents > 0) hit(Math.min(30, s.openIncidents * 15), "critical", s.openIncidents + " open monitoring incident" + (s.openIncidents === 1 ? "" : "s"));
  }
  if (s.autoSync === "on" && Number.isFinite(s.envSyncAgeHours)) {
    known += 1;
    if (s.envSyncAgeHours > 48) hit(5, "info", "Environment variables not synced for " + Math.floor(s.envSyncAgeHours / 24) + " days");
  }

  if (!known) return { level: "unknown", score: null, reasons: [{ severity: "info", text: "Not enough connected data yet" }] };
  score = Math.max(0, score);
  const rank = { critical: 0, warn: 1, info: 2 };
  reasons.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return { level: score >= 85 ? "green" : score >= 60 ? "amber" : "red", score, reasons };
}

module.exports = { projectHealth, openIncidentCount };
