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

module.exports = router;
