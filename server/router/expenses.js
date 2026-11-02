/*
 * Money: UPI and bank messages, categories and statement checks. The transactions live ONLY in the owner's Google Sheet; MongoDB keeps
 * the sheet id, the start date, the owner's own category rules, the known account endings and a few counters (models/expenseSettings.js).
 *
 * Kept for 4 months: a row dated more than 120 days ago (IST) is MOVED to the sheet's "Archive" tab (never deleted), once a day and right
 * when it arrives (the first backfill). The list, the totals and the statement check read only the "Transactions" tab.
 *
 *   GET  /expenses/settings   PUT /expenses/sheet {sheetUrl}   POST /expenses/start {date} (once)
 *   POST /expenses/sms {messages:[{address,body,date}]}        GET  /expenses?month=YYYY-MM
 *   PUT  /expenses/category {index,category,remember}          PUT  /expenses/review {index,action}
 *   GET/PUT /expenses/rules                                    POST /expenses/statement?filename=… (raw bytes)
 */
const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");
const Settings = require("../models/expenseSettings");
const ex = require("../utils/expenses");
const sheets = require("../utils/sheets");

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 40, message: "Too many changes. Slow down." });
const smsLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: "Too many syncs. Wait a minute." });
const fail = (res, e, fallback) => res.status(Number.isInteger(e.status) ? e.status : 500).json({ error: Number.isInteger(e.status) ? e.message : fallback });
const RETENTION_DAYS = 120;
const cutoffDate = (now = Date.now()) => ex.ist(now - RETENTION_DAYS * 86400000);

async function settingsOf(owner) {
    return (await Settings.findOne({ owner }).lean()) || (await Settings.create({ owner })).toObject();
}
const need = (s) => { if (!s.sheetId) throw Object.assign(new Error("Add your Google Sheet link first."), { status: 400 }); };
const userRules = (s) => (s.rules || []).filter((r) => r && r.match && r.category);
// The full list for the pickers: the defaults and the owner's own, no repeats, "Uncategorized" always last.
const allCategories = (s) => [...new Set([...ex.DEFAULT_CATEGORIES, ...(s.categories || []), ...userRules(s).map((r) => r.category)])].filter((c) => c !== "Uncategorized").concat(["Uncategorized"]);

const publicSettings = (s) => ({
    ready: sheets.ready(), serviceAccountEmail: sheets.serviceEmail(), configured: Boolean(s.sheetId), sheetUrl: s.sheetUrl || "", sheetId: s.sheetId || "",
    startDate: s.startDate || "", needsStartDate: Boolean(s.sheetId) && !s.startDate, lastSyncAt: s.lastSyncAt || null, lastSmsAt: s.lastSmsAt || 0,
    retentionMonths: 4, categories: allCategories(s), rules: userRules(s).map((r) => ({ match: r.match, category: r.category })), lastStatement: s.lastStatement || null
});

const readTx = async (sheetId, tab = "Transactions") => (await sheets.readRows(sheetId, tab)).map((r, i) => ex.txFromRow(r, i + 2));
const key = (t) => `${t.date} ${t.time}`;

/** Moves rows older than the 4-month window to the Archive tab (once a day). */
async function archiveOld(owner, s) {
    const today = ex.ist(Date.now());
    if (s.lastArchiveDay === today) return 0;
    const raw = await sheets.readRows(s.sheetId, "Transactions");
    const cut = cutoffDate();
    const old = raw.map((r, i) => ({ r, row: i + 2 })).filter((x) => x.r[0] && String(x.r[0]) < cut);
    if (old.length) {
        await sheets.appendRows(s.sheetId, "Archive", old.map((x) => x.r));
        await sheets.deleteRows(s.sheetId, "Transactions", old.map((x) => x.row));
    }
    await Settings.updateOne({ owner }, { $set: { lastArchiveDay: today } });
    return old.length;
}

router.get("/expenses/settings", authenticate, async (req, res) => {
    try { res.set("Cache-Control", "no-store"); return res.json(publicSettings(await settingsOf(req.rootUser._id))); }
    catch (e) { return fail(res, e, "Could not load the settings."); }
});

router.put("/expenses/sheet", authenticate, writeLimiter, async (req, res) => {
    try {
        const owner = req.rootUser._id;
        const id = sheets.parseSheetId(req.body && req.body.sheetUrl);
        if (!id) return res.status(400).json({ error: "Paste the link of your Google Sheet (docs.google.com/spreadsheets/d/…)." });
        await sheets.ensureLayout(id);
        const cur = await settingsOf(owner);
        await Settings.updateOne({ owner }, { $set: { sheetId: id, sheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`, ...(cur.sheetId && cur.sheetId !== id ? { lastSmsAt: 0, lastArchiveDay: "", knownAccounts: [] } : {}) } });
        return res.json(publicSettings(await settingsOf(owner)));
    } catch (e) { return fail(res, e, "Could not set up the sheet."); }
});

// The one-time choice of how far back to read the messages. Once set it cannot be changed or asked again.
router.post("/expenses/start", authenticate, writeLimiter, async (req, res) => {
    try {
        const owner = req.rootUser._id, s = await settingsOf(owner);
        need(s);
        if (s.startDate) return res.status(400).json({ error: "The start date is already set." });
        const d = ex.parseDate(req.body && req.body.date);
        if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(String(req.body.date).slice(0, 10)) || d > ex.ist(Date.now()) || d < "2015-01-01") return res.status(400).json({ error: "Pick a date in the past (or today)." });
        const r = await Settings.updateOne({ owner, startDate: "" }, { $set: { startDate: d } });
        if (!r.modifiedCount) return res.status(400).json({ error: "The start date is already set." });
        return res.json({ startDate: d, retention: `Entries older than ${RETENTION_DAYS} days go to the Archive tab of your sheet.` });
    } catch (e) { return fail(res, e, "Could not save the start date."); }
});

router.post("/expenses/sms", authenticate, smsLimiter, async (req, res) => {
    try {
        const owner = req.rootUser._id, s = await settingsOf(owner);
        need(s);
        if (!s.startDate) return res.json({ needsStartDate: true, added: 0, flagged: 0, duplicates: 0, ignored: 0, unparsed: [], lastSmsAt: s.lastSmsAt || 0 });
        const list = Array.isArray(req.body && req.body.messages) ? req.body.messages : null;
        if (!list || list.length > 200) return res.status(400).json({ error: "Send up to 200 messages at a time." });
        const rules = userRules(s), now = Date.now(), cut = cutoffDate(now);
        let ignored = 0, duplicates = 0, flaggedCount = 0, newest = s.lastSmsAt || 0;
        const unparsed = [];
        const parsed = [];
        for (const m of list) {
            const body = m && typeof m.body === "string" ? m.body.slice(0, 600) : "";
            const received = Number(m && m.date);
            const p = ex.parseSms(body);
            if (!p) { if (/federal/i.test(body) && !/\botp\b/i.test(body) && unparsed.length < 5) unparsed.push({ body: body.slice(0, 120) }); else ignored++; continue; }
            const when = Number.isFinite(received) && received > 0 && received <= now + 60000 ? received : now;
            const hadDate = Boolean(p.date);
            if (!hadDate) p.date = ex.ist(when);
            if (p.date < s.startDate) { ignored++; continue; }
            newest = Math.max(newest, when);
            parsed.push({ p, sender: m.address, received: when, hadDate });
        }
        parsed.sort((a, b) => key(a.p).localeCompare(key(b.p)));
        const existing = await readTx(s.sheetId);
        const oldNeeded = parsed.some((x) => x.p.date < cut);
        const archived = oldNeeded ? await readTx(s.sheetId, "Archive") : [];
        const known = [...existing, ...archived];
        let accounts = [...(s.knownAccounts || [])];
        const toTx = [], toArchive = [];
        for (const { p, sender, received, hadDate } of parsed) {
            const same = known.find((t) => ex.sameTx(t, { ...p, merchant: p.counterparty }));
            if (same) { duplicates++; continue; }
            const clash = p.ref ? known.find((t) => t.ref && t.ref === p.ref) : null;
            const before = known.filter((t) => t.balance != null && key(t) <= key(p)).sort((a, b) => key(a).localeCompare(key(b))).pop();
            const reasons = ex.assess(p, { sender, receivedAt: received, knownAccounts: accounts, lastBalance: before ? before.balance : null, now });
            if (!hadDate) reasons.unshift("No date in the message (the time it arrived was used)");
            if (clash) reasons.push(`Same reference ${p.ref} as another entry but a different amount (${clash.amount})`);
            if (!accounts.length && !reasons.length && p.account && /^\d{12}$/.test(p.ref || "")) accounts = [p.account];
            else if (accounts.length && !reasons.length && p.account && !accounts.includes(p.account)) reasons.push(`Account ${p.account} is new`);
            const status = reasons.length ? "Flagged" : "Unverified";
            if (reasons.length) flaggedCount++;
            const category = ex.categorize(p.counterparty, p.type, p.method, rules);
            const row = ex.rowFromTx(p, category, "SMS", status, "", received, reasons);
            known.push({ ...ex.txFromRow(row, 0) });
            (p.date < cut ? toArchive : toTx).push(row);
        }
        await sheets.appendRows(s.sheetId, "Transactions", toTx);
        await sheets.appendRows(s.sheetId, "Archive", toArchive);
        await Settings.updateOne({ owner }, { $set: { lastSmsAt: newest, lastSyncAt: new Date(), knownAccounts: accounts } });
        archiveOld(owner, { ...s, lastArchiveDay: s.lastArchiveDay }).catch(() => {});
        return res.json({ added: toTx.length + toArchive.length, flagged: flaggedCount, duplicates, ignored, unparsed, lastSmsAt: newest });
    } catch (e) { return fail(res, e, "Could not save the messages."); }
});

router.get("/expenses", authenticate, async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        const owner = req.rootUser._id, s = await settingsOf(owner);
        need(s);
        if (s.startDate) await archiveOld(owner, s).catch(() => 0);
        const all = await readTx(s.sheetId);
        const months = [...new Set(all.map((t) => t.month).filter(Boolean))].sort().reverse();
        const month = /^\d{4}-\d{2}$/.test(String(req.query.month || "")) ? String(req.query.month) : ex.ist(Date.now()).slice(0, 7);
        const rows = all.filter((t) => t.month === month).sort((a, b) => key(b).localeCompare(key(a)));
        return res.json({
            month, months: months.includes(month) ? months : [month, ...months], rows, flagged: all.filter((t) => t.status === "Flagged").sort((a, b) => key(b).localeCompare(key(a))),
            totals: ex.summarize(rows), uncategorized: rows.filter((t) => t.status !== "Flagged" && t.category === "Uncategorized").length
        });
    } catch (e) { return fail(res, e, "Could not read your sheet."); }
});

router.put("/expenses/category", authenticate, writeLimiter, async (req, res) => {
    try {
        const owner = req.rootUser._id, s = await settingsOf(owner);
        need(s);
        const index = Number(req.body && req.body.index);
        const category = String((req.body && req.body.category) || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 40);
        if (!Number.isInteger(index) || index < 2 || !category) return res.status(400).json({ error: "Pick a row and a category." });
        const all = await readTx(s.sheetId);
        const row = all.find((t) => t.index === index);
        if (!row) return res.status(404).json({ error: "That row is gone. Reload the list." });
        const updates = [{ tab: "Transactions", row: index, col: 5, value: category }];
        if (req.body.remember === true && row.merchant) {
            const k = ex.ruleKey(row.merchant);
            if (k) {
                const rules = userRules(s).filter((r) => ex.norm(r.match) !== k).concat([{ match: k, category }]).slice(-200);
                await Settings.updateOne({ owner }, { $set: { rules } });
                for (const t of all) if (t.index !== index && t.category === "Uncategorized" && ex.norm(t.merchant).includes(k)) updates.push({ tab: "Transactions", row: t.index, col: 5, value: category });
            }
        }
        await sheets.updateCells(s.sheetId, updates);
        return res.json({ updated: updates.length });
    } catch (e) { return fail(res, e, "Could not change the category."); }
});

router.put("/expenses/review", authenticate, writeLimiter, async (req, res) => {
    try {
        const owner = req.rootUser._id, s = await settingsOf(owner);
        need(s);
        const index = Number(req.body && req.body.index), action = req.body && req.body.action;
        if (!Number.isInteger(index) || index < 2 || !["genuine", "delete"].includes(action)) return res.status(400).json({ error: "Pick a row and genuine or delete." });
        const row = (await readTx(s.sheetId)).find((t) => t.index === index);
        if (!row) return res.status(404).json({ error: "That row is gone. Reload the list." });
        if (action === "delete") await sheets.deleteRows(s.sheetId, "Transactions", [index]);
        else await sheets.updateCells(s.sheetId, [{ tab: "Transactions", row: index, col: 11, value: "Confirmed" }, { tab: "Transactions", row: index, col: 12, value: "Confirmed by you" }]);
        return res.json({ ok: true });
    } catch (e) { return fail(res, e, "Could not save that."); }
});

router.get("/expenses/rules", authenticate, async (req, res) => {
    try { const s = await settingsOf(req.rootUser._id); return res.json({ rules: userRules(s), categories: allCategories(s) }); }
    catch (e) { return fail(res, e, "Could not load the rules."); }
});

router.put("/expenses/rules", authenticate, writeLimiter, async (req, res) => {
    try {
        const list = Array.isArray(req.body && req.body.rules) ? req.body.rules : null;
        if (!list || list.length > 200) return res.status(400).json({ error: "Up to 200 rules." });
        const clean = list.map((r) => ({ match: ex.norm(r && r.match).slice(0, 40), category: String((r && r.category) || "").trim().slice(0, 40) })).filter((r) => r.match && r.category);
        await Settings.updateOne({ owner: req.rootUser._id }, { $set: { rules: clean } }, { upsert: true });
        return res.json({ rules: clean });
    } catch (e) { return fail(res, e, "Could not save the rules."); }
});

router.post("/expenses/statement", authenticate, writeLimiter, express.raw({ type: "application/octet-stream", limit: "8mb" }), async (req, res) => {
    try {
        const owner = req.rootUser._id, s = await settingsOf(owner);
        need(s);
        if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Send the statement file." });
        const name = String(req.query.filename || "").toLowerCase();
        let table;
        if (/\.pdf$/.test(name) || req.body.subarray(0, 4).toString() === "%PDF") return res.status(400).json({ error: "Download the statement as Excel or CSV from net banking (a PDF cannot be read reliably)." });
        if (/\.xls$/.test(name)) return res.status(400).json({ error: "Save the statement as .xlsx or .csv and send that." });
        try { table = req.body.subarray(0, 2).toString() === "PK" ? ex.parseXlsx(req.body) : ex.parseCsv(req.body.toString("utf8")); }
        catch (e) { return res.status(400).json({ error: e.message || "Could not read that file." }); }
        let stmt;
        try { stmt = ex.statementRows(table); } catch (e) { return res.status(400).json({ error: e.message }); }
        if (s.startDate) stmt = stmt.filter((x) => x.date >= s.startDate);
        if (!stmt.length) return res.status(400).json({ error: "No transactions found in that statement (after your start date)." });
        const rows = await readTx(s.sheetId);
        const { updates, additions, report } = ex.reconcile(rows, stmt, userRules(s));
        const cells = [];
        for (const u of updates) {
            const cur = rows.find((t) => t.index === u.index);
            if (!cur || cur.status !== u.status) cells.push({ tab: "Transactions", row: u.index, col: 11, value: u.status });
            if ((cur && cur.note) !== u.note && (u.note || (cur && cur.note))) cells.push({ tab: "Transactions", row: u.index, col: 12, value: u.note });
        }
        await sheets.updateCells(s.sheetId, cells);
        const cut = cutoffDate();
        const mk = (t) => ex.rowFromTx(t, t.category, "Statement", "Verified", "Added from your statement (no message was found)", 0, []);
        await sheets.appendRows(s.sheetId, "Transactions", additions.filter((t) => t.date >= cut).map(mk));
        await sheets.appendRows(s.sheetId, "Archive", additions.filter((t) => t.date < cut).map(mk));
        const summary = { at: new Date().toISOString(), from: report.from, to: report.to, lines: report.lines, verified: report.verified, mismatched: report.mismatched, added: report.added, notInStatement: report.notInStatement, balanceBreakCount: report.balanceBreakCount };
        await Settings.updateOne({ owner }, { $set: { lastStatement: summary } });
        return res.json({ report });
    } catch (e) { return fail(res, e, "Could not check the statement."); }
});

module.exports = router;
