/**
 * Server-side preconditions for permanently deleting a Render service. The UI enforces the same
 * rules, but the API must not rely on it: only suspended services can be deleted. A single delete
 * additionally requires the exact service name; bulk delete (one explicit yes/no in the UI) passes
 * `{ requireName: false }` and relies on the suspended check alone.
 */
function checkServiceDeletion(service, confirmName, { requireName = true } = {}) {
  if (!service || typeof service !== "object" || !service.id) return { ok: false, status: 404, error: "Service not found." };
  if (service.suspended !== "suspended") return { ok: false, status: 409, error: "Only suspended services can be deleted from Stashr. Suspend the service first." };
  if (requireName && (typeof confirmName !== "string" || confirmName !== service.name)) return { ok: false, status: 400, error: "Type the exact service name to confirm deletion." };
  return { ok: true };
}

/** Validates and de-duplicates a bulk-delete request body. */
function parseBulkTargets(body, { max = 20 } = {}) {
  const idPattern = /^[A-Za-z0-9_-]{1,160}$/;
  const list = Array.isArray(body?.services) ? body.services : null;
  if (!list || !list.length) return { error: "Select at least one service." };
  if (list.length > max) return { error: "You can delete up to " + max + " services at once." };
  const seen = new Set();
  const targets = [];
  for (const item of list) {
    const accountId = String(item?.accountId || ""), serviceId = String(item?.serviceId || "");
    if (!idPattern.test(accountId) || !idPattern.test(serviceId)) return { error: "Invalid service selection." };
    const key = accountId + ":" + serviceId;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ accountId, serviceId });
  }
  return { targets };
}

/** Runs `fn` over `items` with at most `limit` in flight; results keep input order and never reject. */
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      try { results[index] = await fn(items[index], index); }
      catch (error) { results[index] = { ok: false, error: error?.message || "Unexpected error." }; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

module.exports = { checkServiceDeletion, parseBulkTargets, mapWithConcurrency };
