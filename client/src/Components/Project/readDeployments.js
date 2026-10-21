import { getProjectDeployments } from "../../api/client";

// One read per project at a time: the Render matrix and the branch tree on the same page share it.
const inFlight = new Map();

/** Reads the project's Render servers. Calls within 20 seconds share one request unless `fresh` is set. */
export function readDeployments(projectId, { fresh = false } = {}) {
  const hit = inFlight.get(projectId);
  if (hit && !fresh && Date.now() - hit.at < 20000) return hit.promise;
  const promise = getProjectDeployments(projectId);
  inFlight.set(projectId, { at: Date.now(), promise });
  promise.catch(() => inFlight.delete(projectId));
  return promise;
}
