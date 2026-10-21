/* Pure: planning a copy of one service's variables onto other services of the same project. */
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * source / target: [{ key, value }] as Render returns them.
 *   create  - in the source, missing on the target
 *   update  - in both with different values (only applied when the caller asks to overwrite)
 *   same    - identical already
 *   extra   - only on the target; never deleted
 *   skipped - empty or invalid names/values in the source are never copied
 */
function planEnvSync(source, target) {
  const want = new Map();
  let skipped = 0;
  for (const row of Array.isArray(source) ? source : []) {
    if (!row || !NAME.test(String(row.key || "")) || typeof row.value !== "string" || row.value === "") { skipped += 1; continue; }
    want.set(row.key, row.value);
  }
  const have = new Map();
  for (const row of Array.isArray(target) ? target : []) if (row && typeof row.key === "string") have.set(row.key, typeof row.value === "string" ? row.value : "");
  const plan = { create: [], update: [], same: [], extra: [], skipped, values: want };
  for (const [key, value] of want) {
    if (!have.has(key)) plan.create.push(key);
    else if (have.get(key) === value) plan.same.push(key);
    else plan.update.push(key);
  }
  for (const key of have.keys()) if (!want.has(key)) plan.extra.push(key);
  return plan;
}

/** Names that will be written when the caller applies the plan. */
const pendingNames = (plan, { overwrite = false } = {}) => [...plan.create, ...(overwrite ? plan.update : [])];

module.exports = { planEnvSync, pendingNames, NAME };
