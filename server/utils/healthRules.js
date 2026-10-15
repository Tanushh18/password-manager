const { utilizationPercent } = require("./renderMetrics");

/*
 * Pure incident rules: no I/O, so every case is unit-tested. One verdict per service per monitor round, one
 * action per verdict, and every incident explains itself (cause, labels, timeline, load, deploy, trend).
 *
 * Verdicts:  up | down | deploying | suspended | deleted | unknown
 *   - only "up" may resolve a health incident; unknown / deploying / suspended freeze it (never "recovered" by guesswork)
 *   - "down" opens an incident only when confirmed (the previous round also failed), or on a manual check
 */
const BAD = new Set(["unhealthy", "timeout"]);
const DEPLOYING = new Set(["created", "build_in_progress", "update_in_progress", "pre_deploy_in_progress"]);
const FAILED_DEPLOY = new Set(["build_failed", "update_failed", "pre_deploy_failed"]);
const STALE_MS = 40 * 60 * 1000; // a previous sample older than this says nothing about "consecutive"
const RECENT_DEPLOY_MS = 30 * 60 * 1000;
const FLAP_WINDOW_MS = 60 * 60 * 1000;

const time = (value) => Date.parse(value) || 0;
const isBad = (state) => BAD.has(state);

function verdictFor({ result, checkHealth = true, controlOk = true }) {
  if (result.gone) return "deleted";
  if (result.suspended) return "suspended";
  if (result.error) return "unknown";
  const h = result.health || {};
  if (!checkHealth || !h.state || ["unknown", "unsupported", "suspended"].includes(h.state)) return "unknown";
  if (h.state === "healthy") return "up";
  if (isBad(h.state)) {
    if (DEPLOYING.has(String(result.latestDeploy?.status || "").toLowerCase())) return "deploying";
    if (h.cause === "no_response" && !controlOk) return "unknown";
    return "down";
  }
  return "unknown";
}

/** Samples of one service, oldest first: [{ at, state, verdict }]. The round before `now` decides "consecutive". */
function previousBad(trend, now) {
  const last = trend[trend.length - 1];
  return Boolean(last && isBad(last.state) && last.verdict !== "unknown" && now - time(last.at) <= STALE_MS);
}

/** Start of the unbroken run of failed samples that ends at the newest one (or null). */
function firstFailureAt(trend, now, currentAt) {
  let first = currentAt || null;
  for (let i = trend.length - 1; i >= 0; i -= 1) {
    if (!isBad(trend[i].state) || now - time(trend[i].at) > 6 * STALE_MS) break;
    first = trend[i].at;
  }
  return first;
}

/** How many failed samples in a row end the trend. */
function consecutiveBad(trend) {
  let n = 0;
  for (let i = trend.length - 1; i >= 0 && isBad(trend[i].state); i -= 1) n += 1;
  return n;
}

const lastHealthyAt = (trend) => [...trend].reverse().find((s) => s.state === "healthy")?.at || null;

/** "open" | "resolve" | "suspect" | "none" for the HEALTH incident of one service. */
function healthAction({ verdict, hasOpen, confirmed }) {
  if (verdict === "up") return hasOpen ? "resolve" : "none";
  if (verdict === "down") return hasOpen ? "none" : confirmed ? "open" : "suspect";
  return "none";
}

/* ---------------- causes and labels ---------------- */
const CAUSES = {
  app_error: "App error (server returned 5xx)",
  no_response: "Not responding",
  render_no_server: "Not running on Render",
  memory_exhausted: "Out of memory",
  cpu_saturated: "CPU saturated",
  high_latency: "Slow responses",
  bad_deploy: "Failed after a deploy",
  deploy_failed: "Deploy failed",
  over_budget: "Over budget",
  unclear: "Cause unclear"
};

const pct = (n) => (n == null ? null : Math.round(n * 10) / 10);

/** Load at open time: current and peak CPU / memory as % of the limit, latency, and when the peak happened. */
function loadOf(metrics = {}) {
  const m = (k) => metrics[k] || {};
  const cpuLimit = m("cpu-limit").current, memLimit = m("memory-limit").current;
  return {
    cpuPct: pct(utilizationPercent(m("cpu").current, cpuLimit)),
    cpuPeakPct: pct(utilizationPercent(m("cpu").peak, cpuLimit)),
    memoryPct: pct(utilizationPercent(m("memory").current, memLimit)),
    memoryPeakPct: pct(utilizationPercent(m("memory").peak, memLimit)),
    latencyMs: m("http-latency").current ?? null,
    latencyPeakMs: m("http-latency").peak ?? null,
    peakAt: m("cpu").peakAt || m("memory").peakAt || m("http-latency").peakAt || null
  };
}

function deployContext(latestDeploy, now) {
  if (!latestDeploy || latestDeploy.status === "unavailable") return null;
  const at = latestDeploy.createdAt || null;
  return { status: latestDeploy.status, at, ageMinutes: at ? Math.max(0, Math.round((now - time(at)) / 60000)) : null, commitMessage: latestDeploy.commitMessage || "" };
}

/**
 * Why is it failing? Chosen from evidence only; "unclear" when the evidence does not point at one thing.
 * type: health | deploy_failure | cpu | memory | latency | budget
 */
function classify({ type, health = {}, load = {}, deploy = null, firstFailure = null, plan = "", now = Date.now() }) {
  const hints = [];
  let cause = "unclear";
  if (type === "deploy_failure") { cause = "deploy_failed"; hints.push("Open the deploy logs, fix the build error and push again, or roll back to the last live deploy."); }
  else if (type === "cpu") { cause = "cpu_saturated"; hints.push("CPU stayed near its limit. Look for a busy loop or heavy request; upgrading the plan is the only way to get more CPU."); }
  else if (type === "memory") { cause = "memory_exhausted"; hints.push("Memory is close to the limit and Render restarts a service that exceeds it. Look for a leak or large in-memory data."); }
  else if (type === "latency") { cause = "high_latency"; hints.push("Responses are slow. Check CPU / memory at the same time and recent deploys."); }
  else if (type === "budget") { cause = "over_budget"; }
  else {
    const afterDeploy = deploy?.at && firstFailure && time(firstFailure) >= time(deploy.at) && time(firstFailure) - time(deploy.at) <= RECENT_DEPLOY_MS && !FAILED_DEPLOY.has(String(deploy.status).toLowerCase());
    if (health.cause === "render_no_server") { cause = "render_no_server"; hints.push("Render has no running server for this service: it was deleted, suspended, or its first deploy never succeeded."); }
    else if ((load.memoryPeakPct ?? 0) >= 95) { cause = "memory_exhausted"; hints.push("Memory hit " + load.memoryPeakPct + "% of its limit just before it failed; Render restarts a service that runs out of memory."); }
    else if ((load.cpuPeakPct ?? 0) >= 95 && health.cause === "no_response") { cause = "cpu_saturated"; hints.push("CPU was pinned at " + load.cpuPeakPct + "% of its limit, so requests could not be served."); }
    else if (afterDeploy) { cause = "bad_deploy"; hints.push("It started failing " + Math.max(1, Math.round((time(firstFailure) - time(deploy.at)) / 60000)) + " min after the latest deploy. Roll back, or check the logs for a crash on start-up."); }
    else if (health.cause === "app_error") { cause = "app_error"; hints.push("The process is running but returned an error. Check the application logs."); }
    else if (health.cause === "no_response") {
      cause = "no_response";
      hints.push(plan === "free" ? "A free instance sleeps after ~15 minutes without traffic and takes up to a minute to wake. Keep it awake with a ping job, or check the logs for a crash." : "The service did not answer. Check the logs for a crash or an exhausted resource.");
    }
  }
  const labels = [type === "health" ? "outage" : type === "budget" ? "cost" : type === "deploy_failure" ? "deploy" : "performance", cause];
  if (plan) labels.push(plan === "free" ? "free-plan" : "paid-plan");
  return { cause, causeLabel: CAUSES[cause], hints, labels };
}

/** One-sentence message for the incident (also the Telegram text). */
function describe({ type, name, health = {}, cause, consecutive = 1, lastHealthy = null, deploy = null, load = {}, thresholds = {} }) {
  if (type === "health") {
    const how = health.cause === "app_error" ? "the app answered HTTP " + health.status + (health.path ? " on " + health.path : "")
      : health.cause === "render_no_server" ? "Render has no running server at its URL"
      : "no response after retrying";
    let text = name + " is DOWN: " + how + ".";
    if (consecutive > 1) text += " Failed " + consecutive + " checks in a row.";
    if (lastHealthy) text += " Last healthy: " + new Date(lastHealthy).toISOString().slice(11, 16) + " UTC.";
    if (cause && !["app_error", "no_response", "render_no_server"].includes(cause)) text += " Likely cause: " + CAUSES[cause].toLowerCase() + ".";
    return text;
  }
  if (type === "deploy_failure") return name + " latest deployment failed (" + (deploy?.status || "unknown") + ")" + (deploy?.commitMessage ? ": " + deploy.commitMessage : ".");
  if (type === "cpu") return name + " CPU at " + load.cpuPct + "% of its limit (threshold " + thresholds.cpu + "%)" + (load.peakAt ? ", peak " + load.cpuPeakPct + "% at " + new Date(load.peakAt).toISOString().slice(11, 16) + " UTC" : "") + ".";
  if (type === "memory") return name + " memory at " + load.memoryPct + "% of its limit (threshold " + thresholds.memory + "%)" + (load.peakAt ? ", peak " + load.memoryPeakPct + "% at " + new Date(load.peakAt).toISOString().slice(11, 16) + " UTC" : "") + ".";
  if (type === "latency") return name + " response time reached " + load.latencyMs + " ms (threshold " + thresholds.latencyMs + " ms).";
  return name + ": " + type + ".";
}

/** Resource alerts need to repeat before they open: one noisy sample is not an incident. Returns true when sustained. */
function sustained(trend, type, thresholds) {
  const last = trend[trend.length - 1];
  if (!last) return false;
  const limit = type === "cpu" ? thresholds.cpu : type === "memory" ? thresholds.memory : null;
  const value = type === "cpu" ? last.cpuPct : type === "memory" ? last.memoryPct : last.latencyMs;
  const bar = type === "latency" ? thresholds.latencyMs : limit;
  return value != null && bar != null && value >= bar;
}

/** Number of times this incident key opened within the last hour (flapping). */
function flapCount(events, key, now) {
  return events.filter((e) => [e.groupId, e.serviceKey, e.type].join(":") === key && e.state === "open" && now - time(e.at || e.openedAt) <= FLAP_WINDOW_MS).length;
}

/** Whether a missing metric means we cannot judge a resource incident (so it must not be resolved by guesswork). */
function canJudge(type, result) {
  if (result.error && !result.gone) return false;
  if (type === "health") return result.verdict === "up" || result.verdict === "deleted";
  if (type === "deploy_failure") return result.latestDeploy?.status !== "unavailable";
  const m = result.metrics || {};
  if (type === "cpu") return !m.cpu?.unavailable && !m["cpu-limit"]?.unavailable && m.cpu?.current != null && m["cpu-limit"]?.current != null;
  if (type === "memory") return !m.memory?.unavailable && !m["memory-limit"]?.unavailable && m.memory?.current != null && m["memory-limit"]?.current != null;
  if (type === "latency") return !m["http-latency"]?.unavailable && m["http-latency"]?.current != null;
  return true;
}

module.exports = { verdictFor, healthAction, previousBad, consecutiveBad, firstFailureAt, lastHealthyAt, classify, describe, loadOf, deployContext, sustained, flapCount, canJudge, CAUSES, BAD, DEPLOYING, FAILED_DEPLOY };
