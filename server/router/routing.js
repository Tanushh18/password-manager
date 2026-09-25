const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const User = require("../models/schema");
const bcrypt = require("bcrypt");
const authenticate = require("../middlewares/authenticate");
const { encrypt, decrypt } = require("../models/EncDecManager");
const { estimate } = require("../utils/strength");
const rateLimit = require("../middlewares/rateLimit");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COOKIE_OPTIONS = {
    httpOnly: true,     // no JS access
    secure: true,       // HTTPS only
    sameSite: "None",   // the web client lives on another origin
    path: "/"
};
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days, same as the JWT

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const str = (value) => (typeof value === "string" ? value.trim() : "");

// Exact match first; older accounts may have been stored with mixed case.
const findByEmail = async (email) =>
    (await User.findOne({ email })) ||
    (await User.findOne({ email: new RegExp(`^${escapeRegex(email)}$`, "i") }));

// The Android app cannot use cross-site cookies, so it asks for the token in the body.
const wantsToken = (req) =>
    req.body.client === "mobile" || String(req.headers["x-client"] || "").toLowerCase() === "mobile";

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: "Too many attempts. Please wait a few minutes and try again." });

router.post("/register", authLimiter, async (req, res) =>
{
    const name = str(req.body.name);
    const email = str(req.body.email).toLowerCase();
    const password = typeof req.body.password === "string" ? req.body.password : "";
    const cpassword = typeof req.body.cpassword === "string" ? req.body.cpassword : "";

    if (!name || !email || !password || !cpassword)
    {
        return res.status(400).json({ error: "Please fill in every field." });
    }
    if (!EMAIL_RE.test(email))
    {
        return res.status(400).json({ error: "That email doesn't look right." });
    }
    if (password.length < 6)
    {
        return res.status(400).json({ error: "Use at least 6 characters for your password." });
    }
    if (password !== cpassword)
    {
        return res.status(400).json({ error: "Passwords don't match." });
    }

    try
    {
        if (await findByEmail(email))
        {
            return res.status(400).json({ error: "Email already exists." });
        }

        const newUser = new User({ name, email, password });
        await newUser.save();

        return res.status(201).json({ message: "User created successfully." });
    }
    catch (error)
    {
        console.error("register failed:", error.message);
        return res.status(500).json({ error: "There was an internal error. Sorry for the inconvenience." });
    }
})

router.post("/login", authLimiter, async (req, res) =>
{
    const email = str(req.body.email).toLowerCase();
    const password = typeof req.body.password === "string" ? req.body.password : "";

    if (!email || !password)
    {
        return res.status(400).json({ error: "Please fill the data." });
    }

    try
    {
        const user = await findByEmail(email);
        const isMatch = user ? await bcrypt.compare(password, user.password || "") : false;

        if (!isMatch)
        {
            return res.status(400).json({ error: "Invalid Credentials." });
        }

        // Only issue a session once the password is proven.
        const token = await user.generateAuthToken();

        res.cookie("jwtoken", token, { ...COOKIE_OPTIONS, expires: new Date(Date.now() + COOKIE_MAX_AGE) });

        const body = { message: "User login successfully.", name: user.name, email: user.email };
        if (wantsToken(req)) body.token = token;

        return res.status(200).json(body);
    }
    catch (error)
    {
        console.error("login failed:", error.message);
        return res.status(500).json({ error: "There was an internal error. Sorry for the inconvenience." });
    }
})

router.get("/authenticate", authenticate, async (req, res) =>
{
    res.set("Cache-Control", "no-store");
    res.json(req.rootUser.toPublic());
})

router.post("/addnewpassword", authenticate, async (req, res) =>
{
    const platform = str(req.body.platform);
    const platEmail = str(req.body.platEmail) || "NA";
    const userPass = typeof req.body.userPass === "string" ? req.body.userPass : "";

    if (!platform || !userPass)
    {
        return res.status(400).json({ error: "Please fill the form properly" });
    }

    try
    {
        const { iv, encryptedPassword } = encrypt(userPass);
        const isSaved = await req.rootUser.addNewPassword(encryptedPassword, iv, platform, platEmail);

        if (isSaved)
        {
            return res.status(200).json({ message: "Successfully added your password." });
        }
        return res.status(400).json({ error: "Could not save the password." });
    }
    catch (error)
    {
        console.error("addnewpassword failed:", error.message);
        return res.status(500).json({ error: "An unknown error occured." });
    }
})

router.post("/updatepassword", authenticate, async (req, res) =>
{
    const { id } = req.body;
    const platform = str(req.body.platform);
    const platEmail = str(req.body.platEmail);
    const userPass = typeof req.body.userPass === "string" ? req.body.userPass : "";

    if (!id || (!userPass && !platform && !platEmail))
    {
        return res.status(400).json({ error: "Please fill the form properly" });
    }

    try
    {
        const changes = { "passwords.$.updatedAt": new Date() };

        if (userPass)
        {
            const { iv, encryptedPassword } = encrypt(userPass);
            changes["passwords.$.password"] = encryptedPassword;
            changes["passwords.$.iv"] = iv;
        }
        if (platform) changes["passwords.$.platform"] = platform;
        if (platEmail) changes["passwords.$.platEmail"] = platEmail;

        const result = await User.updateOne(
            { _id: req.rootUser._id, "passwords._id": id },
            { $set: changes }
        );

        if (!result || result.n === 0)
        {
            return res.status(404).json({ error: "Could not find that password." });
        }

        return res.status(200).json({ message: "Successfully updated your password." });
    }
    catch (error)
    {
        console.error("updatepassword failed:", error.message);
        return res.status(400).json({ error: "Could not update the password." });
    }
})

router.post("/deletepassword", authenticate, async (req, res) =>
{
    const { id } = req.body;

    if (!id)
    {
        return res.status(400).json({ error: "Could not find data" });
    }

    try
    {
        const result = await User.updateOne({ _id: req.rootUser._id }, { $pull: { passwords: { _id: id } } });

        if (!result || result.nModified === 0)
        {
            return res.status(404).json({ error: "Could not find that password." });
        }

        return res.status(200).json({ message: "Successfully deleted your password." });
    }
    catch (error)
    {
        console.error("deletepassword failed:", error.message);
        return res.status(400).json({ error: "Could not delete the password." });
    }
})

router.get("/logout", async (req, res) =>
{
    // Revoke this session server side too, not just the cookie.
    const token = authenticate.readToken(req);
    if (token)
    {
        try
        {
            const { _id } = jwt.verify(token, process.env.SECRET_KEY);
            await User.updateOne({ _id }, { $pull: { tokens: { token } } });
        }
        catch (error)
        {
            // expired or invalid token: nothing to revoke
        }
    }

    res.clearCookie("jwtoken", COOKIE_OPTIONS);
    res.status(200).send("Logout");
})

/**
 * Decrypt one of the signed-in user's own passwords.
 * Accepts `{ id }` (preferred) or the legacy `{ iv, encryptedPassword }`
 * pair — either way the entry must belong to the caller.
 */
router.post("/decrypt", authenticate, (req, res) =>
{
    const { id, iv, encryptedPassword } = req.body;
    const entries = req.rootUser.passwords || [];

    const entry = id
        ? entries.find((p) => String(p._id) === String(id))
        : entries.find((p) => p.password === encryptedPassword && p.iv === iv);

    if (!entry)
    {
        return res.status(404).json({ error: "Could not find that password." });
    }

    try
    {
        res.set("Cache-Control", "no-store");
        return res.status(200).send(decrypt(entry.password, entry.iv));
    }
    catch (error)
    {
        return res.status(500).json({ error: "Could not unseal that password." });
    }
})

/**
 * Vault health: how strong each password is and which ones are reused.
 * Plain text never leaves the server here — only scores and ids.
 */
router.get("/insights", authenticate, (req, res) =>
{
    const entries = req.rootUser.passwords || [];
    const byValue = new Map();
    const items = [];
    const OLD_MS = 180 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    entries.forEach((entry) =>
    {
        let plain = null;
        try { plain = decrypt(entry.password, entry.iv); } catch (e) { plain = null; }

        const strength = plain === null ? { score: 0, label: "Unreadable", bits: 0 } : estimate(plain);
        const updated = entry.updatedAt || entry.createdAt;
        const item = {
            id: String(entry._id),
            platform: entry.platform,
            score: strength.score,
            label: strength.label,
            length: plain ? plain.length : 0,
            old: updated ? now - new Date(updated).getTime() > OLD_MS : false,
            reused: false
        };
        items.push(item);

        if (plain)
        {
            if (!byValue.has(plain)) byValue.set(plain, []);
            byValue.get(plain).push(item);
        }
    });

    const reusedGroups = [];
    byValue.forEach((group) =>
    {
        if (group.length > 1)
        {
            group.forEach((item) => { item.reused = true; });
            reusedGroups.push(group.map((item) => item.id));
        }
    });

    const total = items.length;
    const weak = items.filter((i) => i.score <= 1).length;
    const reused = items.filter((i) => i.reused).length;
    const strong = items.filter((i) => i.score >= 3 && !i.reused).length;
    const old = items.filter((i) => i.old).length;

    // 100 when every password is strong, unique and fresh.
    const score = total === 0
        ? 100
        : Math.round(items.reduce((sum, i) =>
        {
            let s = (i.score / 4) * 100;
            if (i.reused) s -= 40;
            if (i.old) s -= 10;
            return sum + Math.max(0, s);
        }, 0) / total);

    res.set("Cache-Control", "no-store");
    return res.status(200).json({ score, total, weak, reused, strong, old, reusedGroups, items });
})

module.exports = router;
