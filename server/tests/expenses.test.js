const { describe, test, before: beforeAll, after: afterAll, beforeEach } = require("node:test");
const expect = require("./expect");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const request = require("supertest");
const crypto = require("crypto");
const zlib = require("zlib");

process.env.SECRET_KEY = "test-secret";
process.env.CRYPTO_SECRET_KEY = "test-crypto-secret";
process.env.RATE_LIMIT_MAX = "1000";
process.env.ALLOW_SIGNUP = "true";
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.GOOGLE_SHEETS_SA_JSON = Buffer.from(JSON.stringify({ client_email: "stashr@money-test.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) })).toString("base64");

const app = require("../app");
const User = require("../models/schema");
const ExpenseSettings = require("../models/expenseSettings");
const ex = require("../utils/expenses");
const sheets = require("../utils/sheets");

const SAMPLE = "Debited Rs 100.00 from a/c X9229 on 21Oct26 19:42 via UPI to Meta Verifie. Ref 629482059838.Bal Rs 2507.75. Not you?Call 18004251199 -Federal Bank";
const CREDIT = "Credited Rs 1,500.00 to a/c X9229 on 22Oct26 10:11 via UPI from RAHUL K. Ref 123456789012.Bal Rs 4007.75 -Federal Bank";

/* ───────── pure rules ───────── */

describe("parsing and categories", () => {
    test("the Federal Bank debit and credit messages", () => {
        expect(ex.parseSms(SAMPLE)).toEqual({ date: "2026-10-21", time: "19:42", amount: 100, type: "Debit", counterparty: "Meta Verifie", account: "X9229", method: "UPI", ref: "629482059838", balance: 2507.75 });
        const c = ex.parseSms(CREDIT);
        expect(c.type).toBe("Credit"); expect(c.amount).toBe(1500); expect(c.counterparty).toBe("RAHUL K"); expect(c.balance).toBe(4007.75);
        expect(ex.parseSms("Your OTP is 482911. Do not share. -Federal Bank")).toBeNull();
        expect(ex.parseSms("Get 5% cashback on your next spend!")).toBeNull();
        expect(ex.parseSms("")).toBeNull();
    });
    test("categories: defaults, unknown people, and the owner's rule wins", () => {
        expect(ex.categorize("Meta Verifie", "Debit", "UPI")).toBe("Meta Ads");
        expect(ex.categorize("SWIGGY", "Debit", "UPI")).toBe("Food");
        expect(ex.categorize("Rahul Kumar", "Debit", "UPI")).toBe("Uncategorized");
        expect(ex.categorize("Swiggy Instamart", "Debit", "UPI", [{ match: "swiggy instamart", category: "Groceries" }])).toBe("Groceries");
        expect(ex.categorize("", "Debit", "ATM")).toBe("Cash");
    });
    test("dates", () => {
        expect(ex.parseDate("21Oct26")).toBe("2026-10-21");
        expect(ex.parseDate("21-10-2026")).toBe("2026-10-21");
        expect(ex.parseDate("21 Oct 2026")).toBe("2026-10-21");
        expect(ex.parseDate("2026-10-21")).toBe("2026-10-21");
        expect(ex.parseDate("nonsense")).toBeNull();
    });
    test("each reason a message is doubted", () => {
        const base = ex.parseSms(SAMPLE), now = Date.parse("2026-10-22T04:00:00Z"), ok = { sender: "VM-FEDBNK-S", receivedAt: Date.parse("2026-10-21T14:12:00Z"), knownAccounts: ["X9229"], lastBalance: 2607.75, now };
        expect(ex.assess(base, ok)).toEqual([]);
        expect(ex.assess(base, { ...ok, sender: "+919876543210" }).length).toBe(1);
        expect(ex.assess({ ...base, date: null }, ok).join()).toMatch(/No date/);
        expect(ex.assess({ ...base, ref: "12345" }, ok).join()).toMatch(/12-digit/);
        expect(ex.assess({ ...base, account: "X1111" }, ok).join()).toMatch(/not one of your accounts/);
        expect(ex.assess({ ...base, date: "2026-12-01" }, ok).join()).toMatch(/future/);
        expect(ex.assess(base, { ...ok, receivedAt: Date.parse("2026-10-10T00:00:00Z") }).join()).toMatch(/days away/);
        expect(ex.assess({ ...base, amount: 150000 }, { ...ok, lastBalance: 152607.75 }).join()).toMatch(/1 lakh/);
        expect(ex.assess(base, { ...ok, lastBalance: 5000 }).join()).toMatch(/does not follow/);
        expect(ex.bankSender("AX-FEDRAL")).toBe(true);
        expect(ex.bankSender("9876543210")).toBe(false);
    });
});

describe("statements", () => {
    const stmtCsv = [
        "Account statement,,,,,", "Date,Value Date,Particulars,Tran ID,Withdrawals,Deposits,Balance",
        "21-10-2026,21-10-2026,UPI/DR/629482059838/META VERIFIE/fb@ybl,S1,100.00,,2507.75",
        "22-10-2026,22-10-2026,UPI/CR/123456789012/RAHUL K/x@ybl,S2,,1500.00,4007.75",
        "23-10-2026,23-10-2026,UPI/DR/555555555555/SWIGGY/s@ybl,S3,250.00,,3757.75",
        "24-10-2026,24-10-2026,ATM WDL,S4,500.00,,9999.00"
    ].join("\n");
    const rowsOf = (list) => list.map((r, i) => ex.txFromRow(ex.rowFromTx({ date: r.date, time: "", amount: r.amount, type: r.type, counterparty: r.m, account: "X9229", method: "UPI", ref: r.ref, balance: r.bal }, "Other", "SMS", r.status || "Unverified", "", 0, []), i + 2));

    test("CSV and Excel statements are read the same way", () => {
        const a = ex.statementRows(ex.parseCsv(stmtCsv));
        expect(a.length).toBe(4);
        expect(a[0]).toEqual({ date: "2026-10-21", desc: "UPI/DR/629482059838/META VERIFIE/fb@ybl", amount: 100, type: "Debit", balance: 2507.75, ref: "629482059838" });
        expect(a[1].type).toBe("Credit");
        const xlsx = makeXlsx(ex.parseCsv(stmtCsv));
        expect(ex.statementRows(ex.parseXlsx(xlsx))).toEqual(a);
        expect(() => ex.statementRows([["nothing", "here"]])).toThrow(/Could not find the table/);
    });
    test("reconcile: verified, mismatch, added, not in statement, balance breaks", () => {
        const sheet = rowsOf([
            { date: "2026-10-21", amount: 100, type: "Debit", m: "Meta Verifie", ref: "629482059838", bal: 2507.75, status: "Flagged" },
            { date: "2026-10-22", amount: 1400, type: "Credit", m: "RAHUL K", ref: "123456789012", bal: 4007.75 },
            { date: "2026-10-22", amount: 77, type: "Debit", m: "Ghost", ref: "999999999999", bal: 1 }
        ]);
        const { updates, additions, report } = ex.reconcile(sheet, ex.statementRows(ex.parseCsv(stmtCsv)), []);
        expect(updates.find((u) => u.index === 2).status).toBe("Verified");         // a flagged row confirmed by the statement
        expect(updates.find((u) => u.index === 3).status).toBe("Mismatch");
        expect(updates.find((u) => u.index === 4).status).toBe("Not in statement");
        expect(additions.length).toBe(2);                                           // Swiggy and the ATM line
        expect(additions[0].category).toBe("Food");
        expect(additions[1].category).toBe("Cash");
        expect(report.balanceBreakCount).toBe(1);                                   // 3757.75 - 500 is not 9999
        expect(report.verified).toBe(1); expect(report.mismatched).toBe(1); expect(report.added).toBe(2);
    });
});

function makeXlsx(table) {
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const sheet = `<worksheet><sheetData>${table.map((r, i) => `<row r="${i + 1}">${r.map((c, j) => `<c r="${String.fromCharCode(65 + j)}${i + 1}" t="inlineStr"><is><t>${esc(c)}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`;
    const entries = [["xl/worksheets/sheet1.xml", Buffer.from(sheet)]];
    const parts = [], central = [];
    let offset = 0;
    for (const [name, data] of entries) {
        const comp = zlib.deflateRawSync(data), nameBuf = Buffer.from(name);
        const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
        parts.push(local, nameBuf, comp);
        const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nameBuf.length, 28); c.writeUInt32LE(offset, 42);
        central.push(c, nameBuf);
        offset += 30 + nameBuf.length + comp.length;
    }
    const cd = Buffer.concat(central), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...parts, cd, end]);
}

/* ───────── the whole API against a fake Google Sheets ───────── */

function fakeGoogle() {
    const book = { tabs: {}, next: 1 };
    const tab = (title) => book.tabs[title];
    const addTab = (title) => { book.tabs[title] = { id: book.next++, rows: [] }; };
    const rangeOf = (r) => { const [t, a] = decodeURIComponent(r).split("!"); const m = /^([A-Z])(\d+)?(?::([A-Z])(\d+)?)?$/.exec(a); return { tab: t, col: m[1].charCodeAt(0) - 65, row: m[2] ? Number(m[2]) : null, lastCol: m[3] ? m[3].charCodeAt(0) - 65 : null, lastRow: m[4] ? Number(m[4]) : null }; };
    const calls = [];
    const fetchFake = async (url, opts = {}) => {
        const u = new URL(String(url)), method = opts.method || "GET", body = opts.body ? (opts.body instanceof URLSearchParams ? Object.fromEntries(opts.body) : JSON.parse(opts.body)) : null;
        const json = (o, status = 200) => ({ ok: status < 300, status, json: async () => o });
        calls.push(`${method} ${u.pathname}`);
        if (u.hostname === "oauth2.googleapis.com") return json({ access_token: "tok", expires_in: 3600 });
        if (!u.pathname.startsWith("/v4/spreadsheets/")) throw new Error("unexpected fetch " + url);
        const rest = u.pathname.replace("/v4/spreadsheets/", "");
        const id = rest.split(/[/:]/)[0];
        if (id.startsWith("nopermission")) return json({}, 403);
        if (rest === id) return json({ sheets: Object.entries(book.tabs).map(([title, t]) => ({ properties: { sheetId: t.id, title } })) });
        if (rest === `${id}:batchUpdate`) {
            for (const r of body.requests) {
                if (r.addSheet) addTab(r.addSheet.properties.title);
                if (r.deleteDimension) { const t = Object.values(book.tabs).find((x) => x.id === r.deleteDimension.range.sheetId); t.rows.splice(r.deleteDimension.range.startIndex, 1); }
            }
            return json({});
        }
        if (rest === `${id}/values:batchUpdate`) {
            for (const d of body.data) { const r = rangeOf(d.range); const t = tab(r.tab); while (t.rows.length < r.row) t.rows.push([]); t.rows[r.row - 1][r.col] = d.values[0][0]; }
            return json({});
        }
        const m = /^[^/]+\/values\/(.+?)(:append)?$/.exec(rest);
        if (m) {
            const r = rangeOf(m[1].replace(/:append$/, "")), t = tab(r.tab);
            if (m[2]) { for (const row of body.values) t.rows.push([...row]); return json({}); }
            if (method === "PUT") { body.values.forEach((row, i) => { while (t.rows.length <= (r.row - 1) + i) t.rows.push([]); t.rows[(r.row - 1) + i] = [...row]; }); return json({}); }
            const slice = t.rows.slice(r.row - 1, r.lastRow ? r.lastRow : undefined).map((row) => [...row]);
            return json(slice.length && slice.some((x) => x.length) ? { values: slice } : {});
        }
        throw new Error("unhandled " + method + " " + rest);
    };
    return { book, fetchFake, calls, tab, addTab };
}

let mongo, realFetch, G;
const SHEET = "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdef/edit";
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); realFetch = global.fetch; });
afterAll(async () => { global.fetch = realFetch; await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => { await User.deleteMany({}); await ExpenseSettings.deleteMany({}); G = fakeGoogle(); global.fetch = (u, o) => G.fetchFake(u, o); sheets.forget("1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdef"); });

const signUp = async () => {
    await request(app).post("/register").send({ name: "Ana", email: "ana@example.com", password: "master-pass", cpassword: "master-pass" });
    const r = await request(app).post("/login").send({ email: "ana@example.com", password: "master-pass", client: "mobile" });
    return { Authorization: `Bearer ${r.body.token}` };
};
const ms = (iso) => Date.parse(iso);
const sms = (auth, messages) => request(app).post("/expenses/sms").set(auth).send({ messages });
const ready = async (auth, start = "2026-06-01") => {
    await request(app).put("/expenses/sheet").set(auth).send({ sheetUrl: SHEET });
    if (start) await request(app).post("/expenses/start").set(auth).send({ date: start });
};

describe("the money API", () => {
    test("setting up the sheet creates the tabs and headers; a sheet that is not shared is explained", async () => {
        const auth = await signUp();
        const before = (await request(app).get("/expenses/settings").set(auth)).body;
        expect(before.ready).toBe(true);
        expect(before.serviceAccountEmail).toBe("stashr@money-test.iam.gserviceaccount.com");
        expect(before.configured).toBe(false);
        expect((await request(app).put("/expenses/sheet").set(auth).send({ sheetUrl: "nonsense" })).status).toBe(400);
        const bad = await request(app).put("/expenses/sheet").set(auth).send({ sheetUrl: "https://docs.google.com/spreadsheets/d/nopermission_nopermission_nopermission/edit" });
        expect(bad.status).toBe(400);
        expect(bad.body.error).toMatch(/Share the sheet with stashr@money-test/);
        const ok = await request(app).put("/expenses/sheet").set(auth).send({ sheetUrl: SHEET });
        expect(ok.status).toBe(200);
        expect(ok.body.configured).toBe(true);
        expect(ok.body.needsStartDate).toBe(true);
        expect(Object.keys(G.book.tabs).sort()).toEqual(["Archive", "Summary", "Transactions"]);
        expect(G.tab("Transactions").rows[0][0]).toBe("Date");
        expect(G.tab("Transactions").rows[0].length).toBe(16);
        expect(String(G.tab("Summary").rows[2][0])).toMatch(/^=QUERY\(Transactions/);
    });

    test("the start date can be set once, and nothing is read before it", async () => {
        const auth = await signUp();
        await ready(auth, null);
        const early = await sms(auth, [{ address: "VM-FEDBNK-S", body: SAMPLE, date: ms("2026-10-21T14:12:00Z") }]);
        expect(early.body.needsStartDate).toBe(true);
        expect(G.tab("Transactions").rows.length).toBe(1);                       // headers only
        expect((await request(app).post("/expenses/start").set(auth).send({ date: "2999-01-01" })).status).toBe(400);
        expect((await request(app).post("/expenses/start").set(auth).send({ date: "2026-10-22" })).status).toBe(200);
        expect((await request(app).post("/expenses/start").set(auth).send({ date: "2026-01-01" })).body.error).toMatch(/already set/);
        const settings = (await request(app).get("/expenses/settings").set(auth)).body;
        expect(settings.needsStartDate).toBe(false);
        expect(settings.startDate).toBe("2026-10-22");
        const r = await sms(auth, [{ address: "VM-FEDBNK-S", body: SAMPLE, date: ms("2026-10-21T14:12:00Z") }, { address: "VM-FEDBNK-S", body: CREDIT, date: ms("2026-10-22T04:41:00Z") }]);
        expect(r.body.ignored).toBe(1);                                          // the 21 Oct message is before the start date
        expect(r.body.added).toBe(1);
    });

    test("messages become rows; doubtful ones are flagged; duplicates are skipped; the database keeps no transaction", async () => {
        const auth = await signUp();
        await ready(auth);
        const second = "Debited Rs 250.00 from a/c X9229 on 22Oct26 12:00 via UPI to SWIGGY. Ref 555555555555.Bal Rs 2257.75. Not you?Call 18004251199 -Federal Bank";
        const fake = "Debited Rs 5000.00 from a/c X9229 on 22Oct26 13:00 via UPI to Lottery Win. Ref 111.Bal Rs 100.00. -Federal Bank";
        const r1 = await sms(auth, [
            { address: "VM-FEDBNK-S", body: second, date: ms("2026-10-22T06:30:00Z") },
            { address: "VM-FEDBNK-S", body: SAMPLE, date: ms("2026-10-21T14:12:00Z") },           // out of order on purpose
            { address: "+919812345678", body: fake, date: ms("2026-10-22T07:30:00Z") },
            { address: "VM-FEDBNK-S", body: "Your OTP is 123456 -Federal Bank", date: ms("2026-10-22T07:31:00Z") },
            { address: "VM-FEDBNK-S", body: "Federal Bank: new statement format coming soon", date: ms("2026-10-22T07:32:00Z") }
        ]);
        expect(r1.status).toBe(200);
        expect(r1.body.added).toBe(3);
        expect(r1.body.flagged).toBe(1);
        expect(r1.body.ignored).toBe(1);
        expect(r1.body.unparsed.length).toBe(1);
        const again = await sms(auth, [{ address: "VM-FEDBNK-S", body: SAMPLE, date: ms("2026-10-21T14:12:00Z") }]);
        expect(again.body.duplicates).toBe(1); expect(again.body.added).toBe(0);
        const rows = G.tab("Transactions").rows.slice(1);
        expect(rows.length).toBe(3);
        expect(rows[0][0]).toBe("2026-10-21");                                              // sorted by date/time
        expect(rows[0][5]).toBe("Meta Ads");
        expect(rows[0][11]).toBe("Unverified");
        expect(rows[1][5]).toBe("Food");
        const flagged = rows.find((r) => r[11] === "Flagged");
        expect(flagged[15]).toMatch(/phone number/);
        expect(flagged[15]).toMatch(/12-digit/);
        // only the settings document exists in MongoDB for this feature, with no transaction data in it
        const docs = await ExpenseSettings.find({}).lean();
        expect(docs.length).toBe(1);
        const dump = JSON.stringify(docs);
        expect(dump).not.toMatch(/629482059838|Meta Verifie|SWIGGY|2507/);
        expect(docs[0].knownAccounts).toEqual(["X9229"]);
    });

    test("the list by month, totals without flagged rows, category change with remember, review", async () => {
        const auth = await signUp();
        await ready(auth);
        const person = "Debited Rs 300.00 from a/c X9229 on 22Oct26 12:00 via UPI to Rahul Sharma. Ref 222222222222.Bal Rs 2207.75 -Federal Bank";
        const person2 = "Debited Rs 80.00 from a/c X9229 on 23Oct26 12:00 via UPI to Rahul Sharma. Ref 333333333333.Bal Rs 2127.75 -Federal Bank";
        const odd = "Debited Rs 10.00 from a/c X9229 on 23Oct26 13:00 via UPI to Someone. Ref 444444444444.Bal Rs 5.00 -Federal Bank";   // balance does not follow
        await sms(auth, [SAMPLE, person, person2, odd].map((b, i) => ({ address: "VM-FEDBNK-S", body: b, date: ms("2026-10-21T14:12:00Z") + i * 86400000 / 3 })));
        const list = (await request(app).get("/expenses?month=2026-10").set(auth)).body;
        expect(list.month).toBe("2026-10");
        expect(list.months).toEqual(["2026-10"]);
        expect(list.rows.length).toBe(4);
        expect(list.flagged.length).toBe(1);
        expect(list.flagged[0].merchant).toBe("Someone");
        expect(list.totals.debit).toBe(480);                                                 // 100 + 300 + 80, the flagged 10 is left out
        expect(list.totals.flagged).toBe(1);
        expect(list.totals.byCategory[0]).toEqual({ category: "Uncategorized", amount: 380, count: 2 });
        expect(list.uncategorized).toBe(2);
        const first = list.rows.find((r) => r.ref === "222222222222");
        const set = await request(app).put("/expenses/category").set(auth).send({ index: first.index, category: "Personal", remember: true });
        expect(set.body.updated).toBe(2);                                                    // the other Rahul Sharma row too
        const after = (await request(app).get("/expenses?month=2026-10").set(auth)).body;
        expect(after.uncategorized).toBe(0);
        expect(after.totals.byCategory.find((c) => c.category === "Personal").amount).toBe(380);
        expect((await request(app).get("/expenses/rules").set(auth)).body.rules[0].category).toBe("Personal");
        const flaggedRow = after.flagged[0];
        expect((await request(app).put("/expenses/review").set(auth).send({ index: flaggedRow.index, action: "genuine" })).status).toBe(200);
        const confirmed = (await request(app).get("/expenses?month=2026-10").set(auth)).body;
        expect(confirmed.flagged.length).toBe(0);
        expect(confirmed.totals.debit).toBe(490);
        const gone = confirmed.rows.find((r) => r.ref === "444444444444");
        expect((await request(app).put("/expenses/review").set(auth).send({ index: gone.index, action: "delete" })).status).toBe(200);
        expect((await request(app).get("/expenses?month=2026-10").set(auth)).body.rows.length).toBe(3);
    });

    test("a statement verifies rows, confirms a flagged one, adds what was missed and reports balance breaks", async () => {
        const auth = await signUp();
        await ready(auth);
        const flaggedMsg = "Debited Rs 100.00 from a/c X9229 on 21Oct26 19:42 via UPI to Meta Verifie. Ref 629482059838.Bal Rs 2507.75 -Federal Bank";
        await sms(auth, [{ address: "+919812345678", body: flaggedMsg, date: ms("2026-10-21T14:12:00Z") }]);
        expect((await request(app).get("/expenses?month=2026-10").set(auth)).body.flagged.length).toBe(1);
        const csv = ["Date,Particulars,Withdrawals,Deposits,Balance", "21-10-2026,UPI/DR/629482059838/META VERIFIE,100.00,,2507.75", "23-10-2026,UPI/DR/555555555555/SWIGGY,250.00,,2257.75"].join("\n");
        const bad = await request(app).post("/expenses/statement?filename=s.pdf").set(auth).set("Content-Type", "application/octet-stream").send(Buffer.from("%PDF-1.4"));
        expect(bad.status).toBe(400); expect(bad.body.error).toMatch(/Excel or CSV/);
        const r = await request(app).post("/expenses/statement?filename=s.csv").set(auth).set("Content-Type", "application/octet-stream").send(Buffer.from(csv));
        expect(r.status).toBe(200);
        expect(r.body.report.verified).toBe(1);
        expect(r.body.report.added).toBe(1);
        const list = (await request(app).get("/expenses?month=2026-10").set(auth)).body;
        expect(list.flagged.length).toBe(0);                                              // the statement confirmed the doubtful message
        expect(list.rows.find((x) => x.ref === "629482059838").status).toBe("Verified");
        const added = list.rows.find((x) => x.ref === "555555555555");
        expect(added.source).toBe("Statement"); expect(added.category).toBe("Food"); expect(added.status).toBe("Verified");
        expect((await ExpenseSettings.findOne({}).lean()).lastStatement.verified).toBe(1);
        // the same statement as an Excel file
        const xl = await request(app).post("/expenses/statement?filename=s.xlsx").set(auth).set("Content-Type", "application/octet-stream").send(makeXlsx(ex.parseCsv(csv)));
        expect(xl.status).toBe(200); expect(xl.body.report.added).toBe(0);
    });

    test("entries older than four months go to the Archive tab, never deleted", async () => {
        const auth = await signUp();
        await ready(auth, "2026-01-01");
        const old = "Debited Rs 60.00 from a/c X9229 on 20May26 10:00 via UPI to Swiggy. Ref 777777777777.Bal Rs 940.00 -Federal Bank";
        const recent = "Debited Rs 40.00 from a/c X9229 on 20Oct26 10:00 via UPI to Zomato. Ref 888888888888.Bal Rs 900.00 -Federal Bank";
        const realNow = Date.now;
        Date.now = () => Date.parse("2026-10-22T06:00:00Z");
        try {
            const r = await sms(auth, [{ address: "VM-FEDBNK-S", body: old, date: ms("2026-05-20T04:30:00Z") }, { address: "VM-FEDBNK-S", body: recent, date: ms("2026-10-20T04:30:00Z") }]);
            expect(r.body.added).toBe(2);
            expect(G.tab("Archive").rows.slice(1).map((x) => x[8])).toEqual(["777777777777"]);        // arrived straight in the Archive
            expect(G.tab("Transactions").rows.slice(1).map((x) => x[8])).toEqual(["888888888888"]);
            // a row that was recent when it arrived and later ages out is moved by the daily clean-up
            G.tab("Transactions").rows.push(ex.rowFromTx({ date: "2026-06-10", time: "09:00", amount: 20, type: "Debit", counterparty: "Chai", account: "X9229", method: "UPI", ref: "999999999999", balance: null }, "Food", "SMS", "Unverified", "", 0, []));
            await new Promise((r) => setTimeout(r, 200));                         // the clean-up started by the upload has finished
            await ExpenseSettings.updateOne({}, { $set: { lastArchiveDay: "2026-10-21" } });
            sheets.forget("1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdef");
            const list = (await request(app).get("/expenses").set(auth)).body;
            expect(list.rows.length).toBe(1);
            expect(G.tab("Archive").rows.slice(1).map((x) => x[8])).toEqual(["777777777777", "999999999999"]);
            expect(G.tab("Transactions").rows.slice(1).map((x) => x[8])).toEqual(["888888888888"]);
        } finally { Date.now = realNow; }
    });
});
