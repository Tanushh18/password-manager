/**
 * Render reports CPU in cores and memory in bytes, so thresholds expressed as a percentage must be
 * compared against the matching limit metric. Returns null when either value is unavailable, so a
 * missing limit never produces a false alert.
 */
function utilizationPercent(current, limit) {
  const used = Number(current), cap = Number(limit);
  if (current == null || limit == null || !Number.isFinite(used) || !Number.isFinite(cap) || cap <= 0) return null;
  return Math.round(used / cap * 1000) / 10;
}

/** Resource alerts for one sampled service. Suspended services never alert. */
function resourceChecks(result, thresholds) {
  if (result.suspended) return [];
  const metrics = result.metrics || {};
  const cpu = utilizationPercent(metrics.cpu?.current, metrics["cpu-limit"]?.current);
  const memory = utilizationPercent(metrics.memory?.current, metrics["memory-limit"]?.current);
  const latency = metrics["http-latency"]?.current;
  const checks = [];
  if (cpu != null && cpu >= thresholds.cpu) checks.push({ type: "cpu", severity: "warning", message: result.name + " CPU at " + cpu + "% of its limit (threshold " + thresholds.cpu + "%)" });
  if (memory != null && memory >= thresholds.memory) checks.push({ type: "memory", severity: "warning", message: result.name + " memory at " + memory + "% of its limit (threshold " + thresholds.memory + "%)" });
  if (latency != null && latency >= thresholds.latencyMs) checks.push({ type: "latency", severity: "warning", message: result.name + " latency metric reached " + latency + (metrics["http-latency"].unit || "") });
  return checks;
}

module.exports = { utilizationPercent, resourceChecks };
