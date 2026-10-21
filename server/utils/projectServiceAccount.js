/* Pure: moving a linked Render service to another connected account (the service ID does not change). */

/**
 * fields: a decrypted project. Returns the project fields to save, or null when nothing changes.
 * Only links that already exist are retargeted; the primary link follows when it points at the same service.
 */
function retargetService(fields, serviceId, accountId) {
  const services = Array.isArray(fields?.renderServices) ? fields.renderServices : [];
  const hit = services.find((s) => s && s.serviceId === serviceId);
  const primary = fields?.renderServiceId === serviceId;
  if (!hit && !primary) return null;
  const next = services.map((s) => (s && s.serviceId === serviceId ? { ...s, accountId } : s));
  const patch = {};
  if (primary) patch.renderAccountId = accountId;
  if (hit) patch.renderServices = next;
  return Object.keys(patch).length ? patch : null;
}

module.exports = { retargetService };
