const STEP_NAMES = ["pings", "monitoring", "autoLink", "projectSync", "envSync", "registrySync", "usage", "telegram"];
const COUNT_KEYS = ["usersChecked", "groupsChecked", "incidentsOpened", "ran", "errors"];

function summarizeStep(name, durationMs, result, threw = false) {
  const safeName = STEP_NAMES.includes(name) ? name : "unknown";
  const counts = {};
  for (const key of COUNT_KEYS) {
    const value = Number(result?.[key]);
    if (Number.isFinite(value) && value >= 0) counts[key] = Math.floor(value);
  }
  const hasErrors = threw || result?.error === true || (Number(result?.errors) || 0) > 0;
  const status = threw || result?.error === true ? "failed" : hasErrors ? "partial" : "success";
  return {
    name: safeName,
    status,
    durationMs: Math.max(0, Math.floor(Number(durationMs) || 0)),
    counts
  };
}

function overallStatus(steps) {
  if ((steps || []).some((step) => step.status === "failed")) return "failed";
  if ((steps || []).some((step) => step.status === "partial")) return "partial";
  return "success";
}

function publicRun(run) {
  if (!run) return null;
  return {
    id: run._id ? String(run._id) : run.id || null,
    source: run.source === "external" ? "external" : "internal",
    status: ["success", "partial", "failed"].includes(run.status) ? run.status : "partial",
    startedAt: new Date(run.startedAt).toISOString(),
    completedAt: new Date(run.completedAt).toISOString(),
    durationMs: Math.max(0, Number(run.durationMs) || 0),
    steps: (Array.isArray(run.steps) ? run.steps : []).map((step) => ({
      name: STEP_NAMES.includes(step.name) ? step.name : "unknown",
      status: ["success", "partial", "failed"].includes(step.status) ? step.status : "partial",
      durationMs: Math.max(0, Number(step.durationMs) || 0),
      counts: Object.fromEntries(COUNT_KEYS.filter((key) => Number.isFinite(Number(step.counts?.[key])) && Number(step.counts[key]) >= 0).map((key) => [key, Math.floor(Number(step.counts[key]))]))
    }))
  };
}

module.exports = { STEP_NAMES, summarizeStep, overallStatus, publicRun };
