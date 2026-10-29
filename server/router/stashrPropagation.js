/* Admin-only settings for pushing Stashr's main server URL into other apps' Render env. See utils/stashrPropagation.js. */
const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/authenticate");
const registry = require("./registry");
const { stashrUrls } = require("../utils/mainServer");
const { ENV_NAME } = require("../utils/stashrPropagation");
const runner = require("../utils/stashrPropagationRunner");

// The latest Stashr frontend (stashr-client) update from the same history log the Servers page shows.
async function frontendStatus() {
  try {
    const row = await require("../models/registry").findOne({ app: "stashr" }, { syncLog: 1 }).lean();
    const entry = ((row && row.syncLog) || []).filter((e) => /^frontend /.test(e.action || "")).pop();
    return entry ? { ok: entry.action === "frontend updated", at: entry.at, message: String(entry.reason || "").slice(0, 160) } : null;
  } catch { return null; }
}

const requireAdmin = (req, res, next) => (registry.isAdminUser(req.rootUser) ? next() : res.status(403).json({ error: "Not allowed." }));
const fail = (res) => res.status(500).json({ error: "Could not complete that." });

router.get("/stashr/propagation", authenticate, requireAdmin, async (req, res) => {
  try {
    const dataKey = await req.rootUser.getDataKey();
    const state = runner.readState(req.rootUser, dataKey);
    return res.json({
      envName: ENV_NAME,
      mainUrl: (await stashrUrls())[0] || "",
      enabled: state.enabled, projectIds: state.projectIds, testedAt: state.testedAt,
      lastRunAt: state.lastRunAt, lastRun: state.lastRun, applied: state.applied,
      projects: runner.listProjects(req.rootUser, dataKey),
      frontend: await frontendStatus()
    });
  } catch { return fail(res); }
});

router.put("/stashr/propagation", authenticate, requireAdmin, async (req, res) => {
  try {
    const dataKey = await req.rootUser.getDataKey();
    const state = runner.readState(req.rootUser, dataKey);
    const allowed = new Set(runner.listProjects(req.rootUser, dataKey).map((p) => p.id));
    const body = req.body || {};
    if (Array.isArray(body.projectIds)) state.projectIds = [...new Set(body.projectIds.map(String))].filter((id) => allowed.has(id)).slice(0, 50);
    if (typeof body.enabled === "boolean") {
      if (body.enabled && !state.testedAt) return res.status(400).json({ error: "Run the test on one app first." });
      state.enabled = body.enabled;
    }
    await runner.writeState(req.rootUser, dataKey, state);
    return res.json({ ok: true, enabled: state.enabled, projectIds: state.projectIds });
  } catch { return fail(res); }
});

// The one test: update a single selected app now (env and deploy). A success unlocks the automatic switch.
router.post("/stashr/propagation/test", authenticate, requireAdmin, async (req, res) => {
  try { return res.json(await runner.runForUser(req.rootUser, { only: String((req.body || {}).projectId || "") })); }
  catch { return fail(res); }
});

// Manual "update all selected apps now", whether or not the automatic switch is on.
router.post("/stashr/propagation/run", authenticate, requireAdmin, async (req, res) => {
  try { return res.json(await runner.runForUser(req.rootUser, { force: true })); }
  catch { return fail(res); }
});

module.exports = router;
