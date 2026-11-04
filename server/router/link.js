/**
 * Approve a sign-in or a wall display from a phone you are already signed in on.
 *
 *   POST /link/start            (public)  { purpose: "login"|"wall", email?, label? } -> { id, secret, qr, number?, expiresIn }
 *                                          With an email it is a "push" request (the phone gets a prompt and must match a
 *                                          2-digit number). Without one it is a QR request (the phone scans the screen).
 *   POST /link/poll             (public)  { id, secret } -> { status } and, once approved, the session or wall key (only once)
 *   GET  /link/pending          (signed in) requests waiting for this account
 *   POST /link/:id/approve      (signed in) { code } for QR, { number } for push
 *   POST /link/:id/deny         (signed in)
 *   GET  /wall                  (Bearer wall key) the status board data
 *   GET/DELETE /wall/keys       (signed in) list / revoke wall displays
 *
 * Safety: the asker's secret never leaves the asker; the QR code half is random and only on the screen; push needs a
 * number match so a spammed prompt cannot be approved by reflex; a request lives two minutes, allows 5 wrong answers,
 * and hands over its session exactly once. Unknown emails get the same answer as known ones.
 */
const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const User = require("../models/schema");
const LinkChallenge = require("../models/linkChallenge");
const WallToken = require("../models/wallToken");
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");
const audit = require("../utils/audit");
const { COOKIE_OPTIONS, LEGACY_COOKIE_OPTIONS, COOKIE_MAX_AGE, wantsToken, findByEmail, serverError } = require("./helpers");

const TTL_MS = 2 * 60 * 1000, MAX_TRIES = 5, WALL_TTL_MS = 90 * 24 * 60 * 60 * 1000, MAX_WALLS = 5;
const startLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, message: "Too many requests. Wait a few minutes." });
const pollLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, message: "Polling too fast." });
const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 40, message: "Too many changes. Slow down." });

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const hex = (n) => crypto.randomBytes(n).toString("hex");
const twoDigits = () => String(crypto.randomInt(10, 100));
const cleanLabel = (v, fallback) => String(v || "").replace(/[^\w .,'()\-]/g, "").trim().slice(0, 40) || fallback;

/** What the phone shows for a waiting request. Never includes the secret or the code. */
const publicRow = (c) => ({ id: c.id, purpose: c.purpose, mode: c.mode, label: c.label, ip: c.ip, expiresAt: c.expires });

router.post("/link/start", startLimiter, async (req, res) => {
    try {
        const b = req.body || {};
        const purpose = b.purpose === "wall" ? "wall" : b.purpose === "login" ? "login" : "";
        if (!purpose) return res.status(400).json({ error: "Say what this is for: login or wall." });
        const email = String(b.email || "").trim().toLowerCase();
        const mode = email ? "push" : "qr";
        if (mode === "push" && purpose === "wall") return res.status(400).json({ error: "A wall display links by QR code." });
        const id = hex(8), secret = hex(24), code = hex(12), number = mode === "push" ? twoDigits() : "";
        let user;
        if (mode === "push") { const u = await findByEmail(email); user = u ? u._id : undefined; }
        // An unknown email still gets a normal-looking request that nobody can ever approve.
        await LinkChallenge.create({
            id, secretHash: sha(secret), codeHash: sha(code), purpose, mode, user, number,
            label: cleanLabel(b.label, audit.deviceLabel(req.headers["user-agent"])), ip: audit.clientIp(req),
            expires: new Date(Date.now() + TTL_MS)
        });
        res.set("Cache-Control", "no-store");
        return res.status(201).json({ id, secret, number: number || undefined, qr: mode === "qr" ? `stashr://link/${id}.${code}` : undefined, expiresIn: TTL_MS / 1000 });
    } catch (e) { return serverError(res, "link start", e); }
});

router.post("/link/poll", pollLimiter, async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        const id = String((req.body && req.body.id) || ""), secret = String((req.body && req.body.secret) || "");
        const c = /^[a-f0-9]{16}$/.test(id) ? await LinkChallenge.findOne({ id }) : null;
        if (!c || !same(sha(secret), c.secretHash)) return res.status(404).json({ status: "expired" });
        if (c.status === "pending") return res.json({ status: c.expires > new Date() ? "pending" : "expired" });
        if (c.status === "denied") { await LinkChallenge.deleteOne({ _id: c._id }); return res.json({ status: "denied" }); }
        if (c.status === "claimed") return res.json({ status: "expired" });
        // Approved: hand over exactly once.
        const claimed = await LinkChallenge.findOneAndUpdate({ _id: c._id, status: "approved" }, { $set: { status: "claimed" } });
        if (!claimed) return res.json({ status: "expired" });
        const user = await User.findById(c.user);
        if (!user) return res.json({ status: "expired" });

        if (c.purpose === "wall") {
            const key = hex(32);
            const have = await WallToken.find({ user: user._id }).sort({ createdAt: 1 }).lean();
            if (have.length >= MAX_WALLS) await WallToken.deleteMany({ _id: { $in: have.slice(0, have.length - MAX_WALLS + 1).map((w) => w._id) } });
            await WallToken.create({ user: user._id, tokenHash: sha(key), label: c.label, expires: new Date(Date.now() + WALL_TTL_MS) });
            audit.record(req, user._id, "wall_linked", c.label);
            return res.json({ status: "approved", wallKey: key });
        }
        const client = wantsToken(req) ? "mobile" : "web";
        const token = await user.generateAuthToken(client);
        void User.updateOne({ _id: user._id, "tokens.token": token }, { $set: { "tokens.$.device": c.label, "tokens.$.ip": c.ip } }).catch(() => {});
        audit.record(req, user._id, "sign_in", `approved on phone (${c.mode})`);
        res.cookie("jwtoken", token, { ...COOKIE_OPTIONS, expires: new Date(Date.now() + COOKIE_MAX_AGE) });
        res.clearCookie("jwtoken", LEGACY_COOKIE_OPTIONS);
        const body = { status: "approved", name: user.name, email: user.email };
        if (client === "mobile" || (req.body && req.body.returnToken === true)) body.token = token;
        return res.json(body);
    } catch (e) { return serverError(res, "link poll", e); }
});

router.get("/link/pending", authenticate, async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        const rows = await LinkChallenge.find({ user: req.rootUser._id, mode: "push", status: "pending", expires: { $gt: new Date() } }).sort({ expires: -1 }).limit(5).lean();
        return res.json({ requests: rows.map(publicRow) });
    } catch (e) { return serverError(res, "link pending", e); }
});

router.post("/link/:id/approve", authenticate, writeLimiter, async (req, res) => {
    try {
        const b = req.body || {};
        const c = await LinkChallenge.findOne({ id: String(req.params.id), status: "pending", expires: { $gt: new Date() } });
        if (!c) return res.status(404).json({ error: "That request expired. Start again on the other screen." });
        if (c.mode === "push" && String(c.user) !== String(req.rootUser._id)) return res.status(404).json({ error: "That request expired. Start again on the other screen." });
        const ok = c.mode === "qr" ? same(sha(b.code || ""), c.codeHash) : same(String(b.number || ""), c.number);
        if (!ok) {
            c.tries += 1;
            if (c.tries >= MAX_TRIES) await LinkChallenge.deleteOne({ _id: c._id }); else await c.save();
            return res.status(400).json({ error: c.mode === "qr" ? "That QR code didn't match. Scan the screen again." : "Wrong number. Check the screen you are signing in on.", ...(c.tries >= MAX_TRIES ? { expired: true } : {}) });
        }
        const r = await LinkChallenge.updateOne({ _id: c._id, status: "pending" }, { $set: { status: "approved", user: req.rootUser._id } });
        if (!r.modifiedCount) return res.status(404).json({ error: "That request expired. Start again on the other screen." });
        audit.record(req, req.rootUser._id, "link_approved", `${c.purpose} ${c.label}`);
        return res.json({ ok: true, purpose: c.purpose, label: c.label });
    } catch (e) { return serverError(res, "link approve", e); }
});

router.post("/link/:id/deny", authenticate, writeLimiter, async (req, res) => {
    try {
        const r = await LinkChallenge.updateOne({ id: String(req.params.id), user: req.rootUser._id, status: "pending" }, { $set: { status: "denied" } });
        if (r.matchedCount) audit.record(req, req.rootUser._id, "link_denied", "");
        return res.json({ ok: true });
    } catch (e) { return serverError(res, "link deny", e); }
});

/* ── Wall display ── */

const wallAuth = async (req, res, next) => {
    try {
        const h = String(req.headers.authorization || "");
        const key = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
        const row = /^[a-f0-9]{64}$/.test(key) ? await WallToken.findOne({ tokenHash: sha(key), expires: { $gt: new Date() } }) : null;
        if (!row) return res.status(401).json({ error: "This display is no longer linked. Link it again from your phone." });
        void WallToken.updateOne({ _id: row._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
        req.wallUser = row.user;
        return next();
    } catch (e) { return serverError(res, "wall auth", e); }
};

/** Collapses the per-project statuses into what a wall needs: names, one state, nothing secret. */
function buildBoard(statuses, pings, now = new Date()) {
    const projects = (Array.isArray(statuses) ? statuses : []).slice(0, 40).map((p) => ({
        name: String((p.service && p.service.name) || (p.github && p.github.fullName) || p.name || "project").slice(0, 60),
        state: String((p.health && p.health.level) || "unknown").slice(0, 20)
    }));
    const checks = (Array.isArray(pings) ? pings : []).slice(0, 40).map((r) => ({
        name: String(r.name || r.target || "check").replace(/^https?:\/\//, "").slice(0, 60), ok: r.ok === true, ms: Number(r.ms) || null
    }));
    const bad = projects.filter((p) => p.state === "red").length + checks.filter((c) => !c.ok).length;
    return { overall: projects.length + checks.length === 0 ? "unknown" : bad ? "degraded" : "operational", problems: bad, projects, checks, updatedAt: now.toISOString() };
}

router.get("/wall", wallAuth, async (req, res) => {
    try {
        const user = await User.findById(req.wallUser);
        if (!user) return res.status(401).json({ error: "This display is no longer linked." });
        const { getProjectStatuses } = require("../utils/projectStatus");
        const { pingResults } = require("../utils/pings");
        let statuses = [];
        try { const d = await getProjectStatuses(user, {}); statuses = d.statuses || []; } catch (e) { /* board still renders */ }
        let pings = [];
        try { pings = Object.values(pingResults(user._id) || {}); } catch (e) { /* ignore */ }
        res.set("Cache-Control", "no-store");
        return res.json(buildBoard(statuses, pings));
    } catch (e) { return serverError(res, "wall", e); }
});

router.get("/wall/keys", authenticate, async (req, res) => {
    try {
        const rows = await WallToken.find({ user: req.rootUser._id }).sort({ createdAt: 1 }).lean();
        return res.json({ displays: rows.map((w) => ({ id: String(w._id), label: w.label, createdAt: w.createdAt, lastUsedAt: w.lastUsedAt || null })) });
    } catch (e) { return serverError(res, "wall keys", e); }
});

router.delete("/wall/keys/:id", authenticate, writeLimiter, async (req, res) => {
    try {
        if (!/^[a-f0-9]{24}$/.test(String(req.params.id))) return res.status(404).json({ error: "Not found." });
        const r = await WallToken.deleteOne({ _id: req.params.id, user: req.rootUser._id });
        if (!r.deletedCount) return res.status(404).json({ error: "Not found." });
        audit.record(req, req.rootUser._id, "wall_unlinked", "");
        return res.json({ ok: true });
    } catch (e) { return serverError(res, "wall unlink", e); }
});

module.exports = router;
module.exports.buildBoard = buildBoard;
