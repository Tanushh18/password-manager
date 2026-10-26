/* Combined status report: every server / job the Cron page knows about, grouped into "200 OK" and "Failed". Pure helpers. */

const isOk = (r) => Boolean(r && r.ok);

/** One row: { group, name, ok: true | false | null (not checked), status, ms, detail } */
const row = (group, name, r, extra = {}) => ({
  group, name,
  ok: r == null ? null : isOk(r),
  status: r && r.status ? r.status : 0,
  ms: r && Number.isFinite(r.ms) ? r.ms : null,
  detail: r == null ? "Not checked yet" : isOk(r) ? "" : r.missingRoute ? "No /health route (404)" : r.error || (r.status ? "HTTP " + r.status : "No answer"),
  ...extra,
});

/**
 * Inputs (all optional):
 *  - pings: [{ name, result }]           ping jobs per web service (result from /render/ops/pings)
 *  - scan: [{ name, ... }]               /health scan rows (same shape as a ping result)
 *  - api: [{ url, ok, status, ms, error }]  Stashr API servers probed from the browser
 *  - crons: [{ name, suspended }]        Render cron job services
 *  - tick: { completedAt, ok? } | null   last run of the background scheduler
 */
export function buildReport({ pings = [], scan = [], api = [], crons = [], tick, now = Date.now(), tickMaxAgeMs = 15 * 60000 } = {}) {
  const rows = [];
  api.forEach((a) => rows.push(row("Stashr API servers", a.url.replace(/^https?:\/\//, ""), a)));
  pings.forEach((p) => rows.push(row("Ping jobs", p.name, p.result)));
  scan.forEach((s) => rows.push(row("/health routes", s.name, s)));
  crons.forEach((c) => rows.push({
    group: "Render cron jobs", name: c.name, ok: c.suspended !== "suspended", status: 0, ms: null,
    detail: c.suspended === "suspended" ? "Suspended" : "",
  }));
  if (tick !== undefined) {
    const age = tick && tick.completedAt ? now - Date.parse(tick.completedAt) : null;
    rows.push({
      group: "Background scheduler", name: "Scheduler tick", ok: age == null ? null : age <= tickMaxAgeMs && tick.ok !== false, status: 0, ms: null,
      detail: age == null ? "Has not run yet" : age > tickMaxAgeMs ? "Last ran " + Math.round(age / 60000) + " min ago" : "",
    });
  }
  const ok = rows.filter((r) => r.ok === true);
  const failed = rows.filter((r) => r.ok === false);
  const unchecked = rows.filter((r) => r.ok === null);
  return { rows, ok, failed, unchecked, summary: { total: rows.length, ok: ok.length, failed: failed.length, unchecked: unchecked.length } };
}

const line = (r) => `${r.name}${r.status ? " [" + r.status + "]" : ""}${r.ms != null ? " " + r.ms + "ms" : ""}${r.detail ? " - " + r.detail : ""} (${r.group})`;

export function reportText(report, at = new Date()) {
  const s = report.summary;
  return [
    `Stashr status report ${at.toISOString()}`,
    `${s.ok} OK, ${s.failed} failed, ${s.unchecked} not checked`,
    "",
    `200 OK (${s.ok}):`, ...report.ok.map((r) => "  + " + line(r)),
    "",
    `Failed (${s.failed}):`, ...report.failed.map((r) => "  - " + line(r)),
    ...(s.unchecked ? ["", `Not checked yet (${s.unchecked}):`, ...report.unchecked.map((r) => "  ? " + line(r))] : []),
  ].join("\n");
}

const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
export function reportCSV(report) {
  const head = ["result", "group", "name", "status", "ms", "detail"];
  const rows = report.rows.map((r) => [r.ok === true ? "ok" : r.ok === false ? "failed" : "not checked", r.group, r.name, r.status || "", r.ms ?? "", r.detail]);
  return [head, ...rows].map((r) => r.map(cell).join(",")).join("\n");
}

/** GETs `${url}/health` for each server in parallel with a timeout; never throws. */
export async function probeServers(urls, fetchFn = fetch, timeoutMs = 60000) {
  return Promise.all(urls.map(async (url) => {
    const base = String(url).replace(/\/+$/, "");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const t0 = Date.now();
    try {
      const res = await fetchFn(base + "/health", { signal: controller.signal, cache: "no-store" });
      return { url: base, ok: res.status === 200, status: res.status, ms: Date.now() - t0, error: res.status === 200 ? "" : "HTTP " + res.status };
    } catch (e) {
      return { url: base, ok: false, status: 0, ms: Date.now() - t0, error: e && e.name === "AbortError" ? "Timed out" : "Unreachable" };
    } finally { clearTimeout(timer); }
  }));
}
