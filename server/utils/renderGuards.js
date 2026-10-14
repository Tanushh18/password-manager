/**
 * Server-side preconditions for permanently deleting a Render service. The UI enforces the same
 * rules, but the API must not rely on it: only suspended services can be deleted, and the caller
 * must echo the exact service name.
 */
function checkServiceDeletion(service, confirmName) {
  if (!service || typeof service !== "object" || !service.id) return { ok: false, status: 404, error: "Service not found." };
  if (service.suspended !== "suspended") return { ok: false, status: 409, error: "Only suspended services can be deleted from Stashr. Suspend the service first." };
  if (typeof confirmName !== "string" || confirmName !== service.name) return { ok: false, status: 400, error: "Type the exact service name to confirm deletion." };
  return { ok: true };
}

module.exports = { checkServiceDeletion };
