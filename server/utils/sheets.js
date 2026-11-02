/*
 * A small Google Sheets client for the Money feature. Access is by a SERVICE ACCOUNT (no consent screen): the owner shares their sheet
 * with its e-mail as Editor. Configure with env GOOGLE_SHEETS_SA_JSON (the key file as raw JSON or base64). Uses global fetch, no packages.
 * Nothing is kept here except a 45 second read cache; the sheet is the only place transactions exist.
 */
const crypto = require("crypto");
const { HEADERS } = require("./expenses");

const API = "https://sheets.googleapis.com/v4/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TABS = ["Transactions", "Archive", "Summary"];
const LAST_COL = "P";                       // 16 columns, see HEADERS

const err = (status, message) => Object.assign(new Error(message), { status });

function account() {
    const raw = String(process.env.GOOGLE_SHEETS_SA_JSON || "").trim();
    if (!raw) return null;
    try {
        const json = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
        return json.client_email && json.private_key ? { email: json.client_email, key: String(json.private_key).replace(/\\n/g, "\n") } : null;
    } catch (e) { return null; }
}
const serviceEmail = () => (account() || {}).email || "";
const ready = () => Boolean(account());

function parseSheetId(urlOrId) {
    const t = String(urlOrId || "").trim();
    const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(t) || /^([A-Za-z0-9_-]{30,})$/.exec(t);
    return m ? m[1] : "";
}

let token = null;     // { value, until }
async function accessToken() {
    const sa = account();
    if (!sa) throw err(503, "Google Sheets is not set up on this server (GOOGLE_SHEETS_SA_JSON)");
    if (token && token.until > Date.now() + 60000 && token.email === sa.email) return token.value;
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 })}`;
    const sig = crypto.createSign("RSA-SHA256").update(unsigned).sign(sa.key).toString("base64url");
    const res = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }), signal: AbortSignal.timeout(10000) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) throw err(502, "Google did not accept the service account key" + (body.error_description ? `: ${body.error_description}` : ""));
    token = { value: body.access_token, until: Date.now() + (Number(body.expires_in) || 3600) * 1000, email: sa.email };
    return token.value;
}

async function call(path, { method = "GET", body, query } = {}) {
    const t = await accessToken();
    const url = `${API}${path}${query ? "?" + new URLSearchParams(query) : ""}`;
    const res = await fetch(url, { method, headers: { Authorization: `Bearer ${t}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    if (res.status === 403 || res.status === 404) throw err(400, `Share the sheet with ${serviceEmail()} as Editor (and check the link).`);
    if (res.status === 429) throw err(503, "Google Sheets is busy. Try again in a minute.");
    if (!res.ok) throw err(502, `Google Sheets answered HTTP ${res.status}`);
    return res.json().catch(() => ({}));
}

const cache = new Map();   // "sheetId|tab" -> { at, rows }
const forget = (sheetId) => { for (const k of [...cache.keys()]) if (k.startsWith(sheetId + "|")) cache.delete(k); };
const enc = (s) => encodeURIComponent(s);

async function tabIds(sheetId) {
    const meta = await call(`/${sheetId}`, { query: { fields: "sheets.properties(sheetId,title)" } });
    return Object.fromEntries((meta.sheets || []).map((s) => [s.properties.title, s.properties.sheetId]));
}

/** Makes sure the three tabs exist with headers (and the Summary formulas). Safe to run again. */
async function ensureLayout(sheetId) {
    let ids = await tabIds(sheetId);
    const missing = TABS.filter((t) => ids[t] === undefined);
    if (missing.length) {
        await call(`/${sheetId}:batchUpdate`, { method: "POST", body: { requests: missing.map((title) => ({ addSheet: { properties: { title, ...(title === "Summary" ? {} : { gridProperties: { frozenRowCount: 1 } }) } } })) } });
        ids = await tabIds(sheetId);
    }
    for (const tab of ["Transactions", "Archive"]) {
        const head = await call(`/${sheetId}/values/${enc(`${tab}!A1:${LAST_COL}1`)}`);
        if (!(head.values && head.values[0] && head.values[0][0])) await call(`/${sheetId}/values/${enc(`${tab}!A1:${LAST_COL}1`)}`, { method: "PUT", query: { valueInputOption: "RAW" }, body: { values: [HEADERS] } });
    }
    if (missing.includes("Summary")) {
        await call(`/${sheetId}/values/${enc("Summary!A1:A1")}`, {
            method: "PUT", query: { valueInputOption: "USER_ENTERED" },
            body: { values: [["Stashr money · spent per month and category (the last 4 months; older rows are in the Archive tab). Flagged rows are not counted."], [""],
                ["=QUERY(Transactions!A:P,\"select N,F,sum(C) where D='Debit' and L<>'Flagged' and N is not null group by N,F order by N desc label N 'Month', F 'Category', sum(C) 'Spent'\",1)"]] }
        });
        await call(`/${sheetId}/values/${enc("Summary!E3:E3")}`, {
            method: "PUT", query: { valueInputOption: "USER_ENTERED" },
            body: { values: [["=QUERY(Transactions!A:P,\"select N,sum(C) where D='Credit' and L<>'Flagged' and N is not null group by N order by N desc label N 'Month', sum(C) 'Received'\",1)"]] }
        });
    }
    forget(sheetId);
    return ids;
}

/** Every data row of a tab as arrays of cells; row 1 (headers) is skipped. rows[i] is sheet row i + 2. */
async function readRows(sheetId, tab = "Transactions") {
    const key = `${sheetId}|${tab}`, hit = cache.get(key);
    if (hit && Date.now() - hit.at < 45000) return hit.rows;
    const res = await call(`/${sheetId}/values/${enc(`${tab}!A2:${LAST_COL}`)}`, { query: { valueRenderOption: "UNFORMATTED_VALUE" } });
    const rows = (res.values || []).map((r) => Array.from({ length: HEADERS.length }, (_, i) => (r[i] === undefined ? "" : r[i])));
    cache.set(key, { at: Date.now(), rows });
    return rows;
}

async function appendRows(sheetId, tab, rows) {
    if (!rows.length) return;
    await call(`/${sheetId}/values/${enc(`${tab}!A:${LAST_COL}`)}:append`, { method: "POST", query: { valueInputOption: "RAW", insertDataOption: "INSERT_ROWS" }, body: { values: rows } });
    forget(sheetId);
}

const colLetter = (i) => String.fromCharCode(65 + i);
/** updates: [{ tab, row (sheet row number), col (0-based), value }] */
async function updateCells(sheetId, updates) {
    if (!updates.length) return;
    await call(`/${sheetId}/values:batchUpdate`, { method: "POST", body: { valueInputOption: "RAW", data: updates.map((u) => ({ range: `${u.tab}!${colLetter(u.col)}${u.row}`, values: [[u.value]] })) } });
    forget(sheetId);
}

/** Empties every data row of a tab (the header row stays). */
async function clearTab(sheetId, tab) {
    await call(`/${sheetId}/values/${enc(`${tab}!A2:${LAST_COL}`)}:clear`, { method: "POST", body: {} });
    forget(sheetId);
}

/** rowNumbers: sheet row numbers (>= 2) to remove from a tab. */
async function deleteRows(sheetId, tab, rowNumbers) {
    if (!rowNumbers.length) return;
    const ids = await tabIds(sheetId);
    if (ids[tab] === undefined) return;
    const sorted = [...new Set(rowNumbers)].filter((n) => n >= 2).sort((a, b) => b - a);
    await call(`/${sheetId}:batchUpdate`, { method: "POST", body: { requests: sorted.map((n) => ({ deleteDimension: { range: { sheetId: ids[tab], dimension: "ROWS", startIndex: n - 1, endIndex: n } } })) } });
    forget(sheetId);
}

module.exports = { ready, serviceEmail, parseSheetId, ensureLayout, readRows, appendRows, updateCells, deleteRows, clearTab, forget, HEADERS, TABS };
