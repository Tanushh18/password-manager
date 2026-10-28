/* Public status page: an opt-in snapshot of chosen Render services (name and running / suspended) that anyone with the
   link can read. Nothing else is public: no URLs, env vars, account names, incidents or costs. Pure helpers here. */

const SLUG = /^[a-z0-9][a-z0-9-]{2,38}[a-z0-9]$/;
const MAX_SERVICES = 25;

/** A slug from user input, or null when it is not usable. */
function normalizeSlug(value) {
  const slug = String(value || "").trim().toLowerCase();
  return SLUG.test(slug) ? slug : null;
}

/**
 * services: [{ id, name, suspended }] from the user's Render services
 * serviceIds: the ones the user chose to publish
 * Returns the public view: names and a state per service. No ids, URLs or accounts.
 */
function buildSnapshot(services, serviceIds, now = new Date()) {
  const chosen = new Set((serviceIds || []).map(String));
  const rows = (services || [])
    .filter((s) => chosen.has(String(s.id)))
    .slice(0, MAX_SERVICES)
    .map((s) => ({ name: String(s.name || "service").slice(0, 80), state: s.suspended ? "suspended" : "running" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const allRunning = rows.every((r) => r.state === "running");
  return { overall: rows.length === 0 ? "unknown" : allRunning ? "operational" : "degraded", services: rows, updatedAt: now.toISOString() };
}

module.exports = { normalizeSlug, buildSnapshot, MAX_SERVICES };
