const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/schema");
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");

const router = express.Router();
const RENDER_API = "https://api.render.com/v1";
const MAX_ACCOUNTS = 10;
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 90, message: "Too many Render dashboard requests. Please slow down." });
const text = (value, max = 200) => typeof value === "string" ? value.trim().slice(0, max) : "";

function publicAccount(entry, dataKey) {
  const fields = User.publicEntry(entry, dataKey);
  return {
    id: String(entry._id),
    name: fields.name || "Render account",
    connectedAt: fields.connectedAt || entry.createdAt,
    lastValidatedAt: fields.lastValidatedAt || null
  };
}

async function getAccount(req, res) {
  const id = String(req.params.accountId || "");
  if (!mongoose.isValidObjectId(id)) {
    res.status(404).json({ error: "Render account not found." });
    return null;
  }
  const entry = (req.rootUser.renderAccounts || []).find((item) => String(item._id) === id);
  if (!entry || entry.enc !== "udk") {
    res.status(404).json({ error: "Render account not found." });
    return null;
  }
  try {
    const dataKey = await req.rootUser.getDataKey();
    const account = User.publicEntry(entry, dataKey);
    if (!account || !account.apiKey) {
      res.status(422).json({ error: "Saved Render connection could not be decrypted. Reconnect this account." });
      return null;
    }
    return { entry, account, dataKey };
  } catch (error) {
    res.status(500).json({ error: "Could not open the saved Render connection." });
    return null;
  }
}

async function renderRequest(apiKey, path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const headers = new Headers({ Authorization: "Bearer " + apiKey, Accept: "application/json" });
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    const response = await fetch(RENDER_API + path, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal
    });
    const raw = await response.text();
    let payload = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch { payload = { message: "Render returned a non-JSON response." }; }
    if (!response.ok) {
      const message = typeof payload?.message === "string" ? payload.message.slice(0, 400) : "Render API request failed.";
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error.name === "AbortError") {
      const timeout = new Error("Render API request timed out. Try again.");
      timeout.status = 504;
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function sendUpstreamError(res, error) {
  if (error && Number.isInteger(error.status) && error.status >= 400 && error.status < 600) {
    return res.status(error.status).json({ error: error.message || "Render API request failed." });
  }
  return res.status(502).json({ error: "Could not reach Render API. Please retry in a moment." });
}

const safeId = (value) => /^[A-Za-z0-9_-]{1,160}$/.test(String(value || ""));
const servicePath = (serviceId, suffix = "") => "/v1/services/" + encodeURIComponent(serviceId) + suffix;

/* All routes are protected by Stashr's existing authenticated session. */
router.use("/render", authenticate, apiLimiter);

router.get("/render/accounts", async (req, res) => {
  try {
    const dataKey = await req.rootUser.getDataKey();
    const accounts = (req.rootUser.renderAccounts || []).filter((entry) => entry.enc === "udk").map((entry) => publicAccount(entry, dataKey));
    res.set("Cache-Control", "no-store");
    return res.json({ accounts });
  } catch (error) {
    return res.status(500).json({ error: "Could not load Render connections." });
  }
});

router.post("/render/accounts", async (req, res) => {
  const name = text(req.body.name, 80) || "Render account";
  const apiKey = typeof req.body.apiKey === "string" ? req.body.apiKey.trim() : "";
  if (!apiKey || apiKey.length > 4096 || /[\r\n]/.test(apiKey)) {
    return res.status(400).json({ error: "Enter a valid Render API key." });
  }
  if ((req.rootUser.renderAccounts || []).length >= MAX_ACCOUNTS) {
    return res.status(400).json({ error: "You can connect up to 10 Render accounts." });
  }
  try {
    // Validate the credential before saving it. The key is never returned in this response.
    const payload = await renderRequest(apiKey, "/v1/services?limit=100");
    const dataKey = await req.rootUser.getDataKey();
    const now = new Date();
    const entry = {
      _id: new mongoose.Types.ObjectId(),
      enc: "udk",
      data: User.sealEntry(dataKey, { name, apiKey, connectedAt: now.toISOString(), lastValidatedAt: now.toISOString() }),
      createdAt: now,
      updatedAt: now
    };
    await User.updateOne({ _id: req.rootUser._id }, { $push: { renderAccounts: entry } });
    return res.status(201).json({
      account: publicAccount(entry, dataKey),
      services: Array.isArray(payload) ? payload.map((item) => item?.service || item).filter(Boolean) : []
    });
  } catch (error) {
    return sendUpstreamError(res, error);
  }
});

router.delete("/render/accounts/:accountId", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.accountId)) return res.status(404).json({ error: "Render account not found." });
  try {
    const result = await User.updateOne(
      { _id: req.rootUser._id, "renderAccounts._id": req.params.accountId },
      { $pull: { renderAccounts: { _id: req.params.accountId } } }
    );
    if (!result.matchedCount) return res.status(404).json({ error: "Render account not found." });
    return res.json({ message: "Render connection removed." });
  } catch (error) {
    return res.status(500).json({ error: "Could not remove Render connection." });
  }
});

router.get("/render/accounts/:accountId/services", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  try {
    const payload = await renderRequest(saved.account.apiKey, "/v1/services?limit=100");
    await User.updateOne(
      { _id: req.rootUser._id, "renderAccounts._id": saved.entry._id },
      { $set: { "renderAccounts.$.updatedAt": new Date() } }
    );
    return res.json({ services: Array.isArray(payload) ? payload.map((item) => item?.service || item).filter(Boolean) : [] });
  } catch (error) { return sendUpstreamError(res, error); }
});

router.get("/render/accounts/:accountId/logs", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  const ownerId = text(req.query.ownerId, 160);
  const resource = text(req.query.resource, 160);
  const startTime = text(req.query.startTime, 50);
  const endTime = text(req.query.endTime, 50);
  if (!ownerId || !resource || !Number.isFinite(Date.parse(startTime)) || !Number.isFinite(Date.parse(endTime))) {
    return res.status(400).json({ error: "ownerId, resource, startTime and endTime are required." });
  }
  const params = new URLSearchParams({
    ownerId, resource, startTime, endTime,
    direction: req.query.direction === "forward" ? "forward" : "backward",
    limit: String(Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 100))),
    type: ["app", "request", "build"].includes(String(req.query.type)) ? String(req.query.type) : "app"
  });
  try { return res.json(await renderRequest(saved.account.apiKey, "/v1/logs?" + params.toString())); }
  catch (error) { return sendUpstreamError(res, error); }
});

router.get("/render/accounts/:accountId/services/:serviceId/env-vars", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  if (!safeId(req.params.serviceId)) return res.status(400).json({ error: "Invalid service ID." });
  try {
    return res.json(await renderRequest(saved.account.apiKey, servicePath(req.params.serviceId, "/env-vars?limit=100")));
  } catch (error) { return sendUpstreamError(res, error); }
});

router.put("/render/accounts/:accountId/services/:serviceId/env-vars/:key", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  const { serviceId, key } = req.params;
  if (!safeId(serviceId) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof req.body.value !== "string" || req.body.value.length > 20000) {
    return res.status(400).json({ error: "Invalid environment variable key or value." });
  }
  try {
    return res.json(await renderRequest(saved.account.apiKey, servicePath(serviceId, "/env-vars/" + encodeURIComponent(key)), {
      method: "PUT", body: { value: req.body.value }
    }));
  } catch (error) { return sendUpstreamError(res, error); }
});

router.delete("/render/accounts/:accountId/services/:serviceId/env-vars/:key", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  const { serviceId, key } = req.params;
  if (!safeId(serviceId) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return res.status(400).json({ error: "Invalid environment variable key." });
  try {
    return res.json(await renderRequest(saved.account.apiKey, servicePath(serviceId, "/env-vars/" + encodeURIComponent(key)), { method: "DELETE" }));
  } catch (error) { return sendUpstreamError(res, error); }
});

router.get("/render/accounts/:accountId/services/:serviceId/deploys", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  if (!safeId(req.params.serviceId)) return res.status(400).json({ error: "Invalid service ID." });
  try {
    return res.json(await renderRequest(saved.account.apiKey, servicePath(req.params.serviceId, "/deploys?limit=20")));
  } catch (error) { return sendUpstreamError(res, error); }
});

router.post("/render/accounts/:accountId/services/:serviceId/deploys", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  if (!safeId(req.params.serviceId)) return res.status(400).json({ error: "Invalid service ID." });
  const clearCache = req.body.clearCache === true;
  try {
    return res.status(201).json(await renderRequest(saved.account.apiKey, servicePath(req.params.serviceId, "/deploys"), {
      method: "POST",
      body: { clearCache: clearCache ? "clear" : "do_not_clear", deployMode: "build_and_deploy" }
    }));
  } catch (error) { return sendUpstreamError(res, error); }
});

router.post("/render/accounts/:accountId/services/:serviceId/restart", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  if (!safeId(req.params.serviceId)) return res.status(400).json({ error: "Invalid service ID." });
  try {
    return res.json(await renderRequest(saved.account.apiKey, servicePath(req.params.serviceId, "/restart"), { method: "POST" }));
  } catch (error) { return sendUpstreamError(res, error); }
});


async function recordAudit(req, action, accountId, serviceId, details = {}) {
  try {
    const dataKey = await req.rootUser.getDataKey();
    const now = new Date();
    const entry = {
      _id: new mongoose.Types.ObjectId(),
      enc: "udk",
      data: User.sealEntry(dataKey, {
        action, accountId: String(accountId || ""), serviceId: String(serviceId || ""),
        details, at: now.toISOString()
      }),
      createdAt: now, updatedAt: now
    };
    await User.updateOne(
      { _id: req.rootUser._id },
      { $push: { renderAudit: { $each: [entry], $slice: -200 } } }
    );
  } catch (error) {
    // Audit failure must not expose secrets or turn a successful upstream action into a false failure.
  }
}

router.get("/render/audit", async (req, res) => {
  try {
    const dataKey = await req.rootUser.getDataKey();
    const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 50));
    const events = (req.rootUser.renderAudit || []).slice(-limit).reverse().map((entry) => {
      if (entry.enc !== "udk") return null;
      const fields = User.publicEntry(entry, dataKey);
      if (!fields || fields.broken) return null;
      return { id: String(entry._id), ...fields };
    }).filter(Boolean);
    res.set("Cache-Control", "no-store");
    return res.json({ events });
  } catch (error) {
    return res.status(500).json({ error: "Could not load the Render audit history." });
  }
});

router.get("/render/accounts/:accountId/env-groups", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  try {
    return res.json(await renderRequest(saved.account.apiKey, "/v1/env-groups?limit=100"));
  } catch (error) { return sendUpstreamError(res, error); }
});

router.get("/render/accounts/:accountId/services/:serviceId/health", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  if (!safeId(req.params.serviceId)) return res.status(400).json({ error: "Invalid service ID." });
  try {
    const payload = await renderRequest(saved.account.apiKey, servicePath(req.params.serviceId));
    const service = payload?.service || payload;
    const rawUrl = service?.serviceDetails?.url;
    if (!rawUrl) return res.status(200).json({ state: service?.suspended === "suspended" ? "suspended" : "unknown", checkedAt: new Date().toISOString(), message: "Render did not provide a public URL for this service." });
    let target;
    try { target = new URL(rawUrl); } catch { return res.status(200).json({ state: "unknown", checkedAt: new Date().toISOString(), message: "The service URL is invalid." }); }
    if (target.protocol !== "https:" || target.username || target.password || !target.hostname.toLowerCase().endsWith(".onrender.com")) {
      return res.status(200).json({ state: "unsupported", checkedAt: new Date().toISOString(), message: "Only Render-provided HTTPS service URLs on *.onrender.com can be probed." });
    }
    const controller = new AbortController();
    const started = Date.now();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(target.toString(), { method: "GET", redirect: "manual", signal: controller.signal, headers: { "User-Agent": "Stashr-Render-Healthcheck/1.0", "Cache-Control": "no-cache" } });
      const status = response.status;
      await response.body?.cancel();
      const healthy = status >= 200 && status < 400;
      const result = { state: healthy ? "healthy" : "unhealthy", status, latencyMs: Date.now() - started, checkedAt: new Date().toISOString(), url: target.origin + target.pathname, message: healthy ? "Endpoint responded successfully." : "Endpoint returned HTTP " + status + "." };
      await recordAudit(req, "health_check", saved.entry._id, req.params.serviceId, { state: result.state, status, latencyMs: result.latencyMs });
      res.set("Cache-Control", "no-store");
      return res.json(result);
    } finally { clearTimeout(timer); }
  } catch (error) {
    if (error.name === "AbortError") return res.json({ state: "timeout", checkedAt: new Date().toISOString(), message: "Health check timed out after 8 seconds." });
    return sendUpstreamError(res, error);
  }
});

router.post("/render/accounts/:accountId/services/:serviceId/rollback", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  const { serviceId } = req.params;
  const deployId = text(req.body.deployId, 160);
  if (!safeId(serviceId) || !safeId(deployId)) return res.status(400).json({ error: "A valid service ID and deployment ID are required." });
  try {
    const result = await renderRequest(saved.account.apiKey, servicePath(serviceId, "/rollback"), { method: "POST", body: { deployId } });
    await recordAudit(req, "rollback", saved.entry._id, serviceId, { deployId });
    return res.status(201).json(result);
  } catch (error) { return sendUpstreamError(res, error); }
});

router.post("/render/accounts/:accountId/services/:serviceId/deploys/:deployId/cancel", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  const { serviceId, deployId } = req.params;
  if (!safeId(serviceId) || !safeId(deployId)) return res.status(400).json({ error: "Invalid service or deployment ID." });
  try {
    const result = await renderRequest(saved.account.apiKey, servicePath(serviceId, "/deploys/" + encodeURIComponent(deployId) + "/cancel"), { method: "POST" });
    await recordAudit(req, "cancel_deploy", saved.entry._id, serviceId, { deployId });
    return res.json(result);
  } catch (error) { return sendUpstreamError(res, error); }
});

router.post("/render/accounts/:accountId/services/:serviceId/suspend", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  if (!safeId(req.params.serviceId)) return res.status(400).json({ error: "Invalid service ID." });
  try {
    const result = await renderRequest(saved.account.apiKey, servicePath(req.params.serviceId, "/suspend"), { method: "POST" });
    await recordAudit(req, "suspend_service", saved.entry._id, req.params.serviceId);
    return res.json({ result, message: "Suspend requested." });
  } catch (error) { return sendUpstreamError(res, error); }
});

router.post("/render/accounts/:accountId/services/:serviceId/resume", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  if (!safeId(req.params.serviceId)) return res.status(400).json({ error: "Invalid service ID." });
  try {
    const result = await renderRequest(saved.account.apiKey, servicePath(req.params.serviceId, "/resume"), { method: "POST" });
    await recordAudit(req, "resume_service", saved.entry._id, req.params.serviceId);
    return res.json({ result, message: "Resume requested." });
  } catch (error) { return sendUpstreamError(res, error); }
});

router.get("/render/accounts/:accountId/services/:serviceId/snapshots", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  const snapshots = Array.isArray(saved.account.snapshots) ? saved.account.snapshots : [];
  return res.json({ snapshots: snapshots.map((s) => ({ id: s.id, serviceId: s.serviceId, serviceName: s.serviceName, createdAt: s.createdAt, count: Array.isArray(s.variables) ? s.variables.length : 0 })) });
});

router.post("/render/accounts/:accountId/services/:serviceId/snapshots", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  const serviceId = req.params.serviceId;
  if (!safeId(serviceId)) return res.status(400).json({ error: "Invalid service ID." });
  try {
    const [servicePayload, envPayload] = await Promise.all([
      renderRequest(saved.account.apiKey, servicePath(serviceId)),
      renderRequest(saved.account.apiKey, servicePath(serviceId, "/env-vars?limit=100"))
    ]);
    const service = servicePayload?.service || servicePayload;
    const variables = (Array.isArray(envPayload) ? envPayload : Array.isArray(envPayload?.envVars) ? envPayload.envVars : Array.isArray(envPayload?.envVars?.envVars) ? envPayload.envVars.envVars : [])
      .map((item) => item?.envVar || item).filter((item) => item && typeof item.key === "string")
      .map((item) => ({ key: item.key, value: typeof item.value === "string" ? item.value : "" }));
    const snapshots = Array.isArray(saved.account.snapshots) ? saved.account.snapshots.slice(-19) : [];
    const snapshot = { id: new mongoose.Types.ObjectId().toString(), serviceId, serviceName: service?.name || serviceId, createdAt: new Date().toISOString(), variables };
    const nextAccount = { ...saved.account, snapshots: [...snapshots, snapshot] };
    await User.updateOne(
      { _id: req.rootUser._id, "renderAccounts._id": saved.entry._id },
      { $set: { "renderAccounts.$.data": User.sealEntry(saved.dataKey, nextAccount), "renderAccounts.$.updatedAt": new Date() } }
    );
    await recordAudit(req, "env_snapshot_created", saved.entry._id, serviceId, { count: variables.length, snapshotId: snapshot.id });
    return res.status(201).json({ snapshot: { id: snapshot.id, serviceId, serviceName: snapshot.serviceName, createdAt: snapshot.createdAt, count: variables.length } });
  } catch (error) { return sendUpstreamError(res, error); }
});

router.post("/render/accounts/:accountId/services/:serviceId/snapshots/:snapshotId/restore", async (req, res) => {
  const saved = await getAccount(req, res);
  if (!saved) return;
  const { serviceId, snapshotId } = req.params;
  if (!safeId(serviceId) || !mongoose.isValidObjectId(snapshotId)) return res.status(400).json({ error: "Invalid service or snapshot ID." });
  const snapshot = (saved.account.snapshots || []).find((s) => s.id === snapshotId && s.serviceId === serviceId);
  if (!snapshot) return res.status(404).json({ error: "Environment snapshot not found." });
  try {
    const currentPayload = await renderRequest(saved.account.apiKey, servicePath(serviceId, "/env-vars?limit=100"));
    const current = (Array.isArray(currentPayload) ? currentPayload : Array.isArray(currentPayload?.envVars) ? currentPayload.envVars : Array.isArray(currentPayload?.envVars?.envVars) ? currentPayload.envVars.envVars : [])
      .map((item) => item?.envVar || item).filter((item) => item && typeof item.key === "string");
    const wanted = new Map(snapshot.variables.map((item) => [item.key, item.value]));
    const existing = new Set(current.map((item) => item.key));
    for (const variable of snapshot.variables) {
      await renderRequest(saved.account.apiKey, servicePath(serviceId, "/env-vars/" + encodeURIComponent(variable.key)), { method: "PUT", body: { value: variable.value } });
    }
    for (const variable of current) {
      if (!wanted.has(variable.key) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(variable.key)) {
        await renderRequest(saved.account.apiKey, servicePath(serviceId, "/env-vars/" + encodeURIComponent(variable.key)), { method: "DELETE" });
      }
    }
    await recordAudit(req, "env_snapshot_restored", saved.entry._id, serviceId, { snapshotId, restoredCount: snapshot.variables.length, removedCount: [...existing].filter((key) => !wanted.has(key)).length });
    return res.json({ message: "Environment snapshot restored. A deploy may be required.", restoredCount: snapshot.variables.length });
  } catch (error) { return sendUpstreamError(res, error); }
});

module.exports = router;
