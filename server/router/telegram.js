const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");
const bot = require("../utils/telegramBot");

/* Telegram bot: connect / settings for the signed-in user, and the webhook Telegram calls (public, secret-checked). */
const hookLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, message: "Too many updates." });
const fail = (res, error, fallback) => res.status(Number.isInteger(error.status) ? error.status : 500).json({ error: Number.isInteger(error.status) ? error.message : fallback });

router.post("/telegram/webhook/:hookId", hookLimiter, (req, res) => {
  res.status(200).json({ ok: true }); // answer Telegram at once; the reply is sent separately
  bot.handleUpdate(req.params.hookId, req.get("x-telegram-bot-api-secret-token"), req.body).catch(() => {});
});

router.get("/telegram", authenticate, async (req, res) => {
  try { res.set("Cache-Control", "no-store"); return res.json(bot.publicState(await bot.readState(req.rootUser))); }
  catch (e) { return fail(res, e, "Could not read the Telegram settings."); }
});
router.post("/telegram/connect", authenticate, async (req, res) => {
  try { return res.json(await bot.connect(req.rootUser, String(req.body?.token || ""))); }
  catch (e) { return fail(res, e, "Could not connect the bot."); }
});
router.put("/telegram/settings", authenticate, async (req, res) => {
  try { return res.json(await bot.updateSettings(req.rootUser, req.body || {})); }
  catch (e) { return fail(res, e, "Could not save."); }
});
router.post("/telegram/test", authenticate, async (req, res) => {
  try { return res.json({ sent: await bot.sendTest(req.rootUser) }); }
  catch (e) { return fail(res, e, "Could not send."); }
});
router.post("/telegram/disconnect", authenticate, async (req, res) => {
  try { return res.json(await bot.disconnect(req.rootUser)); }
  catch (e) { return fail(res, e, "Could not disconnect."); }
});

module.exports = router;
