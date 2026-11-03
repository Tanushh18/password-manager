/*
 * The live-location link: a secret address anybody can open (no login) to see where chosen family phones are right now.
 *
 *   GET  /home/share              signed in   the link settings
 *   PUT  /home/share              signed in   { enabled, phones: [ids], rotate }
 *   GET  /public/live/:token      public      JSON: the people and their positions (CORS open; no cookies needed)
 *   GET  /live/:token             public      a web page with a map that updates itself
 *
 * The address holds a 192-bit random token, so it cannot be guessed; whoever has it can see the chosen phones, so it can be switched off
 * or replaced ("new link") at any time. The JSON never contains device ids, tokens, Wi-Fi or health data (utils/liveShare.js).
 */
const express = require("express");
const crypto = require("crypto");
const cors = require("cors");
const mongoose = require("mongoose");
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");
const HomeDevice = require("../models/homeDevice");
const HomeSettings = require("../models/homeSettings");
const automation = require("../utils/homeAutomation");
const share = require("../utils/liveShare");

const router = express.Router();
const publicLimiter = rateLimit({ windowMs: 60 * 1000, max: 90, message: "Too many requests. Slow down." });
const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: "Too many changes. Slow down." });
const openCors = cors({ origin: true, methods: ["GET"] });

const publicBase = (req) => (process.env.PUBLIC_API_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
const settingsView = (s, req) => {
    const x = (s && s.share) || {};
    const base = publicBase(req);
    return {
        enabled: x.enabled === true && Boolean(x.token), phones: Array.isArray(x.phones) ? x.phones : [],
        page: x.token ? `${base}/live/${x.token}` : "", api: x.token ? `${base}/public/live/${x.token}` : "",
        createdAt: x.createdAt || null, lastViewAt: x.lastViewAt || null
    };
};

router.get("/home/share", authenticate, async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        const s = await automation.settingsOf(req.rootUser._id);
        return res.json({ ok: true, share: settingsView(s, req) });
    } catch (e) { return res.status(500).json({ error: "Could not load the live link." }); }
});

router.put("/home/share", authenticate, writeLimiter, async (req, res) => {
    try {
        const owner = req.rootUser._id;
        const s = await automation.settingsOf(owner);
        const cur = { ...(s.share || {}) };
        const b = req.body || {};
        if (b.rotate === true || (b.enabled === true && !cur.token)) { cur.token = share.newToken(); cur.createdAt = new Date().toISOString(); cur.lastViewAt = null; }
        if (typeof b.enabled === "boolean") cur.enabled = b.enabled;
        if (Array.isArray(b.phones)) cur.phones = b.phones.map(String).filter((id) => mongoose.isValidObjectId(id)).slice(0, 12);
        await HomeSettings.updateOne({ owner }, { $set: { share: cur } });
        return res.json({ ok: true, share: settingsView({ share: cur }, req) });
    } catch (e) { return res.status(500).json({ error: "Could not save the live link." }); }
});

const lastWrite = new Map();   // token -> ms of the last lastViewAt/liveUntil write (once a minute is enough)
async function load(token, now) {
    if (!share.looksLikeToken(token)) return null;
    const s = await HomeSettings.findOne({ "share.token": token, "share.enabled": true }).lean();
    if (!s) return null;
    // an equal-length constant-time comparison, so the answer does not depend on how much of a guess was right
    const a = Buffer.from(String(s.share.token)), c = Buffer.from(token);
    if (a.length !== c.length || !crypto.timingSafeEqual(a, c)) return null;
    const only = new Set((s.share.phones || []).map(String));
    const phones = (await HomeDevice.find({ owner: s.owner, kind: "phone" }).lean())
        .filter((p) => p.status && p.status.agent === "stashr-where" && (only.size === 0 || only.has(String(p._id)))).slice(0, 12);
    if (!lastWrite.has(token) || now - lastWrite.get(token) > 60000) {
        lastWrite.set(token, now);
        if (lastWrite.size > 500) lastWrite.clear();
        // keep the phones reporting every few seconds while somebody is looking
        await HomeSettings.updateOne({ owner: s.owner }, { $set: { "share.lastViewAt": new Date(now).toISOString(), liveUntil: new Date(now + 2 * 60 * 1000) } }).catch(() => {});
    }
    return { settings: s, phones };
}

router.get("/public/live/:token", publicLimiter, openCors, async (req, res) => {
    res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" });
    try {
        const now = Date.now();
        const got = await load(req.params.token, now);
        if (!got) return res.status(404).json({ error: "This link is switched off or does not exist." });
        return res.json({ ok: true, now, people: share.peopleView(got.phones, got.settings, now) });
    } catch (e) { return res.status(500).json({ error: "Could not load the location." }); }
});

const PAGE = (nonce) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Live location</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style nonce="${nonce}">
html,body{margin:0;height:100%;font-family:system-ui,sans-serif;background:#0f1a17;color:#eef}
#map{position:absolute;inset:0 0 150px 0}
#bar{position:absolute;left:0;right:0;bottom:0;height:150px;overflow:auto;background:#10201c;border-top:1px solid #2a4a42;padding:8px 12px;box-sizing:border-box}
.p{padding:6px 0;border-bottom:1px solid #1e332d;font-size:14px}.p b{font-size:15px}.p small{color:#9bb;display:block}
.p a{color:#6fe0c4}#st{color:#9bb;font-size:12px}
</style></head><body><div id="map"></div><div id="bar"><div id="st">Loading…</div><div id="list"></div></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" nonce="${nonce}"></script>
<script nonce="${nonce}">
var token = location.pathname.split("/").pop();
var map = L.map("map").setView([20.59, 78.96], 5);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
var marks = {}, fitted = false;
function ago(s){ return s < 60 ? s + " s ago" : s < 3600 ? Math.round(s / 60) + " min ago" : Math.round(s / 3600) + " h ago"; }
function row(p){
  var d = document.createElement("div"); d.className = "p";
  var b = document.createElement("b"); b.textContent = p.name; d.appendChild(b);
  var s = document.createElement("small");
  s.textContent = p.hasPosition ? [p.where, ago(p.ageSec), "±" + p.acc + " m", p.speedKmh != null ? p.speedKmh + " km/h" : "", p.battery != null ? p.battery + "%" : ""].filter(Boolean).join(" · ") : "No position yet";
  d.appendChild(s);
  if (p.hasPosition) { var a = document.createElement("a"); a.target = "_blank"; a.rel = "noopener"; a.textContent = "Open in Maps"; a.href = "https://www.google.com/maps?q=" + p.lat + "," + p.lon; d.appendChild(a); }
  return d;
}
function draw(people){
  var list = document.getElementById("list"); list.textContent = "";
  var pts = [], seen = {};
  people.forEach(function(p){
    list.appendChild(row(p));
    if (!p.hasPosition) return;
    seen[p.name] = 1; pts.push([p.lat, p.lon]);
    var m = marks[p.name];
    if (!m) { m = marks[p.name] = { dot: L.circleMarker([p.lat, p.lon], { radius: 9, color: "#fff", weight: 2, fillColor: "#0d6e5c", fillOpacity: 1 }).addTo(map), acc: L.circle([p.lat, p.lon], { radius: p.acc, color: "#0d6e5c", weight: 1, fillOpacity: 0.1 }).addTo(map) }; m.dot.bindTooltip(p.name, { permanent: true, direction: "top", offset: [0, -8] }); }
    else { m.dot.setLatLng([p.lat, p.lon]); m.acc.setLatLng([p.lat, p.lon]); m.acc.setRadius(p.acc); }
  });
  Object.keys(marks).forEach(function(n){ if (!seen[n]) { map.removeLayer(marks[n].dot); map.removeLayer(marks[n].acc); delete marks[n]; } });
  if (pts.length && !fitted) { fitted = true; if (pts.length === 1) map.setView(pts[0], 16); else map.fitBounds(pts, { padding: [40, 40], maxZoom: 16 }); }
}
function tick(){
  fetch("/public/live/" + token, { cache: "no-store" }).then(function(r){ return r.json().then(function(j){ return { ok: r.ok, j: j }; }); }).then(function(x){
    if (!x.ok) { document.getElementById("st").textContent = x.j.error || "Not available."; return; }
    document.getElementById("st").textContent = "Live · updated " + new Date(x.j.now).toLocaleTimeString();
    draw(x.j.people);
  }).catch(function(){ document.getElementById("st").textContent = "Reconnecting…"; });
}
tick(); setInterval(tick, 5000);
</script></body></html>`;

router.get("/live/:token", publicLimiter, (req, res) => {
    const nonce = crypto.randomBytes(16).toString("base64");
    res.set({
        "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "origin",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}' https://unpkg.com; style-src 'nonce-${nonce}' https://unpkg.com; img-src data: https://tile.openstreetmap.org https://unpkg.com; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
    });
    // the page itself shows nothing private; the data comes from /public/live/:token, which checks the secret
    res.type("html").send(PAGE(nonce));
});

module.exports = router;
