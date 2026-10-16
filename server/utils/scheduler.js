const mongoose = require("mongoose");
const crypto = require("crypto");
const SystemJobRun = require("../models/SystemJobRun");
const { summarizeStep, overallStatus, publicRun } = require("./schedulerState");
const renderOps = require("./renderOps");
const { runAllEnvSync } = require("./renderEnvSync");
const { runAllAutoLink } = require("./projectStatus");
const { runAllUsage } = require("./usageIO");
const { runAllProjectSync } = require("./projectAutoSync");
const { runAllRegistrySync } = require("./registrySyncIO");
const { runAllPings } = require("./pings");
const { runAllDigests } = require("./telegramBot");

const HISTORY_LIMIT = 100;
let running = null;
let last = null;

async function persistRun(run) {
  if (mongoose.connection.readyState !== 1) return;
  try {
    await SystemJobRun.create({
      source: run.source,
      status: run.status,
      startedAt: new Date(run.startedAt),
      completedAt: new Date(run.completedAt),
      durationMs: run.durationMs,
      steps: run.steps
    });
    const excess = await SystemJobRun.find().sort({ startedAt: -1 }).skip(HISTORY_LIMIT).select("_id").lean();
    if (excess.length) await SystemJobRun.deleteMany({ _id: { $in: excess.map((row) => row._id) } });
  } catch {
    // The current process still exposes its in-memory status; a persistence failure must not crash the API.
  }
}

async function executeStep(name, fn, steps) {
  const start = Date.now();
  try {
    const result = await fn();
    steps.push(summarizeStep(name, Date.now() - start, result));
    return result;
  } catch {
    // Intentionally do not persist provider errors: they can contain sensitive request details.
    steps.push(summarizeStep(name, Date.now() - start, null, true));
    return { error: true };
  }
}

async function runTick(source = "internal") {
  if (running) return { ...(await running), skipped: "already running" };
  running = (async () => {
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const steps = [];
    const pings = await executeStep("pings", runAllPings, steps);
    const monitoring = await executeStep("monitoring", () => renderOps.runAllEnabledMonitoring(), steps);
    const autoLink = await executeStep("autoLink", runAllAutoLink, steps);
    const projectSync = await executeStep("projectSync", runAllProjectSync, steps);
    const envSync = await executeStep("envSync", runAllEnvSync, steps);
    const registrySync = await executeStep("registrySync", runAllRegistrySync, steps);
    const usage = await executeStep("usage", runAllUsage, steps);
    const telegram = await executeStep("telegram", runAllDigests, steps);
    const completedAt = new Date().toISOString();
    const status = overallStatus(steps);
    const run = {
      id: crypto.randomUUID(),
      ok: status === "success",
      status,
      source: source === "external" ? "external" : "internal",
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.now() - started),
      steps,
      ...monitoring,
      pings,
      autoLink,
      projectSync,
      envSync,
      registrySync,
      usage,
      telegram
    };
    last = run;
    await persistRun(run);
    return run;
  })();
  try { return await running; } finally { running = null; }
}

function startScheduler() {
  if (String(process.env.INTERNAL_SCHEDULER).toLowerCase() === "false") { console.log("scheduler        : disabled via INTERNAL_SCHEDULER=false"); return null; }
  const minutes = Math.max(1, Math.min(60, Number(process.env.TICK_MINUTES) || 5));
  const tick = () => { runTick("internal").catch(() => { /* failures are recorded by each step */ }); };
  setTimeout(tick, 90 * 1000).unref?.(); // let the database connect first
  const timer = setInterval(tick, minutes * 60 * 1000);
  timer.unref?.();
  console.log("scheduler        : every " + minutes + " min (monitoring, sync, usage)");
  return timer;
}

async function getSchedulerStatus(limit = 10) {
  const count = Math.max(1, Math.min(20, Number(limit) || 10));
  if (mongoose.connection.readyState === 1) {
    try {
      const rows = await SystemJobRun.find().sort({ startedAt: -1 }).limit(count).lean();
      const recentRuns = rows.map(publicRun);
      if (recentRuns.length) return { lastTick: recentRuns[0], recentRuns };
    } catch { /* use in-memory fallback when persistence is unavailable */ }
  }
  const recentRuns = last ? [publicRun(last)] : [];
  return { lastTick: recentRuns[0] || null, recentRuns };
}

const lastTick = () => last;

module.exports = { runTick, startScheduler, lastTick, getSchedulerStatus, executeStep, persistRun };
