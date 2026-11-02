/*
 * Where Money transactions are kept. Two stores with the same small interface, so the routes do not care which one is in use:
 *   dbStore    "Stashr storage" (default): MongoDB, every transaction encrypted with the account's data key, deleted by the database
 *              120 days after its date (the 4-month rule).
 *   sheetStore "Google Sheet only": the owner's sheet is the only place; rows older than 120 days are moved to its Archive tab.
 * A transaction is a plain object (utils/expenses.js makeTx): { index, date, time, amount, type, merchant, category, account, method,
 * ref, balance, source, status, note, month, received, flags }. `index` is opaque to clients: a document id (db) or a sheet row (sheet).
 *
 * The mirror writes the optional Google Sheet COPY in db mode; it is best effort and never fails or delays the real write.
 */
const crypto = require("crypto");
const mongoose = require("mongoose");
const ExpenseTx = require("../models/expenseTx");
const { sealJSONWithKey, unsealJSONWithKey } = require("../models/EncDecManager");
const ex = require("./expenses");
const sheets = require("./sheets");

const DAY = 86400000;
const RETENTION_DAYS = 120;
const COL = { category: 5, status: 11, note: 12 };

/* ───────── Stashr storage (MongoDB, encrypted) ───────── */

const SECRET = ["time", "amount", "type", "merchant", "category", "account", "method", "ref", "balance", "source", "note", "received", "flags"];
const expireAtOf = (date) => new Date(Date.parse(`${date}T00:00:00+05:30`) + RETENTION_DAYS * DAY);
const hashKey = (t) => (t.ref ? `ref:${t.ref}|${t.amount}` : `k:${t.date}|${t.time}|${t.amount}|${ex.norm(t.merchant)}`);

function dbStore(owner, dataKey) {
    const hash = (t) => crypto.createHmac("sha256", dataKey).update(hashKey(t)).digest("hex");
    const open = (doc) => {
        let secret = {};
        try { secret = unsealJSONWithKey(dataKey, doc.enc); } catch (e) { secret = { merchant: "(could not be decrypted)", amount: 0, type: "", flags: [] }; }
        return { index: String(doc._id), date: doc.date, month: doc.month, status: doc.status, time: "", amount: 0, type: "", merchant: "", category: "Uncategorized", account: "", method: "", ref: "", balance: null, source: "", note: "", received: "", flags: [], ...secret };
    };
    const seal = (t) => sealJSONWithKey(dataKey, Object.fromEntries(SECRET.map((k) => [k, t[k]])));
    const idOf = (index) => (mongoose.isValidObjectId(String(index)) ? String(index) : null);
    return {
        mode: "db", keepsOld: false,
        isIndex: (v) => Boolean(idOf(v)),
        async list() { return (await ExpenseTx.find({ owner }).lean()).map(open); },
        async listArchive() { return []; },
        /** -> { added, duplicates, stored: [tx with index] } */
        async append(txs) {
            let added = 0, duplicates = 0;
            const stored = [];
            for (const t of txs) {
                if (!t.date) continue;
                try {
                    const doc = await ExpenseTx.create({ owner, month: t.date.slice(0, 7), date: t.date, status: t.status, refHash: hash(t), enc: seal(t), expireAt: expireAtOf(t.date) });
                    added++; stored.push({ ...t, index: String(doc._id) });
                } catch (e) { if (e && e.code === 11000) duplicates++; else throw e; }
            }
            return { added, duplicates, stored };
        },
        /** items: [{ index, fields: { category?, status?, note? } }] */
        async updateMany(items) {
            let n = 0;
            for (const it of items) {
                const id = idOf(it.index);
                const doc = id && await ExpenseTx.findOne({ _id: id, owner });
                if (!doc) continue;
                const next = { ...open(doc), ...it.fields };
                doc.status = next.status; doc.enc = seal(next);
                await doc.save(); n++;
            }
            return n;
        },
        async remove(index) { const id = idOf(index); if (id) await ExpenseTx.deleteOne({ _id: id, owner }); },
        async archiveOld() { return 0; }
    };
}

/* ───────── the owner's Google Sheet ───────── */

function sheetStore(sheetId, cutoff) {
    return {
        mode: "sheet", keepsOld: true,
        isIndex: (v) => Number.isInteger(Number(v)) && Number(v) >= 2,
        async list() { return (await sheets.readRows(sheetId, "Transactions")).map((r, i) => ex.txFromRow(r, i + 2)); },
        async listArchive() { return (await sheets.readRows(sheetId, "Archive")).map((r, i) => ex.txFromRow(r, i + 2)); },
        async append(txs) {
            const recent = txs.filter((t) => t.date >= cutoff), old = txs.filter((t) => t.date < cutoff);
            await sheets.appendRows(sheetId, "Transactions", recent.map(ex.txToRow));
            await sheets.appendRows(sheetId, "Archive", old.map(ex.txToRow));
            return { added: txs.length, duplicates: 0, stored: txs };
        },
        async updateMany(items) {
            const cells = [];
            for (const it of items) for (const [k, v] of Object.entries(it.fields)) if (COL[k] !== undefined) cells.push({ tab: "Transactions", row: Number(it.index), col: COL[k], value: v });
            await sheets.updateCells(sheetId, cells);
            return items.length;
        },
        async remove(index) { await sheets.deleteRows(sheetId, "Transactions", [Number(index)]); },
        async archiveOld() { return 0; }          // done by the route (it keeps the "once a day" mark)
    };
}

/* ───────── the optional Google Sheet copy in Stashr storage mode ───────── */

const pending = new Set();
/** Resolves when every background copy write has finished (used by tests and by shutdown). */
const idle = () => Promise.allSettled([...pending]);

/**
 * sheetId: the linked sheet; report(error|null): called after each copy attempt. Every method returns at once; the write happens in the
 * background and a failure is only reported, never thrown.
 */
function mirror(sheetId, report) {
    const run = (fn) => {
        const p = (async () => { try { await fn(); await report(null); } catch (e) { await report(e).catch(() => {}); } })();
        pending.add(p);
        p.finally(() => pending.delete(p));
    };
    const rowOf = async (ref) => {
        if (!ref) return 0;
        const rows = await sheets.readRows(sheetId, "Transactions");
        const i = rows.findIndex((r) => String(r[8]) === String(ref));
        return i < 0 ? 0 : i + 2;
    };
    const cutoff = ex.ist(Date.now() - RETENTION_DAYS * DAY);
    return {
        append(txs) { const recent = txs.filter((t) => t.date >= cutoff); if (recent.length) run(() => sheets.appendRows(sheetId, "Transactions", recent.map(ex.txToRow))); },
        /** items: [{ tx (the entry as it was, with ref), fields }] */
        update(items) {
            if (!items.length) return;
            run(async () => {
                const cells = [];
                for (const it of items) { const row = await rowOf(it.tx.ref); if (row) for (const [k, v] of Object.entries(it.fields)) if (COL[k] !== undefined) cells.push({ tab: "Transactions", row, col: COL[k], value: v }); }
                await sheets.updateCells(sheetId, cells);
            });
        },
        remove(tx) { run(async () => { const row = await rowOf(tx.ref); if (row) await sheets.deleteRows(sheetId, "Transactions", [row]); }); }
    };
}

/** Writes the given transactions (the active 4 months) to the sheet's Transactions tab, replacing what is there. */
async function exportToSheet(sheetId, txs) {
    await sheets.ensureLayout(sheetId);
    await sheets.clearTab(sheetId, "Transactions");
    const sorted = [...txs].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    await sheets.appendRows(sheetId, "Transactions", sorted.map(ex.txToRow));
    return sorted.length;
}

module.exports = { dbStore, sheetStore, mirror, exportToSheet, idle, RETENTION_DAYS };
