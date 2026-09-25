const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const User = require("../models/schema");
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");
const { encrypt, decrypt } = require("../models/EncDecManager");
const { estimate } = require("../utils/strength");
const {
    EMAIL_RE, COOKIE_OPTIONS, COOKIE_MAX_AGE, str, raw, findByEmail, isBlob, validKdf,
    wantsToken, checkPassword, checkSecondFactor, serverError
} = require("./helpers");

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: "Too many attempts. Please wait a few minutes and try again." });

/* ════════════════ AUTH ════════════════ */

router.post("/register", authLimiter, async (req, res) =>
{
    const name = str(req.body.name);
    const email = str(req.body.email).toLowerCase();
    const password = raw(req.body.password);
    const cpassword = raw(req.body.cpassword);
    const { kdf, keyCheck } = req.body;

    if (!name || !email || !password || !cpassword)
    {
        return res.status(400).json({ error: "Please fill in every field." });
    }
    if (!EMAIL_RE.test(email))
    {
        return res.status(400).json({ error: "That email doesn't look right." });
    }
    if (password.length < 8)
    {
        return res.status(400).json({ error: "Use at least 8 characters for your master password." });
    }
    if (password !== cpassword)
    {
        return res.status(400).json({ error: "Passwords don't match." });
    }
    // New clients set up end-to-end encryption at sign up; old clients may not.
    if ((kdf || keyCheck) && !(validKdf(kdf) && isBlob(keyCheck)))
    {
        return res.status(400).json({ error: "Invalid vault settings." });
    }

    try
    {
        if (await findByEmail(email))
        {
            return res.status(400).json({ error: "Email already exists." });
        }

        const user = new User({ name, email, password });
        if (kdf && keyCheck)
        {
            user.kdf = { salt: kdf.salt, iterations: kdf.iterations };
            user.keyCheck = keyCheck;
        }
        await user.save();

        return res.status(201).json({ message: "User created successfully." });
    }
    catch (error)
    {
        return serverError(res, "register", error);
    }
});

router.post("/login", authLimiter, async (req, res) =>
{
    const email = str(req.body.email).toLowerCase();
    const password = raw(req.body.password);

    if (!email || !password)
    {
        return res.status(400).json({ error: "Please fill the data." });
    }

    try
    {
        const user = await findByEmail(email);
        const isMatch = user ? await checkPassword(user, password) : false;

        if (!isMatch)
        {
            return res.status(400).json({ error: "Invalid Credentials." });
        }

        if (user.twoFactor && user.twoFactor.enabled)
        {
            if (!req.body.code)
            {
                return res.status(401).json({ error: "Enter the code from your authenticator app.", twoFactorRequired: true });
            }
            if (!checkSecondFactor(user, req.body.code))
            {
                await user.save();
                return res.status(401).json({ error: "That code didn't work. Try the newest one.", twoFactorRequired: true });
            }
        }

        // Only issue a session once every factor is proven.
        const client = wantsToken(req) ? "mobile" : "web";
        const token = await user.generateAuthToken(client);

        res.cookie("jwtoken", token, { ...COOKIE_OPTIONS, expires: new Date(Date.now() + COOKIE_MAX_AGE) });

        const body = {
            message: "User login successfully.",
            name: user.name,
            email: user.email,
            vault: user.toPublic().vault,
            twoFactorEnabled: Boolean(user.twoFactor && user.twoFactor.enabled)
        };
        if (client === "mobile") body.token = token;

        return res.status(200).json(body);
    }
    catch (error)
    {
        return serverError(res, "login", error);
    }
});

router.get("/authenticate", authenticate, async (req, res) =>
{
    res.set("Cache-Control", "no-store");
    res.json(req.rootUser.toPublic());
});

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
});

/* ════════════════ LEGACY (server-encrypted) ENTRIES ════════════════
   Kept so older web builds keep working. New clients encrypt on the device
   (see router/vault.js) and migrate these entries on first unlock. */

router.post("/addnewpassword", authenticate, async (req, res) =>
{
    const platform = str(req.body.platform);
    const platEmail = str(req.body.platEmail) || "NA";
    const userPass = raw(req.body.userPass);

    if (!platform || !userPass)
    {
        return res.status(400).json({ error: "Please fill the form properly" });
    }

    try
    {
        const { iv, encryptedPassword, tag } = encrypt(userPass);
        await req.rootUser.addNewPassword(encryptedPassword, iv, platform, platEmail, tag);
        return res.status(200).json({ message: "Successfully added your password." });
    }
    catch (error)
    {
        return serverError(res, "addnewpassword", error);
    }
});

router.post("/updatepassword", authenticate, async (req, res) =>
{
    const { id } = req.body;
    const platform = str(req.body.platform);
    const platEmail = str(req.body.platEmail);
    const userPass = raw(req.body.userPass);

    if (!id || (!userPass && !platform && !platEmail))
    {
        return res.status(400).json({ error: "Please fill the form properly" });
    }

    try
    {
        const entry = req.rootUser.passwords.id(id);
        if (!entry || entry.enc === "e2e")
        {
            return res.status(404).json({ error: "Could not find that password." });
        }

        if (userPass)
        {
            const { iv, encryptedPassword, tag } = encrypt(userPass);
            entry.enc = "gcm";
            entry.password = encryptedPassword;
            entry.iv = iv;
            entry.tag = tag;
        }
        if (platform) entry.platform = platform;
        if (platEmail) entry.platEmail = platEmail;
        entry.updatedAt = new Date();
        await req.rootUser.save();

        return res.status(200).json({ message: "Successfully updated your password." });
    }
    catch (error)
    {
        return serverError(res, "updatepassword", error);
    }
});

router.post("/deletepassword", authenticate, async (req, res) =>
{
    const { id } = req.body;

    if (!id)
    {
        return res.status(400).json({ error: "Could not find data" });
    }

    try
    {
        const result = await User.updateOne(
            { _id: req.rootUser._id, "passwords._id": id },
            { $pull: { passwords: { _id: id } } }
        );

        if (!result || result.matchedCount === 0)
        {
            return res.status(404).json({ error: "Could not find that password." });
        }

        return res.status(200).json({ message: "Successfully deleted your password." });
    }
    catch (error)
    {
        return res.status(400).json({ error: "Could not delete the password." });
    }
});

/**
 * Decrypt one of the signed-in user's own legacy entries (so a new client can
 * migrate it to end-to-end encryption). Accepts `{ id }` or the older
 * `{ iv, encryptedPassword }` pair.
 */
router.post("/decrypt", authenticate, (req, res) =>
{
    const { id, iv, encryptedPassword } = req.body;
    const entries = req.rootUser.passwords || [];

    const entry = id
        ? entries.find((p) => String(p._id) === String(id))
        : entries.find((p) => p.password === encryptedPassword && p.iv === iv);

    if (!entry || entry.enc === "e2e")
    {
        return res.status(404).json({ error: "Could not find that password." });
    }

    try
    {
        res.set("Cache-Control", "no-store");
        return res.status(200).send(decrypt(entry.password, entry.iv, entry.tag));
    }
    catch (error)
    {
        return res.status(500).json({ error: "Could not unseal that password." });
    }
});

/** Health of legacy entries only — end-to-end entries are scored on the device. */
router.get("/insights", authenticate, (req, res) =>
{
    const entries = (req.rootUser.passwords || []).filter((e) => e.enc !== "e2e");
    const byValue = new Map();
    const items = [];
    const OLD_MS = 180 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    entries.forEach((entry) =>
    {
        let plain = null;
        try { plain = decrypt(entry.password, entry.iv, entry.tag); } catch (e) { plain = null; }

        const strength = plain === null ? { score: 0, label: "Unreadable" } : estimate(plain);
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
    const score = total === 0
        ? 100
        : Math.round(items.reduce((sum, i) => sum + Math.max(0, (i.score / 4) * 100 - (i.reused ? 40 : 0) - (i.old ? 10 : 0)), 0) / total);

    res.set("Cache-Control", "no-store");
    return res.status(200).json({
        score,
        total,
        weak: items.filter((i) => i.score <= 1).length,
        reused: items.filter((i) => i.reused).length,
        strong: items.filter((i) => i.score >= 3 && !i.reused).length,
        old: items.filter((i) => i.old).length,
        reusedGroups,
        items
    });
});

router.use(require("./vault"));
router.use(require("./account"));

module.exports = router;
