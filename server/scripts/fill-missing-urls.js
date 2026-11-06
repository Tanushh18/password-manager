/*
 * Fills blank URLs on one account's login items from URLs already in the DB.
 *   node scripts/fill-missing-urls.js <email> [--apply]
 * Sources, in order: a URL typed into username/notes, a domain-like name, other vault items whose site matches the name,
 * then project links (live/repo/hosting). Backs up the raw encrypted docs to ~/stashr-backups first (kept forever);
 * writes go through User.sealEntry (encrypted).
 */
const fs = require("fs"), os = require("os"), path = require("path");
const mongoose = require("mongoose");
require("dotenv").config({ path: path.join(__dirname, "..", "config.env"), quiet: true });
const User = require("../models/schema");
const email = process.argv[2]; const APPLY = process.argv.includes("--apply");
const toHost = (u) => { try { return new URL(/^[a-z]+:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
const labelOf = (h) => { const p = h.split("."); return (p.length > 2 && p[p.length - 2].length <= 3 ? p[p.length - 3] : p[Math.max(0, p.length - 2)] || h); };
const squash = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const urlIn = (s) => (String(s || "").match(/https?:\/\/[^\s"']+/i) || [])[0];
const isLogin = (i) => !i.broken && i.enc !== "e2e" && i.enc !== "cbc" && (i.type || "login") === "login";

(async () => {
  await mongoose.connect(process.env.MONGO_URL);
  const user = await User.findOne({ email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
  const key = await user.getDataKey();
  const rows = user.passwords.map((doc) => ({ doc, it: User.publicEntry(doc, key) }));
  const logins = rows.filter((r) => isLogin(r.it));
  const withUrl = logins.filter((r) => String(r.it.url || "").trim());
  const projects = (user.projects || []).map((p) => User.publicEntry(p, key));
  // label -> most common url among vault items
  const byLabel = {};
  withUrl.filter((r) => /^(https?:\/\/)?[^/]*\./i.test(r.it.url) && !/^android:/i.test(r.it.url)).forEach((r) => { const h = toHost(r.it.url); if (!h) return; const l = squash(labelOf(h)); (byLabel[l] = byLabel[l] || {})[r.it.url] = ((byLabel[l] || {})[r.it.url] || 0) + 1; });
  const pick = (l) => { const o = byLabel[l]; return o ? Object.entries(o).sort((a, b) => b[1] - a[1])[0][0] : null; };
  const projUrls = projects.flatMap((p) => [p.liveUrl, p.customDomain, p.url, p.hostingUrl].filter(Boolean).map((u) => ({ name: p.name, u })));
  const aliases = { gmail: "google" };
  const found = [];
  for (const r of logins) {
    const it = r.it; if (String(it.url || "").trim()) continue;
    let url = null, src = "";
    const inUser = urlIn(it.username), inNotes = urlIn(it.notes);
    if (inUser) { url = inUser; src = "url typed in username (moved)"; }
    else if (inNotes) { url = inNotes; src = "url in notes"; }
    else if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(String(it.name || "").trim()) && !/^(com|org|net|in)\.[a-z0-9-]+\.[a-z0-9.-]+$/i.test(String(it.name).trim())) { url = `https://${it.name.trim()}`; src = "name is a domain"; }
    else {
      const n = squash(it.name); const cands = [aliases[n], n, ...n.split(/(?=[A-Z])/).map(squash)].filter(Boolean);
      for (const c of cands) { const m = pick(c); if (m) { url = /^https?:\/\//i.test(m) ? m : `https://${m}`; src = "same site elsewhere in vault"; break; } }
      if (!url) { const p = projUrls.find((x) => n.length >= 4 && squash(x.name) === n); if (p) { url = p.u; src = `project "${p.name}"`; } }
    }
    if (url) found.push({ r, url, src, moveUser: src.startsWith("url typed in username") });
  }
  let backup = null;
  if (APPLY && found.length) {
    const dir = path.join(os.homedir(), "stashr-backups"); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    backup = path.join(dir, `vault-${email}-urlfill-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(backup, JSON.stringify({ email, at: new Date(), passwords: user.toObject().passwords }), { mode: 0o600 });
    const now = new Date();
    for (const f of found) {
      const next = { ...f.r.it }; delete next._id; delete next.createdAt; delete next.updatedAt; delete next.enc;
      next.url = f.url; if (f.moveUser) next.username = "";
      await User.updateOne({ _id: user._id, "passwords._id": f.r.doc._id }, { $set: { "passwords.$.enc": "udk", "passwords.$.data": User.sealEntry(key, next), "passwords.$.updatedAt": now } });
    }
  }
  console.log(`mode ${APPLY ? "APPLIED" : "DRY RUN"}${backup ? "\nbackup " + backup : ""}\nblank ${logins.length - withUrl.length}, fillable ${found.length}`);
  found.forEach((f) => console.log(` - ${JSON.stringify(f.r.it.name || "(no name)")} -> ${f.url}  [${f.src}]`));
  console.log("\nstill blank:");
  logins.filter((r) => !String(r.it.url || "").trim() && !found.some((f) => f.r === r)).forEach((r) => console.log(` - ${JSON.stringify(r.it.name || "(no name)")}`));
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
