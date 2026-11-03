/*
 * Money: UPI and bank messages, categories and statement checks.
 *
 * Where the transactions live is the owner's choice (settings.storage):
 *   "db"    (default) Stashr storage: MongoDB, each transaction ENCRYPTED with the account's data key, deleted by the database 120 days
 *           after its date. A Google Sheet is then an optional COPY (best effort, never blocks a save).
 *   "sheet" only the owner's Google Sheet; MongoDB keeps nothing but settings. Rows older than 120 days (IST) are MOVED to the sheet's
 *           "Archive" tab (never deleted), once a day and right when they arrive (the first backfill).
 * Either way the settings document (models/expenseSettings.js) holds no transaction data. The routes below use a store
 * (utils/expenseStore.js) and do not care which one it is.
 *
 *   GET  /expenses/settings   PUT /expenses/storage {mode}   PUT/DELETE /expenses/sheet   POST /expenses/export-sheet
 *   POST /expenses/start {date} (once)                       POST /expenses/sms {messages:[{address,body,date}]}
 *   GET  /expenses?month=YYYY-MM                             PUT /expenses/category {index,category,remember}
 *   PUT  /expenses/review {index,action}                     GET/PUT /expenses/rules
 *   POST /expenses/statement?filename=… (raw bytes)
 */
const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");
const Settings = require("../models/expenseSettings");
const ex = require("../utils/expenses");
const sheets = require("../utils/sheets");
const stores = require("../utils/expenseStore");
const hub = require("../utils/syncHub");

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 40, message: "Too many changes. Slow down." });
const smsLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: "Too many syncs. Wait a minute." });
const fail = (res, e, fallback) => res.status(Number.isInteger(e.status) ? e.status : 500).json({ error: Number.isInteger(e.status) ? e.message : fallback });
const RETENTION_DAYS = 120;
const cutoffDate = (now = Date.now()) => ex.ist(now - RETENTION_DAYS * 86400000);

async function settingsOf(owner) {
    return (await Settings.findOne({ owner }).lean()) || (await Settings.create({ owner })).toObject();
}
const userRules = (s) => (s.rules || []).filter((r) => r && r.match && r.category);
// The full list for the pickers: the defaults and the owner's own, no repeats, "Uncategorized" always last.
const allCategories = (s) => [...new Set([...ex.DEFAULT_CATEGORIES, ...(s.categories || []), ...userRules(s).map((r) => r.category)])].filter((c) => c !== "Uncategorized").concat(["Uncategorized"]);

/** "db" unless the owner chose the sheet (an older account that already worked from a sheet keeps doing so). */
const modeOf = (s) => (s.storage === "sheet" || (!s.storage && s.sheetId && s.startDate) ? "sheet" : "db");
const RETENTION = { db: "Deleted after 4 months", sheet: "Moved to the Archive tab after 4 months" };

const publicSettings = (s) => {
    const mode = modeOf(s);
    return {
        storage: mode, ready: mode === "db" ? true : sheets.ready(), configured: mode === "db" ? true : Boolean(s.sheetId),
        sheetReady: sheets.ready(), serviceAccountEmail: sheets.serviceEmail(), sheetUrl: s.sheetUrl || "", sheetId: s.sheetId || "", sheetCopy: mode === "db" && Boolean(s.sheetId),
        copyErrors: s.copyErrors || 0, lastCopyError: s.lastCopyError || "", lastCopyAt: s.lastCopyAt || null,
        startDate: s.startDate || "", needsStartDate: (mode === "db" || Boolean(s.sheetId)) && !s.startDate, lastSyncAt: s.lastSyncAt || null, lastSmsAt: s.lastSmsAt || 0,
        retentionMonths: 4, retention: RETENTION[mode], categories: allCategories(s), rules: userRules(s).map((r) => ({ match: r.match, category: r.category })), lastStatement: s.lastStatement || null,
        rescanToken: s.rescanToken || 0, syncRequestedAt: s.syncRequestedAt || 0, syncAckAt: s.syncAckAt || 0, phoneResult: s.phoneResult || null
    };
};

/** The store in use for this request (and the optional sheet-copy mirror in db mode). */
async function storeFor(req, s) {
    const owner = req.rootUser._id;
    if (modeOf(s) === "sheet") {
        if (!s.sheetId) throw Object.assign(new Error("Add your Google Sheet link first."), { status: 400 });
        return { st: stores.sheetStore(s.sheetId, cutoffDate()), copy: null };
    }
    const st = stores.dbStore(owner, await req.rootUser.getDataKey());
    const copy = s.sheetId && sheets.ready() ? stores.mirror(s.sheetId, async (err) => {
        await Settings.updateOne({ owner }, err ? { $inc: { copyErrors: 1 }, $set: { lastCopyError: String(err.message || err).slice(0, 200) } } : { $set: { copyErrors: 0, lastCopyError: "", lastCopyAt: new Date() } });
    }) : null;
    return { st, copy };
}
const key = (t) => `${t.date} ${t.time}`;

/** Sheet mode: moves rows older than the 4-month window to the Archive tab (once a day). */
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

// Sheet only mode: the sheet IS the store. Stashr storage mode: an optional copy that is written alongside.
router.put("/expenses/sheet", authenticate, writeLimiter, async (req, res) => {
    try {
        const owner = req.rootUser._id;
        const id = sheets.parseSheetId(req.body && req.body.sheetUrl);
        if (!id) return res.status(400).json({ error: "Paste the link of your Google Sheet (docs.google.com/spreadsheets/d/…)." });
        await sheets.ensureLayout(id);
        const cur = await settingsOf(owner);
        const changed = cur.sheetId && cur.sheetId !== id;
        await Settings.updateOne({ owner }, { $set: { sheetId: id, sheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`, copyErrors: 0, lastCopyError: "", ...(changed && modeOf(cur) === "sheet" ? { lastSmsAt: 0, lastArchiveDay: "", knownAccounts: [] } : {}) } });
        return res.json(publicSettings(await settingsOf(owner)));
    } catch (e) { return fail(res, e, "Could not set up the sheet."); }
});

router.delete("/expenses/sheet", authenticate, writeLimiter, async (req, res) => {
    try {
        const owner = req.rootUser._id, s = await settingsOf(owner);
        if (modeOf(s) === "sheet") return res.status(400).json({ error: "Your sheet is where the entries are kept. Switch to Stashr storage first." });
        await Settings.updateOne({ owner }, { $set: { sheetId: "", sheetUrl: "", copyErrors: 0, lastCopyError: "" } });
        return res.json(publicSettings(await settingsOf(owner)));
    } catch (e) { return fail(res, e, "Could not unlink the sheet."); }
});

// Switching never moves anything by itself: each store keeps what it has. The message says so.
router.put("/expenses/storage", authenticate, writeLimiter, async (req, res) => {
    try {
        const owner = req.rootUser._id, s = await settingsOf(owner);
        const mode = req.body && req.body.mode;
        if (!["db", "sheet"].includes(mode)) return res.status(400).json({ error: "Pick Stashr storage or your Google Sheet." });
        if (mode === "sheet" && !s.sheetId) return res.status(400).json({ error: "Add your Google Sheet link first." });
        if (mode === "sheet" && !sheets.ready()) return res.status(503).json({ error: "Google Sheets is not set up on this server (GOOGLE_SHEETS_SA_JSON)" });
        if (mode === modeOf(s)) return res.json({ ...publicSettings(s), message: "Already using it." });
        await Settings.updateOne({ owner }, { $set: { storage: mode } });
        return res.json({ ...publicSettings(await settingsOf(owner)), message: mode === "sheet"
            ? "New entries now go only to your sheet. Entries already in Stashr stay there until they are 4 months old and are no longer shown here."
            : "New entries are now kept in Stashr (encrypted). What is already in your sheet stays there and is no longer shown here." });
    } catch (e) { return fail(res, e, "Could not switch."); }
});

// Writes the entries Stashr holds (the active 4 months) into the sheet, replacing the Transactions tab's rows.
router.post("/expenses/export-sheet", authenticate, writeLimiter, async (req, res) => {
    try {
        const owner = req.rootUser._id, s = await settingsOf(owner);
        if (modeOf(s) === "sheet") return res.status(400).json({ error: "Your sheet is already where the entries are kept." });
        if (!s.sheetId) return res.status(400).json({ error: "Add your Google Sheet link first." });
        const { st } = await storeFor(req, s);
        const exported = await stores.exportToSheet(s.sheetId, await st.list());
        await Settings.updateOne({ owner }, { $set: { copyErrors: 0, lastCopyError: "", lastCopyAt: new Date() } });
        return res.json({ exported });
    } catch (e) {
        if (e && e.status) await Settings.updateOne({ owner: req.rootUser._id }, { $inc: { copyErrors: 1 }, $set: { lastCopyError: String(e.message).slice(0, 200) } }).catch(() => {});
        return fail(res, e, "Could not write to the sheet.");
    }
});

// The one-time choice of how far back to read the messages. Once set it cannot be changed or asked again.
router.post("/expenses/start", authenticate, writeLimiter, async (req, res) => {
    try {
        const owner = req.rootUser._id, s = await settingsOf(owner);
        await storeFor(req, s);                        // sheet mode needs its sheet first
        if (s.startDate) return res.status(400).json({ error: "The start date is already set." });
        const d = ex.parseDate(req.body && req.body.date);
        if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(String(req.body.date).slice(0, 10)) || d > ex.ist(Date.now()) || d < "2015-01-01") return res.status(400).json({ error: "Pick a date in the past (or today)." });
        const r = await Settings.updateOne({ owner, startDate: "" }, { $set: { startDate: d } });
        if (!r.modifiedCount) return res.status(400).json({ error: "The start date is already set." });
        return res.json({ startDate: d, retention: modeOf(s) === "db" ? `Entries are deleted ${RETENTION_DAYS} days after their date (4 months); older messages are not kept.` : `Entries older than ${RETENTION_DAYS} days go to the Archive tab of your sheet.` });
    } catch (e) { return fail(res, e, "Could not save the start date."); }
});

// Change the start date later (the website only). Earlier: the phone reads the older messages again, once. Later: entries already
// saved stay; only messages from the new date on are read from now.
router.put("/expenses/start", authenticate, writeLimiter, async (req, res) => {
    try {
        const owner = req.rootUser._id, s = await settingsOf(owner);
        if (!s.startDate) return res.status(400).json({ error: "Choose the start date first." });
        const d = ex.parseDate(req.body && req.body.date);
        if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(String(req.body.date).slice(0, 10)) || d > ex.ist(Date.now()) || d < "2015-01-01") return res.status(400).json({ error: "Pick a date in the past (or today)." });
        if (d === s.startDate) return res.json({ startDate: d, rescan: false, message: "That is already the start date." });
        const earlier = d < s.startDate;
        const set = { startDate: d };
        if (earlier) { set.lastSmsAt = 0; set.rescanToken = Date.now(); }       // forget how far the phone had read
        await Settings.updateOne({ owner }, { $set: set });
        return res.json({ startDate: d, rescan: earlier, message: earlier ? "Done. Your phone will read the older messages the next time it syncs." : "Done. Messages before that date are no longer read; entries already saved stay." });
    } catch (e) { return fail(res, e, "Could not change the start date."); }
});

// The website's Refresh: ask the phone to look for new bank SMS now. If the Stashr app is open on the phone it hears this at once
// (the live stream); otherwise it does it the next time its background check runs or the app is opened.
router.post("/expenses/sync-request", authenticate, writeLimiter, async (req, res) => {
    try {
        const owner = req.rootUser._id, now = Date.now(), s = await settingsOf(owner);
        let at = Number(s.syncRequestedAt) || 0;
        if (now - at > 5000) { at = now; await Settings.updateOne({ owner }, { $set: { syncRequestedAt: at } }); }
        const phoneOnline = hub.notify(owner, "money-sync", "web") > 0;
        return res.json({ requestedAt: at, phoneOnline, syncAckAt: Number(s.syncAckAt) || 0 });
    } catch (e) { return fail(res, e, "Could not ask the phone."); }
});

// The phone says it looked (with what it found, or why it could not).
router.post("/expenses/sync-done", authenticate, writeLimiter, async (req, res) => {
    try {
        const r = (req.body && typeof req.body.result === "object" && req.body.result) || {};
        const n = (v) => Math.max(0, Math.min(100000, Math.round(Number(v) || 0)));
        const now = Date.now();
        const phoneResult = { at: now, added: n(r.added), flagged: n(r.flagged), duplicates: n(r.duplicates), skipped: String(r.skipped || "").slice(0, 120), error: String(r.error || "").slice(0, 160) };
        await Settings.updateOne({ owner: req.rootUser._id }, { $set: { syncAckAt: now, phoneResult } });
        return res.json({ ok: true });
    } catch (e) { return fail(res, e, "Could not save the sync result."); }
});

router.post("/expenses/sms", authenticate, smsLimiter, async (req, res) => {
    try {
        const owner = req.rootUser._id, s = await settingsOf(owner);
        const { st, copy } = await storeFor(req, s);
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
            if (!st.keepsOld && p.date < cut) { ignored++; continue; }     // Stashr storage keeps 4 months only
            parsed.push({ p, sender: m.address, received: when, hadDate });
        }
        parsed.sort((a, b) => key(a.p).localeCompare(key(b.p)));
        const existing = await st.list();
        const oldNeeded = st.keepsOld && parsed.some((x) => x.p.date < cut);
        const archived = oldNeeded ? await st.listArchive() : [];
        const known = [...existing, ...archived];
        let accounts = [...(s.knownAccounts || [])];
        const fresh = [];
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
            const tx = ex.makeTx(p, ex.categorize(p.counterparty, p.type, p.method, rules), "SMS", status, "", received, reasons);
            known.push(tx);
            fresh.push(tx);
        }
        const saved = await st.append(fresh);
        duplicates += saved.duplicates;
        if (copy) copy.append(saved.stored);
        // Messages from a second phone fill gaps in the balance chain: clear the flags that were only about those gaps.
        let cleared = 0;
        if (saved.added > 0 && existing.some((t) => t.status === "Flagged")) {
            try {
                const items = ex.reclearBalanceFlags([...existing, ...saved.stored]).filter((i) => existing.some((t) => String(t.index) === String(i.index)));
                if (items.length) { await st.updateMany(items); if (copy) copy.update(items); cleared = items.length; }
            } catch (e) { /* the entries stay flagged; the bank statement check still clears them */ }
        }
        await Settings.updateOne({ owner }, { $set: { lastSmsAt: newest, lastSyncAt: new Date(), knownAccounts: accounts } });
        if (st.mode === "sheet") archiveOld(owner, { ...s, lastArchiveDay: s.lastArchiveDay }).catch(() => {});
        return res.json({ added: saved.added, flagged: flaggedCount, cleared, duplicates, ignored, unparsed, lastSmsAt: newest });
    } catch (e) { return fail(res, e, "Could not save the messages."); }
});

router.get("/expenses", authenticate, async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        const owner = req.rootUser._id, s = await settingsOf(owner);
        const { st } = await storeFor(req, s);
        if (st.mode === "sheet" && s.startDate) await archiveOld(owner, s).catch(() => 0);
        const all = await st.list();
        const months = [...new Set(all.map((t) => t.month).filter(Boolean))].sort().reverse();
        const month = /^\d{4}-\d{2}$/.test(String(req.query.month || "")) ? String(req.query.month) : ex.ist(Date.now()).slice(0, 7);
        const rows = all.filter((t) => t.month === month).sort((a, b) => key(b).localeCompare(key(a)));
        return res.json({
            month, months: months.includes(month) ? months : [month, ...months], rows, flagged: all.filter((t) => ex.DOUBTFUL.includes(t.status)).sort((a, b) => key(b).localeCompare(key(a))),
            totals: ex.summarize(rows), uncategorized: rows.filter((t) => !ex.DOUBTFUL.includes(t.status) && t.category === "Uncategorized").length
        });
    } catch (e) { return fail(res, e, "Could not read your transactions."); }
});

router.put("/expenses/category", authenticate, writeLimiter, async (req, res) => {
    try {
        const owner = req.rootUser._id, s = await settingsOf(owner);
        const { st, copy } = await storeFor(req, s);
        const index = req.body && req.body.index;
        const category = String((req.body && req.body.category) || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 40);
        if (!st.isIndex(index) || !category) return res.status(400).json({ error: "Pick a row and a category." });
        const all = await st.list();
        const row = all.find((t) => String(t.index) === String(index));
        if (!row) return res.status(404).json({ error: "That row is gone. Reload the list." });
        const items = [{ index: row.index, fields: { category }, tx: row }];
        if (req.body.remember === true && row.merchant) {
            const k = ex.ruleKey(row.merchant);
            if (k) {
                const rules = userRules(s).filter((r) => ex.norm(r.match) !== k).concat([{ match: k, category }]).slice(-200);
                await Settings.updateOne({ owner }, { $set: { rules } });
                for (const t of all) if (String(t.index) !== String(index) && t.category === "Uncategorized" && ex.norm(t.merchant).includes(k)) items.push({ index: t.index, fields: { category }, tx: t });
            }
        }
        await st.updateMany(items);
        if (copy) copy.update(items);
        return res.json({ updated: items.length });
    } catch (e) { return fail(res, e, "Could not change the category."); }
});

router.put("/expenses/review", authenticate, writeLimiter, async (req, res) => {
    try {
        const owner = req.rootUser._id, s = await settingsOf(owner);
        const { st, copy } = await storeFor(req, s);
        const index = req.body && req.body.index, action = req.body && req.body.action;
        if (!st.isIndex(index) || !["genuine", "delete"].includes(action)) return res.status(400).json({ error: "Pick a row and genuine or delete." });
        const row = (await st.list()).find((t) => String(t.index) === String(index));
        if (!row) return res.status(404).json({ error: "That row is gone. Reload the list." });
        if (action === "delete") { await st.remove(row.index); if (copy) copy.remove(row); }
        else {
            const items = [{ index: row.index, fields: { status: "Confirmed", note: "Confirmed by you" }, tx: row }];
            await st.updateMany(items);
            if (copy) copy.update(items);
        }
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

// After a statement: remove, in one go, every entry the statement did not have (the owner decided the statement is right).
router.post("/expenses/remove-unmatched", authenticate, writeLimiter, async (req, res) => {
    try {
        const owner = req.rootUser._id, s = await settingsOf(owner);
        const { st, copy } = await storeFor(req, s);
        const rows = (await st.list()).filter((t) => t.status === "Not in statement");
        const removed = rows.length ? await st.removeMany(rows.map((t) => t.index)) : 0;
        if (copy && rows.length) copy.removeMany(rows);
        return res.json({ removed });
    } catch (e) { return fail(res, e, "Could not remove them."); }
});

router.post("/expenses/statement", authenticate, writeLimiter, express.raw({ type: "application/octet-stream", limit: "8mb" }), async (req, res) => {
    try {
        const owner = req.rootUser._id, s = await settingsOf(owner);
        const { st, copy } = await storeFor(req, s);
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
        const cut = cutoffDate();
        if (!st.keepsOld) stmt = stmt.filter((x) => x.date >= cut);           // Stashr storage keeps 4 months only
        if (!stmt.length) return res.status(400).json({ error: "No transactions found in that statement (after your start date" + (st.keepsOld ? "" : " and within the last 4 months") + ")." });
        const rows = await st.list();
        const { updates, additions, report } = ex.reconcile(rows, stmt, userRules(s));
        const items = [];
        for (const u of updates) {
            // the statement is the truth: whatever it says (date, amount, name, balance, status...) is written, but only where it differs
            const cur = rows.find((t) => String(t.index) === String(u.index));
            const fields = {};
            for (const [k, v] of Object.entries(u.fields || { status: u.status, note: u.note })) {
                if (JSON.stringify(cur ? cur[k] : undefined) !== JSON.stringify(v)) fields[k] = v;
            }
            if (Object.keys(fields).length) items.push({ index: u.index, fields, tx: cur });
        }
        await st.updateMany(items);
        if (copy) copy.update(items.filter((i) => i.tx));
        const txs = additions.map((t) => ex.makeTx(t, t.category, "Statement", "Verified", "Added from your statement (no message was found)", 0, []));
        const saved = await st.append(txs);
        if (copy) copy.append(saved.stored);
        const summary = { at: new Date().toISOString(), from: report.from, to: report.to, lines: report.lines, verified: report.verified, mismatched: report.mismatched, added: report.added, renamed: report.renamed, notInStatement: report.notInStatement, months: report.months, allMonthsMatch: report.allMonthsMatch, closingBalance: report.closingBalance, balanceBreakCount: report.balanceBreakCount };
        await Settings.updateOne({ owner }, { $set: { lastStatement: summary } });
        return res.json({ report });
    } catch (e) { return fail(res, e, "Could not check the statement."); }
});

router.idle = stores.idle;
module.exports = router;
