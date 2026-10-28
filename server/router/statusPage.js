/* Public read of a status page. No login: it returns only the snapshot the owner chose to publish. */
const express = require("express");
const router = express.Router();
const User = require("../models/schema");
const { normalizeSlug } = require("../utils/statusPage");

router.get("/status/:slug", async (req, res) => {
  const slug = normalizeSlug(req.params.slug);
  if (!slug) return res.status(404).json({ error: "Not found." });
  try {
    const user = await User.findOne({ "publicStatus.slug": slug, "publicStatus.enabled": true }, { publicStatus: 1 }).lean();
    const page = user && user.publicStatus;
    if (!page) return res.status(404).json({ error: "Not found." });
    const snap = page.snapshot || {};
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Cache-Control", "public, max-age=30");
    return res.json({
      title: String(page.title || slug).slice(0, 80),
      overall: snap.overall || "unknown",
      services: snap.services || [],
      updatedAt: snap.updatedAt || null
    });
  } catch {
    return res.status(500).json({ error: "Could not load the status page." });
  }
});

module.exports = router;
