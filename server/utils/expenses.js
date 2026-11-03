/*
 * Money from bank messages and statements: parsing, categories and the reconcile logic. Pure functions (no database, no network)
 * so they can be tested; utils/sheets.js talks to Google Sheets and router/expenses.js ties it together.
 */
const zlib = require("zlib");

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, "0");
const num = (s) => Number(String(s).replace(/[,\s]/g, ""));
const round2 = (n) => Math.round(n * 100) / 100;

/** "21Oct26", "21-Oct-2026", "21/10/2026", "21-10-26", "2026-10-21" -> "2026-10-21" or null. */
function parseDate(text) {
    const t = String(text || "").trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    m = /^(\d{1,2})[\s\-\/.]?([A-Za-z]{3})[A-Za-z]*[\s\-\/.]?(\d{2,4})/.exec(t);
    if (m && MONTHS[m[2].toLowerCase()]) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(m[1])}`;
    m = /^(\d{1,2})[\-\/.](\d{1,2})[\-\/.](\d{2,4})/.exec(t);
    if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${pad(m[2])}-${pad(m[1])}`;
    if (/^\d{5}(\.\d+)?$/.test(t)) {                      // an Excel serial date
        const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86400000);
        return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
    return null;
}

/**
 * One bank SMS -> { date, time, amount, type: "Debit"|"Credit", counterparty, account, method, ref, balance } or null when it is not a
 * money message (an OTP, an offer…). Built from the Federal Bank format
 *   "Debited Rs 100.00 from a/c X9229 on 21Oct26 19:42 via UPI to Meta Verifie. Ref 629482059838.Bal Rs 2507.75. Not you?Call … -Federal Bank"
 * but tolerant of the usual variants (Credited, ATM/POS/IMPS/NEFT, other date styles).
 */
function parseSms(body) {
    const text = String(body || "").replace(/\s+/g, " ").trim();
    if (!text || /\b(otp|one time password|verification code)\b/i.test(text)) return null;
    const dir = /\b(debited|credited|withdrawn|spent|received|deposited)\b/i.exec(text);
    const amt = /(?:Rs\.?|INR|₹)\s?([\d,]+(?:\.\d{1,2})?)/i.exec(text);
    if (!dir || !amt) return null;
    if (!/(a\/c|account|federal)/i.test(text)) return null;
    const type = /debited|withdrawn|spent/i.test(dir[1]) ? "Debit" : "Credit";
    const acc = /(?:a\/c|account)\s*(?:no\.?)?\s*[Xx*]*\s*(\d{3,4})\b/i.exec(text);
    const when = /\bon\s+(\d{1,2}\s?[A-Za-z]{3}\s?\d{2,4}|\d{1,2}[\-\/]\d{1,2}[\-\/]\d{2,4})(?:\s+(\d{1,2}:\d{2})(?::\d{2})?)?/i.exec(text);
    const method = /\bvia\s+(UPI|IMPS|NEFT|RTGS|ATM|POS|ECS|NACH)\b/i.exec(text) || /\b(UPI|IMPS|NEFT|RTGS|ATM|POS)\b/i.exec(text);
    const afterWhen = text.slice(when ? text.indexOf(when[0]) + when[0].length : 0);
    const party = /\b(?:via\s+\w+\s+)?(?:to|from|at)\s+(.+?)\s*\.\s*(?:Ref|UPI|Bal|Avl|Not you|Call|-)/i.exec(afterWhen) || /\b(?:to|from|at)\s+(.+?)\s*\.?\s*$/i.exec(afterWhen);
    const ref = /\bRef(?:erence)?\s*(?:No\.?|#|:)?\s*:?\s*([A-Za-z0-9]{6,})/i.exec(text);
    const bal = /\b(?:Bal(?:ance)?|Avl\.?\s*Bal)\s*(?:is\s*)?(?:Rs\.?|INR|₹)?\s*([\d,]+\.\d{2})/i.exec(text);
    return {
        date: when ? parseDate(when[1]) : null, time: when && when[2] ? when[2] : "",
        amount: round2(num(amt[1])), type, counterparty: party ? party[1].trim().slice(0, 60) : "", account: acc ? "X" + acc[1] : "",
        method: method ? method[1].toUpperCase() : "Other", ref: ref ? ref[1] : "", balance: bal ? round2(num(bal[1])) : null
    };
}

/* ───────── is this message believable? ───────── */

/** A bank's sender id looks like "VM-FEDBNK-S" or "FEDBNK"; a phone number does not. */
const bankSender = (a) => { const t = String(a || "").trim(); return t !== "" && !/^\+?[\d\s-]{6,}$/.test(t) && /^[A-Za-z]{2}-[A-Za-z0-9]{3,10}(-[A-Za-z])?$|^[A-Za-z0-9]{4,10}$/.test(t) && /[A-Za-z]/.test(t); };
const ist = (ms) => new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10);

/**
 * Reasons to doubt one parsed message (an empty list = it looks genuine). ctx: { sender, receivedAt (ms), knownAccounts, lastBalance
 * (balance after the previous transaction, or null) }. A doubtful entry is written as "Flagged", kept out of the totals and checked
 * against the next bank statement.
 */
function assess(tx, ctx = {}) {
    const f = [];
    if (ctx.sender !== undefined && !bankSender(ctx.sender)) f.push("Came from a phone number, not the bank's sender name");
    if (!tx.date) f.push("No date in the message");
    if (tx.method === "UPI" && !/^\d{12}$/.test(tx.ref || "")) f.push("UPI message without a 12-digit reference");
    else if (!tx.ref && tx.method !== "UPI") f.push("No reference number");
    if (ctx.knownAccounts && ctx.knownAccounts.length && tx.account && !ctx.knownAccounts.includes(tx.account)) f.push(`Account ${tx.account} is not one of your accounts (${ctx.knownAccounts.join(", ")})`);
    if (tx.date && tx.date > ist(ctx.now || Date.now())) f.push("Dated in the future");
    if (ctx.receivedAt && tx.date) {
        const diff = Math.abs(Date.parse(tx.date + "T12:00:00+05:30") - ctx.receivedAt) / 86400000;
        if (diff > 2.5) f.push(`The message arrived ${Math.round(diff)} days away from the date written in it`);
    }
    if (tx.method === "UPI" && tx.amount > 100000) f.push("UPI amount above the 1 lakh limit");
    if (ctx.lastBalance != null && tx.balance != null) {
        const expect = round2(ctx.lastBalance + (tx.type === "Credit" ? tx.amount : -tx.amount));
        if (Math.abs(expect - tx.balance) >= 0.01) f.push(`Balance ${tx.balance} does not follow the previous one (${ctx.lastBalance} ${tx.type === "Credit" ? "+" : "-"} ${tx.amount} = ${expect}); a message may be missing`);
    }
    return f;
}

/* ───────── categories ───────── */

const DEFAULT_CATEGORIES = ["Meta Ads", "Food", "Groceries", "Travel", "Shopping", "Bills & Recharge", "Subscriptions", "Health", "Education", "Rent & Home", "Investments", "Transfers", "Cash", "Salary & Income", "Other", "Uncategorized"];
// keyword (lower case, found inside the merchant text) -> category. The owner's own rules win over these.
const DEFAULT_RULES = [
    ["meta", "Meta Ads"], ["facebook", "Meta Ads"], ["fb ads", "Meta Ads"], ["instagram", "Meta Ads"],
    ["swiggy", "Food"], ["zomato", "Food"], ["restaurant", "Food"], ["cafe", "Food"], ["domino", "Food"], ["pizza", "Food"], ["mcdonald", "Food"], ["kfc", "Food"], ["burger", "Food"], ["biryani", "Food"], ["bakery", "Food"], ["starbucks", "Food"], ["chai", "Food"], ["dhaba", "Food"], ["eatsure", "Food"],
    ["zepto", "Groceries"], ["blinkit", "Groceries"], ["bigbasket", "Groceries"], ["dmart", "Groceries"], ["instamart", "Groceries"], ["grocer", "Groceries"], ["kirana", "Groceries"], ["supermarket", "Groceries"], ["mart", "Groceries"], ["vegetable", "Groceries"], ["milk", "Groceries"],
    ["uber", "Travel"], ["ola", "Travel"], ["rapido", "Travel"], ["irctc", "Travel"], ["redbus", "Travel"], ["makemytrip", "Travel"], ["indigo", "Travel"], ["metro", "Travel"], ["fuel", "Travel"], ["petrol", "Travel"], ["hpcl", "Travel"], ["iocl", "Travel"], ["bpcl", "Travel"], ["fastag", "Travel"],
    ["amazon", "Shopping"], ["flipkart", "Shopping"], ["myntra", "Shopping"], ["ajio", "Shopping"], ["meesho", "Shopping"], ["nykaa", "Shopping"], ["reliance", "Shopping"],
    ["jio", "Bills & Recharge"], ["airtel", "Bills & Recharge"], ["vodafone", "Bills & Recharge"], ["bsnl", "Bills & Recharge"], ["electric", "Bills & Recharge"], ["bescom", "Bills & Recharge"], ["bses", "Bills & Recharge"], ["recharge", "Bills & Recharge"], ["broadband", "Bills & Recharge"], ["excitel", "Bills & Recharge"], ["gas", "Bills & Recharge"], ["water", "Bills & Recharge"], ["dth", "Bills & Recharge"], ["tata play", "Bills & Recharge"],
    ["netflix", "Subscriptions"], ["spotify", "Subscriptions"], ["hotstar", "Subscriptions"], ["prime video", "Subscriptions"], ["youtube", "Subscriptions"], ["google play", "Subscriptions"], ["google one", "Subscriptions"], ["apple", "Subscriptions"], ["openai", "Subscriptions"], ["anthropic", "Subscriptions"], ["render", "Subscriptions"], ["github", "Subscriptions"], ["namecheap", "Subscriptions"], ["godaddy", "Subscriptions"],
    ["pharm", "Health"], ["apollo", "Health"], ["medic", "Health"], ["hospital", "Health"], ["clinic", "Health"], ["1mg", "Health"], ["lab", "Health"], ["dental", "Health"], ["doctor", "Health"],
    ["school", "Education"], ["college", "Education"], ["course", "Education"], ["udemy", "Education"], ["coaching", "Education"], ["fees", "Education"],
    ["rent", "Rent & Home"], ["maintenance", "Rent & Home"], ["society", "Rent & Home"], ["furniture", "Rent & Home"],
    ["zerodha", "Investments"], ["groww", "Investments"], ["upstox", "Investments"], ["mutual", "Investments"], ["sip", "Investments"], ["lic", "Investments"], ["insurance", "Investments"],
    ["atm", "Cash"], ["cash", "Cash"], ["salary", "Salary & Income"], ["interest", "Salary & Income"], ["refund", "Salary & Income"]
];

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9& ]+/g, " ").replace(/\s+/g, " ").trim();

/** category of a merchant: the owner's rules first (longest match), then the defaults, else "Uncategorized". */
function categorize(merchant, type, method, userRules = []) {
    const m = norm(merchant);
    if (method === "ATM") return "Cash";
    if (m) {
        const own = (userRules || []).filter((r) => r && r.match && m.includes(norm(r.match))).sort((a, b) => norm(b.match).length - norm(a.match).length)[0];
        if (own) return own.category;
        const words = m.split(" ");
        for (const [k, cat] of DEFAULT_RULES) {
            if (k.length <= 3 ? words.includes(k) || words.some((w) => w.startsWith(k) && k.length === 3 && w.length <= 6) : m.includes(k)) return cat;
        }
    }
    return "Uncategorized";
}

/** A short key to make a rule from: the first two words of the merchant. */
const ruleKey = (merchant) => norm(merchant).split(" ").slice(0, 2).join(" ");

/* ───────── sheet rows ───────── */

const HEADERS = ["Date", "Time", "Amount", "Type", "Merchant", "Category", "Account", "Method", "Reference", "Balance", "Source", "Status", "Note", "Month", "SMS received", "Flags"];

function rowFromTx(t, category, source = "SMS", status = "Unverified", note = "", receivedAt = 0, flags = []) {
    return [t.date || "", t.time || "", t.amount, t.type, t.counterparty || "", category, t.account || "", t.method || "", t.ref || "", t.balance == null ? "" : t.balance, source, status, note, (t.date || "").slice(0, 7), receivedAt ? new Date(receivedAt).toISOString() : "", (flags || []).join(" | ")];
}

/** One transaction as a plain object (what the stores keep and the API returns): `p` is a parsed message or a statement line. */
function makeTx(p, category, source = "SMS", status = "Unverified", note = "", receivedAt = 0, flags = []) {
    return { date: p.date || "", time: p.time || "", amount: p.amount, type: p.type, merchant: p.counterparty !== undefined ? p.counterparty : (p.merchant || ""), category, account: p.account || "", method: p.method || "", ref: p.ref || "",
        balance: p.balance == null ? null : p.balance, source, status, note, month: (p.date || "").slice(0, 7), received: receivedAt ? new Date(receivedAt).toISOString() : "", flags: [...flags] };
}
/** The sheet row for such an object. */
const txToRow = (t) => rowFromTx({ ...t, counterparty: t.merchant }, t.category, t.source, t.status, t.note, t.received ? Date.parse(t.received) : 0, t.flags || []);

function txFromRow(r, index) {
    return { index, date: String(r[0] || ""), time: String(r[1] || ""), amount: Number(r[2]) || 0, type: String(r[3] || ""), merchant: String(r[4] || ""), category: String(r[5] || "Uncategorized"),
        account: String(r[6] || ""), method: String(r[7] || ""), ref: String(r[8] || ""), balance: r[9] === "" || r[9] == null ? null : Number(r[9]), source: String(r[10] || ""), status: String(r[11] || ""), note: String(r[12] || ""), month: String(r[13] || String(r[0] || "").slice(0, 7)), received: String(r[14] || ""), flags: String(r[15] || "") ? String(r[15]).split(" | ") : [] };
}

/**
 * Two phones can hold different halves of the same month. An entry saved before the other half arrived was flagged because its balance
 * did not follow the one before it (that one was missing). Once the missing messages are in, an entry flagged ONLY for that reason
 * and whose balance now follows is cleared. Returns [{ index, fields, tx }] for the store's updateMany.
 */
function reclearBalanceFlags(all) {
    const key = (t) => `${t.date} ${t.time || ""}`;
    const withBal = all.filter((t) => t.balance != null && t.date).sort((a, b) => key(a).localeCompare(key(b)));
    const out = [];
    for (const t of all) {
        const flags = t.flags || [];
        if (t.status !== "Flagged" || !flags.length || !flags.every((f) => /^Balance .* does not follow/.test(f))) continue;
        let prev = null;
        for (const o of withBal) { if (o === t || key(o) >= key(t)) { if (o !== t && key(o) >= key(t)) break; continue; } prev = o; }
        if (!prev || t.balance == null) continue;
        const expect = round2(prev.balance + (t.type === "Credit" ? t.amount : -t.amount));
        if (Math.abs(expect - t.balance) < 0.01) out.push({ index: t.index, fields: { status: "Unverified", flags: [], note: "Balance now follows: the missing messages came from another phone" }, tx: t });
    }
    return out;
}

const sameTx = (a, b) => (a.ref && b.ref ? a.ref === b.ref : a.date === b.date && a.time === b.time && a.amount === b.amount && norm(a.merchant) === norm(b.merchant));

function summarize(rows) {
    const by = new Map();
    let debit = 0, credit = 0, flagged = 0;
    for (const t of rows) {
        if (t.status === "Flagged") { flagged++; continue; }     // doubtful entries are not counted until they are confirmed
        if (t.type === "Debit") { debit += t.amount; const e = by.get(t.category) || { category: t.category, amount: 0, count: 0 }; e.amount = round2(e.amount + t.amount); e.count++; by.set(t.category, e); }
        else if (t.type === "Credit") credit += t.amount;
    }
    return { flagged, debit: round2(debit), credit: round2(credit), net: round2(credit - debit), byCategory: [...by.values()].sort((a, b) => b.amount - a.amount) };
}

/* ───────── bank statements (CSV or Excel) ───────── */

function parseCsv(text) {
    const rows = [];
    let row = [], cell = "", q = false;
    const s = String(text).replace(/^﻿/, "");
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (q) { if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
        else if (c === '"') q = true;
        else if (c === "," || c === "\t" || c === ";") { row.push(cell); cell = ""; }
        else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x.trim())) rows.push(row); row = []; }
        else cell += c;
    }
    row.push(cell); if (row.some((x) => x.trim())) rows.push(row);
    return rows;
}

/** A tiny .xlsx reader (zip + XML, no libraries): the first worksheet as rows of text. */
function parseXlsx(buf) {
    const files = {};
    let end = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
    if (end < 0) throw new Error("This is not an Excel file.");
    let p = buf.readUInt32LE(end + 16);
    const count = buf.readUInt16LE(end + 10);
    for (let n = 0; n < count && buf.readUInt32LE(p) === 0x02014b50; n++) {
        const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
        const name = buf.toString("utf8", p + 46, p + 46 + nlen);
        if (/^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(name)) {
            const lh = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
            const data = buf.subarray(lh, lh + csize);
            files[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString("utf8");
        }
        p += 46 + nlen + elen + clen;
    }
    const un = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    const shared = [...(files["xl/sharedStrings.xml"] || "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => un(m[1]));
    const sheetName = Object.keys(files).filter((k) => k.startsWith("xl/worksheets/")).sort()[0];
    if (!sheetName) throw new Error("No sheet found in the Excel file.");
    const col = (ref) => ref.replace(/\d+/g, "").split("").reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const rows = [];
    for (const r of files[sheetName].matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells = [];
        for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
            const ref = /r="([A-Z]+\d+)"/.exec(c[1]), t = /t="(\w+)"/.exec(c[1]);
            const v = /<v>([\s\S]*?)<\/v>/.exec(c[2] || ""), is = /<is>([\s\S]*?)<\/is>/.exec(c[2] || "");
            cells[ref ? col(ref[1]) : cells.length] = t && t[1] === "s" && v ? shared[Number(v[1])] : is ? un(is[1]) : v ? un(v[1]) : "";
        }
        if (cells.some((x) => x && String(x).trim())) rows.push(Array.from(cells, (x) => x ?? ""));
    }
    return rows;
}

/** Rows of text -> [{ date, desc, amount, type, balance, ref }] by finding the header row (Date / Particulars / Withdrawals / Deposits / Balance). */
function statementRows(table) {
    const low = (v) => String(v || "").toLowerCase();
    let h = -1;
    for (let i = 0; i < Math.min(table.length, 60); i++) {
        const cells = table[i].map(low);
        if (cells.some((c) => /\bdate\b/.test(c)) && cells.some((c) => /withdraw|debit|\bdr\b|amount/.test(c)) && cells.some((c) => /balance/.test(c))) { h = i; break; }
    }
    if (h < 0) throw new Error("Could not find the table in this statement. Download it as Excel or CSV from net banking (columns like Date, Particulars, Withdrawals, Deposits, Balance).");
    const head = table[h].map(low);
    const find = (re, skip = -1) => head.findIndex((c, i) => i !== skip && re.test(c));
    const iDate = find(/\bdate\b/), iDesc = find(/particular|narration|description|details|remarks/), iBal = find(/balance/);
    const iDeb = find(/withdraw|debit|dr amount/), iCred = find(/deposit|credit|cr amount/), iAmt = iDeb < 0 ? find(/amount/) : -1, iDc = find(/^dr\/?cr$|type|cr\/dr/);
    const iId = find(/tran(saction)? ?id|ref|utr|chq|cheque/);
    const out = [];
    for (const r of table.slice(h + 1)) {
        const date = parseDate(r[iDate]);
        if (!date) continue;
        const d = iDeb >= 0 ? num(r[iDeb] || 0) : 0, c = iCred >= 0 ? num(r[iCred] || 0) : 0;
        let amount = 0, type = "";
        if (d > 0) { amount = d; type = "Debit"; } else if (c > 0) { amount = c; type = "Credit"; }
        else if (iAmt >= 0 && num(r[iAmt] || 0) > 0) { amount = num(r[iAmt]); type = /cr/i.test(String(r[iDc] || "")) && !/dr/i.test(String(r[iDc] || "")) ? "Credit" : "Debit"; }
        if (!amount) continue;
        const desc = String(r[iDesc] ?? "").trim(), idCell = iId >= 0 ? String(r[iId] || "") : "";
        const ref = (/\b(\d{12})\b/.exec(desc + " " + idCell) || [])[1] || "";
        out.push({ date, desc, amount: round2(amount), type, balance: iBal >= 0 && String(r[iBal] || "").trim() ? round2(num(String(r[iBal]).replace(/[^\d.\-,]/g, ""))) : null, ref });
    }
    return out;
}

/**
 * Checks the sheet against a statement. For each statement line: the sheet row with the same reference (or, failing that, the same
 * amount and type on the same day) is "Verified" (or "Mismatch" when the amount differs); a statement line the sheet does not have is
 * added; a sheet row inside the statement's dates that the statement does not have is "Not in statement". Also reports where the
 * statement's own running balance breaks.
 */
function reconcile(sheetRows, stmt, userRules = []) {
    const used = new Set();
    const updates = [], additions = [];
    const dates = stmt.map((s) => s.date).sort();
    const from = dates[0], to = dates[dates.length - 1];
    let verified = 0, mismatched = 0;
    for (const s of stmt) {
        let hit = s.ref ? sheetRows.find((t) => !used.has(t.index) && t.ref && t.ref === s.ref) : null;
        if (!hit) hit = sheetRows.find((t) => !used.has(t.index) && t.type === s.type && Math.abs(t.amount - s.amount) < 0.005 && t.date === s.date);
        if (!hit) hit = sheetRows.find((t) => !used.has(t.index) && t.type === s.type && Math.abs(t.amount - s.amount) < 0.005 && Math.abs(Date.parse(t.date) - Date.parse(s.date)) <= 86400000);
        if (hit) {
            used.add(hit.index);
            const bad = Math.abs(hit.amount - s.amount) >= 0.005 || hit.type !== s.type;
            const balBad = hit.balance != null && s.balance != null && Math.abs(hit.balance - s.balance) >= 0.005;
            updates.push({ index: hit.index, status: bad ? "Mismatch" : "Verified", note: bad ? `Statement says ${s.type} ${s.amount}` : balBad ? `Verified; balance after it differs (SMS ${hit.balance}, statement ${s.balance})` : "" });
            if (bad) mismatched++; else verified++;
        } else {
            const merchant = (/(?:UPI|IMPS|NEFT)[\/\-][A-Z]*[\/\-]?\d*[\/\-]?([A-Za-z][A-Za-z0-9 &.]{2,30})/.exec(s.desc) || [])[1] || s.desc.slice(0, 40);
            const t = { date: s.date, time: "", amount: s.amount, type: s.type, counterparty: merchant.trim(), account: "", method: /UPI/i.test(s.desc) ? "UPI" : /ATM/i.test(s.desc) ? "ATM" : /NEFT|IMPS|RTGS/i.test(s.desc) ? (/NEFT|IMPS|RTGS/i.exec(s.desc) || [])[0].toUpperCase() : "Other", ref: s.ref, balance: s.balance };
            additions.push({ ...t, category: categorize(t.counterparty, t.type, t.method, userRules) });
        }
    }
    const missing = sheetRows.filter((t) => !used.has(t.index) && t.date >= from && t.date <= to && t.status !== "Verified");
    for (const t of missing) updates.push({ index: t.index, status: "Not in statement", note: "Not found in the statement you sent" });
    const breaks = [];
    for (let i = 1; i < stmt.length; i++) {
        const a = stmt[i - 1], b = stmt[i];
        if (a.balance == null || b.balance == null) continue;
        const expect = round2(a.balance + (b.type === "Credit" ? b.amount : -b.amount));
        if (Math.abs(expect - b.balance) >= 0.01) breaks.push({ date: b.date, desc: b.desc.slice(0, 50), expected: expect, got: b.balance });
    }
    return { updates, additions, report: { from, to, lines: stmt.length, verified, mismatched, added: additions.length, notInStatement: missing.length, balanceBreaks: breaks.slice(0, 20), balanceBreakCount: breaks.length } };
}

module.exports = { makeTx, txToRow, assess, bankSender, ist, parseDate, parseSms, categorize, ruleKey, norm, DEFAULT_CATEGORIES, DEFAULT_RULES, HEADERS, rowFromTx, txFromRow, sameTx, reclearBalanceFlags, summarize, parseCsv, parseXlsx, statementRows, reconcile, round2 };
