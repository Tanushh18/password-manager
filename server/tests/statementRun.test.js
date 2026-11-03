// Uploading a statement answers at once and the check runs in the background: the job register, and the whole check against an in-memory store.
// No database needed: node --test tests/statementRun.test.js
const { describe, test } = require("node:test");
const expect = require("./expect");
const ex = require("../utils/expenses");
const jobs = require("../utils/statementJobs");
const { processStatement } = require("../utils/statementRun");

/* an in-memory store with the same small interface as the real ones */
function fakeStore(initial, { keepsOld = false } = {}) {
    const rows = initial.map((r, i) => ({ index: String(i + 1), ...r }));
    const log = { updateBatches: [], appended: 0 };
    return {
        mode: "fake", keepsOld, rows, log,
        async list() { return rows.map((r) => ({ ...r })); },
        async updateMany(items) { log.updateBatches.push(items.length); for (const it of items) Object.assign(rows.find((r) => r.index === String(it.index)), it.fields); return items.length; },
        async append(txs) { txs.forEach((t, i) => rows.push({ ...t, index: String(rows.length + 1 + i) })); log.appended += txs.length; return { added: txs.length, duplicates: 0, stored: txs }; }
    };
}
const entry = (o) => ({ time: "", type: "Debit", merchant: "", category: "Uncategorized", account: "X9229", method: "UPI", ref: "", balance: null, source: "SMS", status: "Flagged", note: "", received: "", flags: ["x"], ...o, month: o.date.slice(0, 7) });
const csvOf = (lines) => Buffer.from(["Date,Particulars,Withdrawals,Deposits,Balance", ...lines].join("\n"));

describe("the job register", () => {
    test("a job goes queued -> running -> done, the bar only moves forward, and only its owner can see it", () => {
        jobs._reset();
        const j = jobs.create("owner1", { filename: "s.csv" });
        expect(jobs.view(j).status).toBe("queued");
        expect(jobs.running("owner1").id).toBe(j.id);
        jobs.progress(j.id, { stage: "matching", text: "Matching…", pct: 30 });
        jobs.progress(j.id, { stage: "saving", text: "Saving…", pct: 20 });                // an older number never pulls the bar back
        expect(jobs.get("owner1", j.id).pct).toBe(30);
        jobs.progress(j.id, { pct: 150 });
        expect(jobs.get("owner1", j.id).pct).toBe(99);                                    // 100 is only for a finished job
        expect(jobs.get("somebody-else", j.id)).toBeNull();
        jobs.finish(j.id, { lines: 3 });
        expect(jobs.view(jobs.get("owner1")).status).toBe("done");
        expect(jobs.view(jobs.get("owner1")).pct).toBe(100);
        expect(jobs.running("owner1")).toBeNull();
        expect(Object.keys(jobs.view(j)).includes("owner")).toBe(false);
    });
    test("a failed job keeps its message; a stuck job is given up on; old finished jobs are forgotten", () => {
        jobs._reset();
        const f = jobs.create("o", {});
        jobs.fail(f.id, "Could not find the table");
        expect(jobs.get("o", f.id).error).toBe("Could not find the table");
        jobs._reset();
        const t0 = 1_000_000;
        const stuck = jobs.create("o", {}, t0);
        expect(jobs.running("o", t0 + 11 * 60 * 1000)).toBeNull();
        expect(jobs.get("o", stuck.id, t0 + 11 * 60 * 1000).status).toBe("failed");
        jobs._reset();
        const done = jobs.create("o", {}, t0);
        jobs.finish(done.id, {}, t0);
        expect(jobs.get("o", done.id, t0 + 2 * 60 * 60 * 1000)).toBeNull();
    });
});

describe("the check against a store", () => {
    const csv = csvOf(["01-10-2026,UPI/DR/100000000001/MEESHO TECHNOLOGIES PRIVATE LIMITED/ICIC/m@ybl,100.00,,9900.00", "02-10-2026,UPI/CR/100000000002/RAHUL K/x@ybl,,1500.00,11400.00", "03-10-2026,ATM WDL 1,500.00,,10900.00"]);

    test("it reports its progress in order, ends at the last stage, and the store ends up agreeing with the statement", async () => {
        const store = fakeStore([entry({ date: "2026-10-01", amount: 100, merchant: "Meesho Techn", ref: "" }), entry({ date: "2026-10-02", amount: 1400, type: "Credit", merchant: "unknown", ref: "100000000002" }),
            entry({ date: "2026-10-02", amount: 55, merchant: "Fake", ref: "555555555555" })]);
        const seen = []; let summary = null;
        const { report } = await processStatement({ s: { startDate: "2026-08-03" }, st: store, bytes: csv, rules: [], cutoff: "2026-07-06", progress: (p) => seen.push(p), saveSummary: async (x) => { summary = x; } });
        expect(seen.map((p) => p.stage)).toEqual(["reading", "matching", "saving", "adding", "finishing"]);
        const pcts = seen.map((p) => p.pct);
        expect(pcts).toEqual([...pcts].sort((a, b) => a - b));                          // never backwards
        expect(report.allMonthsMatch).toBe(true);
        expect(report.lines).toBe(3); expect(report.added).toBe(1); expect(report.notInStatement).toBe(1);
        expect(store.rows[0]).toMatchObject({ status: "Verified", merchant: "Meesho Technologies Private Limited", balance: 9900, ref: "100000000001" });
        expect(store.rows[1]).toMatchObject({ status: "Verified", amount: 1500, merchant: "Rahul K" });
        expect(store.rows[2].status).toBe("Not in statement");
        expect(store.log.appended).toBe(1);
        expect(summary.verified + summary.mismatched).toBe(2);
    });

    test("corrections are saved in small batches so the bar can move", async () => {
        const many = [], lines = [];
        for (let i = 0; i < 60; i++) {
            const ref = String(200000000000 + i);
            many.push(entry({ date: "2026-10-05", amount: 10 + i, merchant: "unknown", ref }));
            lines.push(`05-10-2026,UPI/DR/${ref}/SHOP ${i}/ICIC/s@ybl,${10 + i}.00,,${9000 - i}.00`);
        }
        const store = fakeStore(many);
        await processStatement({ s: {}, st: store, bytes: csvOf(lines), rules: [], cutoff: "2026-07-06", progress: () => {} });
        expect(store.log.updateBatches).toEqual([25, 25, 10]);
        expect(store.rows.every((r) => r.status === "Verified")).toBe(true);
    });

    test("a file that is not a statement fails with a plain 400 message and changes nothing", async () => {
        const store = fakeStore([entry({ date: "2026-10-01", amount: 100, merchant: "X" })]);
        let error = null;
        try { await processStatement({ s: {}, st: store, bytes: Buffer.from("hello,world\n1,2"), rules: [], cutoff: "" }); } catch (e) { error = e; }
        expect(error.status).toBe(400);
        expect(error.message).toMatch(/Could not find the table/);
        expect(store.rows[0].status).toBe("Flagged");
    });

    test("lines older than the start date are not taken, and the result says how many were left out", async () => {
        const store = fakeStore([]);
        const old = csvOf(["01-06-2026,UPI/DR/300000000001/OLD SHOP/ICIC/o@ybl,10.00,,990.00", "05-10-2026,UPI/DR/300000000002/NEW SHOP/ICIC/n@ybl,20.00,,970.00"]);
        const { report } = await processStatement({ s: { startDate: "2026-08-03" }, st: store, bytes: old, rules: [], cutoff: "2026-07-06", progress: () => {} });
        expect(report.lines).toBe(1);
        expect(report.skipped).toMatchObject({ beforeStart: 1, tooOld: 0, startDate: "2026-08-03" });
        expect(store.rows.length).toBe(1);
        expect(store.rows[0].merchant).toBe("New Shop");
    });

    test("uploading the same statement twice changes nothing the second time", async () => {
        const store = fakeStore([entry({ date: "2026-10-01", amount: 100, merchant: "Meesho Techn" })]);
        await processStatement({ s: {}, st: store, bytes: csv, rules: [], cutoff: "" });
        const before = JSON.stringify(store.rows);
        const second = await processStatement({ s: {}, st: store, bytes: csv, rules: [], cutoff: "" });
        expect(second.report.added).toBe(0); expect(second.report.notInStatement).toBe(0);
        expect(JSON.stringify(store.rows)).toBe(before);
    });
});
