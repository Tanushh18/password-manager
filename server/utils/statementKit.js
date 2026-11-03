/*
 * Reading a bank statement, the pure parts: splitting a CSV whatever its delimiter, turning "1,23,456.78 Dr" into a number, and
 * turning a narration like "UPI/DR/629482059838/META VERIFIE/fb@ybl" into a clean headline ("Meta Verifie") and a payment method.
 * No database, no network and no other module, so every function here can be tested on its own (tests/statement.test.js).
 */

/* ───────── CSV ───────── */

/** Counts a delimiter in one line, ignoring what is inside double quotes. */
function countOutside(line, d) {
    let q = false, n = 0;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') q = !q;
        else if (!q && c === d) n++;
    }
    return n;
}

/**
 * The delimiter a CSV really uses: the one that appears the same number of times on most lines. Comma, tab, semicolon or pipe.
 * (A comma inside an unquoted narration must not split a column when the file is semicolon separated, and the other way round.)
 */
function sniffDelimiter(text) {
    const lines = String(text).split(/\r?\n/).filter((l) => l.trim()).slice(0, 40);
    let best = ",", bestScore = -1;
    for (const d of [",", "\t", ";", "|"]) {
        const counts = lines.map((l) => countOutside(l, d)).filter((c) => c > 0);
        if (counts.length < 2) continue;
        const freq = new Map();
        for (const c of counts) freq.set(c, (freq.get(c) || 0) + 1);
        const [mode, times] = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
        const score = times * 100 + mode;
        if (score > bestScore) { bestScore = score; best = d; }
    }
    return best;
}

/** CSV text -> rows of text. Quoted cells may contain the delimiter, quotes ("") and line breaks. */
function parseDelimited(text) {
    const s = String(text).replace(/^﻿/, "");
    const d = sniffDelimiter(s);
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (q) { if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
        else if (c === '"') q = true;
        else if (c === d) { row.push(cell); cell = ""; }
        else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x.trim())) rows.push(row); row = []; }
        else cell += c;
    }
    row.push(cell);
    if (row.some((x) => x.trim())) rows.push(row);
    return rows;
}

/* ───────── numbers ───────── */

/**
 * "1,23,456.78", "Rs. 500", "₹1,000.00 Cr", "2,507.75 Dr", "(300.00)", "-45", "45-" -> a number (Dr, brackets and a minus sign make it
 * negative). "", "-", "--" and anything that is not a number -> null.
 */
function money(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    let s = String(value ?? "").trim();
    if (!s || /^[-–—.\s]+$/.test(s)) return null;
    const negative = /^\(.*\)$/.test(s) || /\bDr\.?\s*$/i.test(s) || /^-/.test(s) || /-$/.test(s);
    s = s.replace(/₹|Rs\.?|INR/gi, "").replace(/[A-Za-z]/g, "").replace(/[()\s,]/g, "").replace(/^-|-$/g, "");
    if (!/^\d*\.?\d+$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? (negative ? -n : n) : null;
}

/* ───────── narrations ───────── */

const BANK_CODES = new Set(("UTIB SBIN HDFC ICIC KKBK PUNB BARB YESB FDRL IDFB INDB CNRB UBIN BKID MAHB CBIN IOBA ANDB IDIB UCBA SYNB VIJB ORBC PSIB " +
    "KARB SIBL RATN AUBL ESFB JAKA TMBL DBSS CIUB DLXB HSBC SCBL AIRP PYTM FINO NSPB IBKL USFB UJVN").split(" "));

const title = (s) => (s === s.toUpperCase() && /[A-Z]/.test(s) ? s.toLowerCase().replace(/(^|[\s.&-])([a-z])/g, (m, a, b) => a + b.toUpperCase()) : s);

/**
 * { method, merchant } for a bank narration.
 *   "UPI/DR/629482059838/META VERIFIE/UTIB/fb@ybl/Payment f"  -> UPI, "Meta Verifie"
 *   "UPI/CR/123456789012/RAHUL K/x@ybl"                       -> UPI, "Rahul K"
 *   "UPI/DR/111111111111/9717621793@paytm"                    -> UPI, "9717621793@paytm"   (only a UPI id is given: it is the headline)
 *   "NEFT-FDRLN26101234567-MUKTA CHAWLA-..."                   -> NEFT, "Mukta Chawla"
 *   "ATM WDL ..."  -> ATM, "ATM withdrawal";  "SMS CHARGES"  -> Other, "Bank charges"
 */
function describeLine(desc) {
    // "TO TRANSFER-UPI/DR/..." and "BY TRANSFER-..." only say that money moved; what follows is the real narration
    const text = String(desc || "").replace(/\s+/g, " ").trim().replace(/^(?:TO|BY)\s+TRANSFER\s*[-:]?\s*/i, "");
    const up = text.toUpperCase();
    const method = /\bUPI\b|^UPI/.test(up) ? "UPI" : /\bIMPS\b/.test(up) ? "IMPS" : /\bNEFT\b/.test(up) ? "NEFT" : /\bRTGS\b/.test(up) ? "RTGS"
        : /\bATM\b|\bNFS\b|CASH W(?:DL|ITHDRAWAL)/.test(up) ? "ATM" : /\bPOS\b|\bECOM\b|\bPURCHASE\b/.test(up) ? "POS" : /\bECS\b|\bNACH\b|AUTO ?DEBIT/.test(up) ? "ECS" : "Other";
    if (method === "ATM") return { method, merchant: "ATM withdrawal" };
    if (method === "Other" && /\b(SMS|CHRG|CHARGES?|GST|SERVICE TAX|FEE|AMC|ANNUAL|MIN(?:IMUM)? BAL)\b/.test(up)) return { method, merchant: "Bank charges" };
    if (method === "Other" && /\bINTEREST\b|\bINT\.? ?(PD|PAID|CR|CREDIT)\b|\bSB INT/.test(up)) return { method, merchant: "Interest" };

    const NOISE_WORD = /^(UPI|UPIOUT|UPIIN|DR|CR|IN|OUT|P2P|P2M|P2A|IMPS|NEFT|RTGS|TFR|TRF|TRANSFER|TO|BY|FROM|MOB|MOBILE|NET|ONLINE|REF|RRN|TXN|POS|ECOM|PUR|PURCHASE|CARD|DEBIT|CREDIT|ECS|NACH|ACH|ATM|NFS|PAYMENT|PAID|PAY)$/i;
    // a piece is noise when every word in it is a payment-system word ("UPI IN", "ECOM PUR"), a plain number, an IFSC, a UTR or a bank code
    const noise = (p) => p.split(" ").every((w) => NOISE_WORD.test(w)) || /^(payment|paid|pay )/i.test(p) || /^\d[\d\s-]*$/.test(p)
        || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(p) || /^[A-Z]{4}[A-Z0-9]\d{9,}$/i.test(p) || BANK_CODES.has(p.toUpperCase());
    const parts = text.split(/[\/|]/).map((p) => p.trim()).filter(Boolean);
    // "NEFT-FDRLN26101234567-MUKTA CHAWLA-..." and "TO TRANSFER-MUKTA" have dashes instead of slashes
    const pieces = parts.length > 1 ? parts : text.split(/\s*-\s*/).map((p) => p.trim()).filter(Boolean);
    let merchant = "", vpa = "";
    for (const p of pieces) {
        if (p.includes("@")) { vpa = vpa || p; continue; }
        if (noise(p) || !/[A-Za-z]{3}/.test(p)) continue;
        merchant = p.replace(/^(TO|BY|FROM)\s+/i, "");
        break;
    }
    if (!merchant) merchant = vpa;
    merchant = merchant.replace(/\s*\b\d{6,}\b\s*$/, "").replace(/\s+/g, " ").trim().slice(0, 40);
    return { method, merchant: merchant ? title(merchant) : "" };
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9@ ]/g, " ").replace(/\s+/g, " ").trim();

/**
 * How well two names fit (0 = unrelated, 1 = share a word, 2 = one begins with the other). SMS cut a name after about 12 letters,
 * so "Meesho Techn" and "Meesho Technologies" count as the same payee.
 */
function nameMatch(a, b) {
    const x = norm(a), y = norm(b);
    if (!x || !y) return 0;
    if (x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x)))) return 2;
    const wx = x.split(" ").filter((w) => w.length >= 4), wy = new Set(y.split(" "));
    return wx.some((w) => wy.has(w)) ? 1 : 0;
}

/**
 * The better headline for an entry the statement confirms. The statement wins when the message said "unknown", gave only a phone
 * number, or cut the name short; otherwise the name the SMS gave stays (it is usually the same).
 */
function betterName(current, fromStatement) {
    const o = String(current || "").trim(), n = String(fromStatement || "").trim();
    if (!n) return o;
    if (!o || /^(unknown|\(.*\))$/i.test(o)) return n;
    if (/^\+?\d{8,}$/.test(o) && !/^\+?\d{8,}$/.test(n)) return n;
    const lo = norm(o), ln = norm(n);
    if (ln.length > lo.length && ln.startsWith(lo)) return n;
    return o;
}

module.exports = { sniffDelimiter, parseDelimited, money, describeLine, nameMatch, betterName, norm };
