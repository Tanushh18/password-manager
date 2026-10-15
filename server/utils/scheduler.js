const renderOps = require("./renderOps");
const { runAllEnvSync } = require("./renderEnvSync");
const { runAllAutoLink } = require("./projectStatus");
const { runAllUsage } = require("./usageIO");
const { runAllProjectSync } = require("./projectAutoSync");
const { runAllRegistrySync } = require("./registrySyncIO");
const { runAllPings } = require("./pings");
const { runAllDigests } = require("./telegramBot");

/*
 * Background upkeep: monitoring (incidents + alerts), project / link sync, env sync, server registry and usage.
 * Runs inside the server every TICK_MINUTES (default 5), so it no longer depends on GitHub's scheduled workflow,
 * which in practice fires only every few hours. The external POST /render/ops/tick still works and shares the
 * same lock, so two ticks never overlap. Set INTERNAL_SCHEDULER=false to turn the in-process timer off.
 */
let running = null;
let last = null;

async function runTick(source = "internal") {
  if (running) return { ...(await running), skipped: "already running" };
  running = (async () => {
    const startedAt = new Date().toISOString();
    const step = async (fn) => { try { return await fn(); } catch { return { error: true }; } };
    const pings = await step(runAllPings);
    const monitoring = await step(() => renderOps.runAllEnabledMonitoring());
    const autoLink = await step(runAllAutoLink);
    const projectSync = await step(runAllProjectSync);
    const envSync = await step(runAllEnvSync);
    const registrySync = await step(runAllRegistrySync);
    const usage = await step(runAllUsage);
    const telegram = await step(runAllDigests);
    last = { ok: true, source, startedAt, completedAt: new Date().toISOString(), ...monitoring, pings, autoLink, projectSync, envSync, registrySync, usage, telegram };
    return last;
  })();
  try { return await running; } finally { running = null; }
}

function startScheduler() {
  if (String(process.env.INTERNAL_SCHEDULER).toLowerCase() === "false") { console.log("scheduler        : disabled via INTERNAL_SCHEDULER=false"); return null; }
  const minutes = Math.max(1, Math.min(60, Number(process.env.TICK_MINUTES) || 5));
  const tick = () => { runTick("internal").catch(() => { /* every step is isolated already */ }); };
  setTimeout(tick, 90 * 1000).unref?.(); // let the database connect first
  const timer = setInterval(tick, minutes * 60 * 1000);
  timer.unref?.();
  console.log("scheduler        : every " + minutes + " min (monitoring, sync, usage)");
  return timer;
}

const lastTick = () => last;

module.exports = { runTick, startScheduler, lastTick };
