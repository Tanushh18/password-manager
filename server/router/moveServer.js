const express = require("express");
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");
const move = require("../utils/moveServer");

/* Move one Render server to another account, one step per call. See utils/moveServer.js for the order. */
const router = express.Router();
const limiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: "Too many requests. Please slow down." });
const text = (value, max = 200) => (typeof value === "string" ? value.trim().slice(0, max) : "");

router.use("/move-server", authenticate, limiter);
const send = (res, error) => res.status(Number.isInteger(error.status) ? error.status : 500).json({ error: Number.isInteger(error.status) ? error.message : "Something went wrong. Try again." });
const ok = (res, body) => { res.set("Cache-Control", "no-store"); return res.json(body); };

router.get("/move-server/:projectId/origin", async (req, res) => {
  try { return ok(res, await move.origin(req.rootUser, req.params.projectId, text(req.query.serviceId, 160))); }
  catch (error) { return send(res, error); }
});
router.post("/move-server/:projectId/plan", async (req, res) => {
  try { return ok(res, await move.plan(req.rootUser, req.params.projectId, { serviceId: text(req.body?.serviceId, 160), targetAccountId: text(req.body?.targetAccountId, 40), ownerId: text(req.body?.ownerId, 160) })); }
  catch (error) { return send(res, error); }
});
router.post("/move-server/:projectId/create", async (req, res) => {
  try { return ok(res, await move.create(req.rootUser, req.params.projectId, { serviceId: text(req.body?.serviceId, 160), targetAccountId: text(req.body?.targetAccountId, 40), ownerId: text(req.body?.ownerId, 160), name: text(req.body?.name, 60) })); }
  catch (error) { return send(res, error); }
});
router.get("/move-server/:projectId/status", async (req, res) => {
  try { return ok(res, await move.status(req.rootUser, req.params.projectId, { accountId: text(req.query.accountId, 40), serviceId: text(req.query.serviceId, 160) })); }
  catch (error) { return send(res, error); }
});
router.post("/move-server/:projectId/domains/prepare", async (req, res) => {
  try {
    return ok(res, await move.prepareDomains(req.rootUser, req.params.projectId, {
      sourceServiceId: text(req.body?.sourceServiceId, 160),
      targetAccountId: text(req.body?.targetAccountId, 40),
      targetServiceId: text(req.body?.targetServiceId, 160)
    }));
  } catch (error) { return send(res, error); }
});
router.post("/move-server/:projectId/domains/verify", async (req, res) => {
  try {
    return ok(res, await move.verifyDomains(req.rootUser, req.params.projectId, {
      accountId: text(req.body?.accountId, 40),
      serviceId: text(req.body?.serviceId, 160)
    }));
  } catch (error) { return send(res, error); }
});
router.post("/move-server/:projectId/frontends", async (req, res) => {
  try {
    const targets = Array.isArray(req.body?.targets) ? req.body.targets.slice(0, 100) : [];
    return ok(res, await move.frontends(req.rootUser, req.params.projectId, { fromUrl: text(req.body?.fromUrl, 300), toUrl: text(req.body?.toUrl, 300), targets, deploy: req.body?.deploy === true }));
  } catch (error) { return send(res, error); }
});
router.post("/move-server/:projectId/relink", async (req, res) => {
  try { return ok(res, await move.relink(req.rootUser, req.params.projectId, { oldServiceId: text(req.body?.oldServiceId, 160), newAccountId: text(req.body?.newAccountId, 40), newServiceId: text(req.body?.newServiceId, 160), newName: text(req.body?.newName, 60), newUrl: text(req.body?.newUrl, 300) })); }
  catch (error) { return send(res, error); }
});
router.post("/move-server/:projectId/delete-old", async (req, res) => {
  try { return ok(res, await move.deleteOld(req.rootUser, req.params.projectId, { serviceId: text(req.body?.serviceId, 160), accountId: text(req.body?.accountId, 40), confirmName: typeof req.body?.confirmName === "string" ? req.body.confirmName.slice(0, 200) : "" })); }
  catch (error) { return send(res, error); }
});

module.exports = router;
