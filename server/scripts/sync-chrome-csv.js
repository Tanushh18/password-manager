/*
 * Merge a Chrome password export (name,url,username,password,note) into one account's vault.
 *   node scripts/sync-chrome-csv.js <email> <csv>            dry run, prints a report (never prints passwords)
 *   node scripts/sync-chrome-csv.js <email> <csv> --apply    backs up, then writes
 * The backup is the account's raw (still encrypted) password documents, kept in ~/stashr-backups and never deleted.
 * Writes go through User.sealEntry, so everything stays encrypted with the account's data key.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
dotenv.config({ path: path.join(__dirname, "..", "config.env"), quiet: true });
const User = require("../models/schema");

const [email, csvPath] = process.argv.slice(2);
const APPLY = process.argv.includes("--apply");
if (!email || !csvPath) { console.error("usage: sync-chrome-csv.js <email> <csv> [--apply]"); process.exit(1); }

function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] || ""])));
}

const host = (u) => { try { return new URL(/^[a-z]+:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
const base = (h) => { const p = h.split("."); return p.length > 2 && p[p.length - 2].length <= 3 ? p.slice(-3, -2)[0] : p[Math.max(0, p.length - 2)] || h; };
const low = (s) => String(s || "").trim().toLowerCase();
const nameFrom = (h) => { const b = base(h); return b ? b[0].toUpperCase() + b.slice(1) : h; };
const hostOk = (h) => h && h.includes(".") && !/^\d+\.\d+/.test(h);

(async () => {
  const csvStat = fs.statSync(csvPath);
  const fileTime = csvStat.mtime;
  const rows = parseCsv(fs.readFileSync(csvPath, "utf8")).filter((r) => r.password || r.username || r.url);
  await mongoose.connect(process.env.MONGO_URL);
  const user = await User.findOne({ email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
  if (!user) { console.error("account not found"); process.exit(1); }
  const dataKey = await user.getDataKey();
  const entries = (user.passwords || []).map((e) => ({ doc: e, item: User.publicEntry(e, dataKey) }))
    .filter((x) => !x.item.broken && x.item.enc !== "e2e" && x.item.enc !== "cbc" && (x.item.type || "login") === "login");

  // Backup first (raw encrypted docs), kept forever.
  let backup = null;
  if (APPLY) {
    const dir = path.join(os.homedir(), "stashr-backups"); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    backup = path.join(dir, `vault-${email}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(backup, JSON.stringify({ email, at: new Date(), passwords: user.toObject().passwords }), { mode: 0o600 });
  }

  const used = new Set();
  const rep = { same: [], fileNewer: [], dbNewer: [], filled: [], added: [], dupRows: 0 };
  const seenKey = new Set();
  const updates = []; // { doc, fields }
  const adds = [];

  for (const r of rows) {
    const h = host(r.url); const u = low(r.username);
    const key = `${h}|${u}|${r.password}`; if (seenKey.has(key)) { rep.dupRows++; continue; } seenKey.add(key);
    const match = entries.find((x) => !used.has(x.doc._id) && low(x.item.username) === u && u &&
      ((h && host(x.item.url) === h) || (h && low(x.item.name) && (low(x.item.name).includes(base(h)) || base(h).includes(low(x.item.name).replace(/\s+/g, "")))))) ||
      entries.find((x) => !used.has(x.doc._id) && x.item.password === r.password && r.password && low(x.item.username) === u);
    const label = r.name || h || r.url || "(unnamed)";
    if (!match) {
      adds.push({ type: "login", name: (r.name && r.name.trim()) || (hostOk(h) ? nameFrom(h) : r.url), username: r.username, password: r.password,
        url: r.url, notes: r.note || "", totp: "", folder: "", favorite: false, passwordUpdatedAt: fileTime.toISOString(), deletedAt: null, history: [], fields: {} });
      rep.added.push(label); continue;
    }
    used.add(match.doc._id);
    const it = match.item; const next = { ...it }; let changed = false; const why = [];
    delete next._id; delete next.createdAt; delete next.updatedAt; delete next.enc;
    const fill = (k, v) => { if (v && !String(it[k] || "").trim()) { next[k] = v; changed = true; why.push(k); } };
    fill("name", (r.name && r.name.trim()) || (hostOk(h) ? nameFrom(h) : ""));
    fill("url", r.url); fill("username", r.username);
    if (r.note && !String(it.notes || "").trim()) fill("notes", r.note);
    const dbTime = new Date(it.passwordUpdatedAt || it.updatedAt || it.createdAt || 0);
    if (it.password !== r.password) {
      if (dbTime < fileTime) {
        next.history = [{ password: it.password, changedAt: dbTime.toISOString() }, ...(it.history || [])].slice(0, 5);
        next.password = r.password; next.passwordUpdatedAt = fileTime.toISOString(); changed = true; why.push("password");
        rep.fileNewer.push(`${label} (${r.username}) db ${dbTime.toISOString().slice(0, 10)}`);
      } else rep.dbNewer.push(`${label} (${r.username}) db ${dbTime.toISOString().slice(0, 10)}`);
    } else rep.same.push(label);
    if (changed) { updates.push({ doc: match.doc, fields: next }); if (!why.includes("password")) rep.filled.push(`${label}: ${why.join(",")}`); }
  }

  if (APPLY) {
    const now = new Date();
    for (const u of updates) {
      await User.updateOne({ _id: user._id, "passwords._id": u.doc._id }, { $set: { "passwords.$.enc": "udk", "passwords.$.data": User.sealEntry(dataKey, u.fields), "passwords.$.updatedAt": now } });
    }
    if (adds.length) {
      const docs = adds.map((f) => ({ _id: new mongoose.Types.ObjectId(), enc: "udk", data: User.sealEntry(dataKey, f), createdAt: now, updatedAt: now }));
      await User.updateOne({ _id: user._id }, { $push: { passwords: { $each: docs } } });
    }
  }

  console.log(`mode: ${APPLY ? "APPLIED" : "DRY RUN"}${backup ? `\nbackup: ${backup}` : ""}`);
  console.log(`csv rows ${rows.length} (dup rows skipped ${rep.dupRows}), vault logins ${entries.length}, csv file time ${fileTime.toISOString()}`);
  console.log(`identical ${rep.same.length} | password updated from file (db older) ${rep.fileNewer.length} | db newer, kept ${rep.dbNewer.length} | details filled ${rep.filled.length} | new from file ${rep.added.length}`);
  const sect = (t, a) => { console.log(`\n== ${t} (${a.length})`); a.forEach((x) => console.log(" -", x)); };
  sect("OLD in db, replaced with file password", rep.fileNewer);
  sect("db newer than file, kept db (file is old)", rep.dbNewer);
  sect("name/url/username filled", rep.filled);
  sect("only in file, added", rep.added);
  const left = entries.filter((x) => !used.has(x.doc._id)).length;
  console.log(`\nvault logins not in file: ${left}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
