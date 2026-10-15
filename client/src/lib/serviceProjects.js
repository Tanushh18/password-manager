/** Which Stashr project each Render service belongs to: Map(serviceId -> { id, name, main }). Pure. */
export function serviceProjectIndex(projects) {
  const index = new Map();
  for (const p of projects || []) {
    if (!p || !p.id) continue;
    const add = (serviceId, main) => { if (serviceId && !index.has(serviceId)) index.set(serviceId, { id: p.id, name: p.name || "Untitled project", main }); };
    add(p.renderServiceId, true);
    for (const s of Array.isArray(p.renderServices) ? p.renderServices : []) add(s?.serviceId, s?.serviceId === p.renderServiceId);
  }
  return index;
}

/** serviceKey is "accountId:serviceId". */
export const serviceIdOfKey = (key) => String(key || "").split(":").slice(1).join(":");
