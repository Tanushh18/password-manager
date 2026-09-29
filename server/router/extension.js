const express = require("express");
const router = express.Router();
const User = require("../models/schema");
const authenticate = require("../middlewares/authenticate");
const { serverError } = require("./helpers");

/*
 * Extension API endpoints
 * These endpoints are designed for the browser extension to fetch passwords
 * and support autofill functionality across different websites.
 */

// Get all passwords for the logged-in user
router.get("/password/all", authenticate, async (req, res) => {
  try {
    const dataKey = await req.rootUser.getDataKey();
    const passwords = (req.rootUser.passwords || []).map((p) =>
      User.publicEntry(p, dataKey)
    );

    return res.status(200).json({ passwords });
  } catch (error) {
    return serverError(res, "password/all", error);
  }
});

// Get passwords filtered by domain/service
router.get("/password/by-domain", authenticate, async (req, res) => {
  const domain = (req.query.domain || "").toLowerCase().trim();

  if (!domain) {
    return res.status(400).json({ error: "Domain parameter required." });
  }

  try {
    const dataKey = await req.rootUser.getDataKey();
    const allPasswords = (req.rootUser.passwords || []).map((p) =>
      User.publicEntry(p, dataKey)
    );

    // Filter passwords by domain/service match
    const filtered = allPasswords.filter((pwd) => {
      const service = (pwd.service || pwd.platform || "").toLowerCase();
      const cleanDomain = domain.replace("www.", "");
      return (
        service.includes(cleanDomain) ||
        cleanDomain.includes(service) ||
        service.includes(domain)
      );
    });

    return res.status(200).json({ passwords: filtered });
  } catch (error) {
    return serverError(res, "password/by-domain", error);
  }
});

// Get single password by ID
router.get("/password/:id", authenticate, async (req, res) => {
  try {
    const password = (req.rootUser.passwords || []).find(
      (p) => p._id.toString() === req.params.id
    );

    if (!password) {
      return res.status(404).json({ error: "Password not found." });
    }

    const dataKey = await req.rootUser.getDataKey();
    const decrypted = User.publicEntry(password, dataKey);

    return res.status(200).json({ password: decrypted });
  } catch (error) {
    return serverError(res, "password/:id", error);
  }
});

// Decrypted password access (for autofill - be careful with this!)
router.get("/password/:id/decrypted", authenticate, async (req, res) => {
  // This endpoint should only be called from trusted sources (the extension)
  // Consider adding additional validation/rate limiting here

  try {
    const password = (req.rootUser.passwords || []).find(
      (p) => p._id.toString() === req.params.id
    );

    if (!password) {
      return res.status(404).json({ error: "Password not found." });
    }

    const dataKey = await req.rootUser.getDataKey();
    const decrypted = User.publicEntry(password, dataKey);

    // Return only the password field (not username, service, etc.)
    // This is specifically for autofill functionality
    return res.status(200).json({
      password: decrypted.password || "",
      username: decrypted.username || decrypted.platEmail || "",
      service: decrypted.service || decrypted.platform || "Unknown"
    });
  } catch (error) {
    return serverError(res, "password/:id/decrypted", error);
  }
});

module.exports = router;
