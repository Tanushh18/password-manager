/*
 * The ONE health probe. The monitor (incidents), the per-service "Check" button, "Check all open", the deploy
 * readiness wait and Telegram's Check button all use it, so they can never disagree.
 *
 * Is the service up? Any answer below 5xx proves the process is running: an API that returns 404 for "/" or 429
 * when rate limiting is alive, not down. Only no answer (after a patient retry for free-tier cold starts), a 5xx,
 * or Render's own "no server here" page (deleted / suspended service) counts as down. Each failure carries a
 * `cause` so the incident can say what is actually wrong.
 */
const FALLBACK_PATHS = ["/health", "/healthz", "/api/health", "/ping"];
const HEADERS = { "User-Agent": "Stashr-Render-Monitor/1.0", "Cache-Control": "no-cache" };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const retryable = (r) => Boolean(r.error) || [502, 503, 504].includes(r.status);
const renderHasNoServer = (routing) => /no-server|suspend/i.test(routing || "");
const nowIso = () => new Date().toISOString();

async function attempt(url, timeoutMs) {
  try {
    const response = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers: HEADERS });
    await response.body?.cancel();
    return { status: response.status, routing: response.headers?.get?.("x-render-routing") || "" };
  } catch (error) {
    return { error: error.name === "TimeoutError" || error.name === "AbortError" ? "timeout" : "unreachable" };
  }
}

/** A valid Render-provided origin (URL), or null. Only https *.onrender.com is ever probed. */
function renderOrigin(rawUrl) {
  let target;
  try { target = new URL(rawUrl); } catch { return null; }
  if (target.protocol !== "https:" || target.username || target.password || !target.hostname.toLowerCase().endsWith(".onrender.com")) return null;
  return target;
}

/**
 * Probes `target`. `healthPath` is the service's own Render health-check path when it has one: it is what Render
 * itself judges the service by, so it is tried first. Result: { state, status, path, cause, message, latencyMs, checkedAt }
 * with state healthy | unhealthy | timeout and cause app_error | no_response | render_no_server | no_health_route.
 */
async function probeUrl(target, { healthPath = "", retryDelayMs = 1000 } = {}) {
  const started = Date.now();
  const done = (fields) => ({ latencyMs: Date.now() - started, checkedAt: nowIso(), ...fields });
  const primaryPath = /^\/\S*$/.test(healthPath || "") ? healthPath : "/";
  const primaryUrl = new URL(primaryPath, target).toString();

  let probe = await attempt(primaryUrl, 8000);
  // A sleeping free instance needs a while to wake: ask once more, with patience, before calling it down.
  if (retryable(probe)) { await sleep(retryDelayMs); probe = await attempt(primaryUrl, 20000); }

  if (probe.error) {
    return done({ state: probe.error === "timeout" ? "timeout" : "unhealthy", cause: "no_response", path: primaryPath, message: probe.error === "timeout" ? "No response after retrying (the service may be asleep, crashed or overloaded)." : "Could not connect to the service." });
  }
  if (renderHasNoServer(probe.routing)) {
    return done({ state: "unhealthy", status: probe.status, cause: "render_no_server", path: primaryPath, message: "Render has no running server at this URL (deleted, suspended or never deployed)." });
  }
  if (probe.status >= 200 && probe.status < 400) return done({ state: "healthy", status: probe.status, path: primaryPath });
  if (probe.status < 500) {
    if (probe.status === 404) {
      for (const path of FALLBACK_PATHS) {
        if (path === primaryPath) continue;
        const next = await attempt(new URL(path, target).toString(), 8000);
        if (next.status >= 200 && next.status < 400) return done({ state: "healthy", status: next.status, path });
      }
    }
    return done({ state: "healthy", status: probe.status, path: primaryPath, cause: "no_health_route", message: "Answered HTTP " + probe.status + " on " + primaryPath + "; the server is up (it has no health route there)." });
  }
  return done({ state: "unhealthy", status: probe.status, cause: "app_error", path: primaryPath, message: "The app answered HTTP " + probe.status + " on " + primaryPath + "." });
}

/** Probe a Render service object (from the Render API). Adds unknown / suspended / unsupported states. */
async function probeService(service, options = {}) {
  if (service?.suspended === "suspended") return { state: "suspended", checkedAt: nowIso() };
  const rawUrl = service?.serviceDetails?.url;
  if (!rawUrl) return { state: "unknown", checkedAt: nowIso(), message: "No Render-provided public URL." };
  const target = renderOrigin(rawUrl);
  if (!target) return { state: "unsupported", checkedAt: nowIso(), message: "Only Render-provided HTTPS *.onrender.com URLs are probed." };
  return probeUrl(target, { healthPath: service?.serviceDetails?.healthCheckPath || "", ...options });
}

/**
 * Is Stashr's own network working? Any HTTP answer from Render's API host proves it. When it is not, services are
 * reported "unknown" instead of every one of them being declared down.
 */
async function controlReachable() {
  const r = await attempt("https://api.render.com/", 6000);
  return !r.error;
}

module.exports = { probeUrl, probeService, renderOrigin, controlReachable, FALLBACK_PATHS };
