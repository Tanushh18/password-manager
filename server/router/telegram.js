const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");
const bot = require("../utils/telegramBot");

/* Telegram bot: connect / settings for the signed-in user, and the webhook Telegram calls (public, secret-checked). */
const hookLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, message: "Too many updates." });
const eventLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: "Too many Telegram events." });
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
router.get("/telegram/notifications", authenticate, async (req, res) => {
  try { res.set("Cache-Control", "no-store"); return res.json({ notifications: await bot.notificationHistory(req.rootUser) }); }
  catch (e) { return fail(res, e, "Could not read notification history."); }
});
router.post("/telegram/events", authenticate, eventLimiter, async (req, res) => {
  const category = String(req.body?.category || "system").toLowerCase();
  const title = String(req.body?.title || "").slice(0, 120);
  const text = String(req.body?.text || "").trim().slice(0, 3000);
  const allowed = ["system", "servers", "projects", "github", "apps", "vault", "security", "home", "photos", "money", "hosting", "account"];
  if (!allowed.includes(category) || !text) return res.status(400).json({ error: "A supported category and non-empty text are required." });
  try { return res.json({ delivered: await bot.notifyEvent(req.rootUser, { category, title, text, html: false, dedupeKey: req.body?.dedupeKey }) }); }
  catch (e) { return fail(res, e, "Could not deliver the Telegram event."); }
});
// Why updates may not be arriving, and a one-press fix (turns on what a Home update needs and sends a test message).
router.get("/telegram/diagnose", authenticate, async (req, res) => {
  try { res.set("Cache-Control", "no-store"); return res.json(await bot.diagnose(req.rootUser)); }
  catch (e) { return fail(res, e, "Could not check Telegram."); }
});
router.post("/telegram/repair", authenticate, async (req, res) => {
  try { return res.json(await bot.repair(req.rootUser)); }
  catch (e) { return fail(res, e, "Could not fix Telegram."); }
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
