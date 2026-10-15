const crypto = require("crypto");

/*
 * Compares environment variables across several servers (and the Stashr copy) WITHOUT exposing any value.
 * Equal values get the same variant letter (A, B, ...), chosen per variable; the fingerprints use a random
 * per-call key and never leave this function. Pure.
 *
 * servers: [{ id, vars: [{ key, value }] | null }]   (null = could not be read; it is left out of the verdict)
 * informational: ids shown in the matrix but left out of the verdict (the Stashr copy).
 * status per variable: "common" (everywhere, same value) | "different" (everywhere, values differ) | "partial" (missing on some) | "stashr_only" (on no server)
 */
function compareEnv(servers, { informational = [] } = {}) {
  const key = crypto.randomBytes(16);
  const fingerprint = (value) => crypto.createHmac("sha256", key).update(String(value)).digest("hex");
  const readable = servers.filter((s) => Array.isArray(s.vars));
  const judged = readable.filter((s) => !informational.includes(s.id)); // e.g. the Stashr copy: shown, but never decides common/partial
  const names = [...new Set(readable.flatMap((s) => s.vars.map((v) => v.key)))].sort((a, b) => a.localeCompare(b));
  const rows = names.map((name) => {
    const cells = {};
    const seen = new Map();
    for (const server of servers) {
      if (!Array.isArray(server.vars)) { cells[server.id] = { state: "unknown" }; continue; }
      const found = server.vars.find((v) => v.key === name);
      if (!found) { cells[server.id] = { state: "missing" }; continue; }
      const value = found.value == null ? "" : String(found.value);
      if (value === "") { cells[server.id] = { state: "empty" }; continue; }
      const fp = fingerprint(value);
      if (!seen.has(fp)) seen.set(fp, String.fromCharCode(65 + (seen.size % 26)));
      cells[server.id] = { state: "set", variant: seen.get(fp) };
    }
    const everywhere = judged.every((s) => cells[s.id].state !== "missing");
    const judgedVariants = new Set(judged.map((s) => cells[s.id].variant).filter(Boolean)).size;
    const onNoServer = judged.length > 0 && judged.every((s) => cells[s.id].state === "missing");
    const status = onNoServer ? "stashr_only" : !everywhere ? "partial" : judgedVariants > 1 ? "different" : "common";
    return { name, cells, status, variants: seen.size };
  });
  const count = (status) => rows.filter((r) => r.status === status).length;
  return { columns: servers.map((s) => s.id), rows, summary: { total: rows.length, common: count("common"), different: count("different"), partial: count("partial"), stashrOnly: count("stashr_only") } };
}

module.exports = { compareEnv };
