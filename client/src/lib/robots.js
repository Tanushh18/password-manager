/*
 * Pure: turns a server's live numbers into a robot's mood, health points and a one-line status in Hinglish.
 * Every mood maps to something you can act on (down -> logs, fire -> scale/restart, sleeping -> resume).
 */

const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pct = (v) => Math.round(v) + "%";
const pick = (list, seed) => list[Math.abs(hash(seed)) % list.length];
function hash(text) {
  let h = 0;
  for (const ch of String(text || "")) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}

export const MOODS = {
  sleeping: { face: "😴", tone: "sleep", title: "So raha hai" },
  dead: { face: "💀", tone: "dead", title: "Gir gaya" },
  transforming: { face: "⚡", tone: "deploy", title: "Transform ho raha hai" },
  fire: { face: "🔥", tone: "fire", title: "Aag lagi hai" },
  sweaty: { face: "😅", tone: "warm", title: "Pasina aa raha hai" },
  chill: { face: "😎", tone: "chill", title: "Ekdum chill" },
  confused: { face: "🤔", tone: "idle", title: "Pata nahi" },
  celebrating: { face: "🥳", tone: "party", title: "Party chal rahi hai" },
  starstruck: { face: "🤩", tone: "star", title: "Ekdum top form" },
  bored: { face: "😐", tone: "bored", title: "Bore ho raha hai" },
  tired: { face: "🥱", tone: "tired", title: "Thak gaya hai" },
  angry: { face: "😠", tone: "angry", title: "Gussa hai" },
  scared: { face: "😨", tone: "scared", title: "Dara hua hai" },
  dizzy: { face: "😵‍💫", tone: "dizzy", title: "Chakkar aa rahe hain" }
};

const LINES = {
  sleeping: ["{name} so raha hai 😴 Suspend hai, uthana ho to switch on karo.", "Shhh… {name} aaram kar raha hai. Bill bhi nahi aa raha 😌"],
  dead: ["Bhai {name} gir gaya 💀 {why} — logs dekho jaldi!", "{name} ne jawab dena band kar diya 😵 {why}"],
  transforming: ["{name} transform ho raha hai ⚡ naya deploy aa raha hai!", "Hold on… {name} nayi body pehen raha hai 🦾 ({deploy})"],
  fire: ["Bhai, {name} ki halat kharab hai 💀 {load}!", "{name} chilla raha hai 😱 {load} — restart ya plan upgrade socho."],
  sweaty: ["{name} ko thoda pasina aa raha hai 😅 {load}", "{name} mehnat kar raha hai 💪 {load}"],
  chill: ["{name} ekdum chill 😎 {speed}", "{name} mast chal raha hai ✨ {speed}"],
  confused: ["{name} ka abhi check nahi hua 🤔 Monitoring on karo to mood dikhega.", "{name} chup-chaap khada hai… data ka intezaar 📡"],
  celebrating: ["{name} naya deploy le aaya 🥳 sab green, party!", "Deploy live ho gaya 🎉 {name} naach raha hai!"],
  starstruck: ["{name} ekdum top form mein 🤩 {speed}", "Wah! {name} rocket ki tarah chal raha hai 🚀 {speed}"],
  bored: ["{name} bore ho raha hai 😐 load sirf {loadPct}. Koi request bhejo!", "{name} khaali baitha hai… ☕ load {loadPct}"],
  tired: ["{name} thak gaya hai 🥱 jawab dene mein {latency} lag rahe hain.", "{name} dheema chal raha hai 🐢 {latency} latency"],
  angry: ["{name} gusse mein hai 😠 naya deploy fail hua — purana version chal raha hai.", "Deploy fail! 💢 {name} ab bhi purane code pe hai, build logs dekho."],
  scared: ["{name} dara hua hai 😨 {scare}", "{name} kaanp raha hai 🫨 {scare}"],
  dizzy: ["{name} ko chakkar aa rahe hain 😵‍💫 RAM {mem} — memory leak to nahi?", "{name} ki memory bhar gayi 🌀 RAM {mem}"]
};

/**
 * input: { name, suspended, verdict, health, deployStatus, cpu, memory, latency }
 * returns { mood, face, tone, title, hp (0-100 or null), load (0-100 or null), line }
 */
export function robotMood(input = {}) {
  const name = input.name || "Server";
  const cpu = n(input.cpu), memory = n(input.memory), latency = n(input.latency);
  const load = cpu == null && memory == null ? null : Math.max(cpu ?? 0, memory ?? 0);
  const deploy = String(input.deployStatus || "");
  const deploying = /in_progress|deploying|building/.test(deploy) || input.verdict === "deploying";
  const healthDown = input.verdict === "down" || ["unhealthy", "timeout"].includes(input.health);
  const deployFailed = /failed/.test(deploy);
  const up = input.health === "healthy" || input.verdict === "up";
  const deployAge = input.deployAt ? (input.now ?? Date.now()) - Date.parse(input.deployAt) : null;
  const fresh = deployAge != null && deployAge >= 0 && deployAge < 30 * 60 * 1000 && deploy === "live";

  // Health points: what is left of the robot. Load and slow answers both cost HP.
  const latencyCost = latency == null ? 0 : Math.min(30, latency / 60);
  const rawHp = load != null || latency != null || up ? Math.max(1, Math.round(100 - (load ?? 0) * 0.7 - latencyCost)) : null;

  // The first matching emotion wins; each one points at something you can act on.
  let mood;
  if (input.suspended) mood = "sleeping";
  else if (deploying) mood = "transforming";
  else if (healthDown) mood = "dead";
  else if (deployFailed) mood = "angry";
  else if (input.verdict === "suspect" || input.incident) mood = "scared";
  else if (load != null && cpu != null && cpu >= 85) mood = "fire";
  else if (memory != null && memory >= 90) mood = "dizzy";
  else if (load != null && load >= 85) mood = "fire";
  else if (load != null && load >= 60) mood = "sweaty";
  else if (latency != null && latency >= 1500) mood = "tired";
  else if (fresh && (up || load != null)) mood = "celebrating";
  else if (rawHp != null && rawHp >= 95 && latency != null && latency <= 250) mood = "starstruck";
  else if (load != null && load < 3 && (up || latency != null)) mood = "bored";
  else if (up || load != null) mood = "chill";
  else mood = "confused";

  const hp = mood === "dead" ? 0 : mood === "sleeping" ? null : rawHp;
  const loadText = [cpu != null ? "CPU " + pct(cpu) : "", memory != null ? "RAM " + pct(memory) : ""].filter(Boolean).join(", ") || "load high";
  const why = deployFailed ? "deploy bhi fail hua" : input.health === "timeout" ? "timeout ho raha hai" : "health check fail";
  const scare = input.verdict === "suspect" ? "pehla health check fail hua, dobara check ho raha hai." : "ek incident khula hai, dekh lo.";
  const line = pick(LINES[mood], name + mood)
    .replace("{name}", name).replace("{load}", loadText).replace("{why}", why).replace("{scare}", scare)
    .replace("{loadPct}", load != null ? pct(load) : "0%").replace("{mem}", memory != null ? pct(memory) : "--")
    .replace("{latency}", latency != null ? Math.round(latency) + " ms" : "bahut der")
    .replace("{deploy}", deploy ? deploy.replace(/_/g, " ") : "deploy")
    .replace("{speed}", latency != null ? Math.round(latency) + " ms mein jawab." : load != null ? "load sirf " + pct(load) + "." : "sab theek.");
  return { mood, ...MOODS[mood], hp, load, line };
}

/** Services page: a bot per app whose mood follows its most-used provider limit. */
export function usageMood({ name, percent, status, errors = 0, tracked = 0 }) {
  let mood;
  if (errors && !tracked) mood = "dead";
  else if (percent == null) mood = tracked ? "chill" : "confused";
  else if (percent >= 90 || status === "critical") mood = "fire";
  else if (percent >= 70 || status === "warn") mood = "sweaty";
  else mood = "chill";
  const lines = {
    fire: (name || "App") + " ka limit khatam hone wala hai 🔥 " + Math.round(percent ?? 100) + "% use ho gaya!",
    sweaty: (name || "App") + " limit ke paas ja raha hai 😅 " + Math.round(percent ?? 0) + "%",
    chill: (name || "App") + " aaram se hai 😎 " + (percent != null ? "sirf " + Math.round(percent) + "% use hua." : "sab limits ke andar."),
    dead: (name || "App") + " ki usage padh nahi paaye 💀 keys check karo.",
    confused: (name || "App") + " ki usage ka data abhi nahi hai 🤔"
  };
  return { mood, ...MOODS[mood], hp: percent == null ? null : Math.max(0, Math.round(100 - percent)), load: percent ?? null, line: lines[mood] };
}

/* ───────────── Telemetry: the numbers behind each robot, shaped like a HUD readout ───────────── */

const finite = (list) => list.filter((v) => typeof v === "number" && Number.isFinite(v));
const pctile = (list, p) => {
  const xs = finite(list).sort((a, b) => a - b);
  if (!xs.length) return null;
  return xs[Math.min(xs.length - 1, Math.max(0, Math.ceil((p / 100) * xs.length) - 1))];
};
const avg = (list) => { const xs = finite(list); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
const TYPE_CODE = { web_service: "WEB", private_service: "PRV", background_worker: "WRK", cron_job: "CRN", static_site: "STC", postgres: "PSQL", redis: "KV", key_value: "KV" };
const REGION_CODE = { oregon: "ORE", ohio: "OHI", virginia: "VIR", frankfurt: "FRA", singapore: "SGP" };
const THREAT = { sleeping: "OFFLINE", dead: "CRITICAL", fire: "CRITICAL", angry: "DEGRADED", scared: "WARNING", dizzy: "ELEVATED", transforming: "UPDATING", sweaty: "ELEVATED", tired: "ELEVATED", chill: "NOMINAL", celebrating: "NOMINAL", starstruck: "OPTIMAL", bored: "IDLE", confused: "UNKNOWN" };

const ledTone = (v, warn, hot) => (v == null ? "off" : v >= hot ? "bad" : v >= warn ? "mid" : "ok");
const ago = (ms) => (ms < 3600e3 ? Math.max(1, Math.round(ms / 60e3)) + "m" : ms < 86400e3 ? Math.round(ms / 3600e3) + "h" : Math.round(ms / 86400e3) + "d");

/**
 * input: { id, type, region, mood, last: { cpu, memory, latency, status, deploy }, points: [{ cpu, memory, latency }], now }
 * returns a HUD readout: unit id, class code, threat level, status LEDs, trend figures and three terminal lines.
 */
export function telemetry({ id = "", type = "", region = "", mood = "confused", last = null, points = [], now = Date.now() } = {}) {
  const cpu = last?.cpu ?? null, memory = last?.memory ?? null, latency = last?.latency ?? null;
  const cpuAvg = avg(points.map((p) => p.cpu)), cpuPeak = pctile(points.map((p) => p.cpu), 100);
  const memPeak = pctile(points.map((p) => p.memory), 100);
  const p50 = pctile(points.map((p) => p.latency), 50), p95 = pctile(points.map((p) => p.latency), 95);
  const deploy = last?.deploy || null;
  const deployedMs = deploy?.createdAt ? now - Date.parse(deploy.createdAt) : null;
  const trend = (() => {
    const xs = finite(points.map((p) => p.cpu));
    if (xs.length < 4) return "";
    const half = Math.floor(xs.length / 2);
    const a = avg(xs.slice(0, half)), b = avg(xs.slice(half));
    return b - a > 5 ? "▲" : a - b > 5 ? "▼" : "▬";
  })();
  const deployTone = !deploy?.status ? "off" : /failed/.test(deploy.status) ? "bad" : /progress/.test(deploy.status) ? "mid" : deploy.status === "live" ? "ok" : "mid";
  const offline = mood === "sleeping";
  const leds = [
    { id: "PWR", tone: offline ? "off" : mood === "dead" ? "bad" : "ok", label: offline ? "suspended" : mood === "dead" ? "down" : "on" },
    { id: "NET", tone: offline ? "off" : mood === "dead" ? "bad" : ledTone(latency, 800, 1500), label: latency == null ? "no data" : Math.round(latency) + " ms" },
    { id: "CPU", tone: offline ? "off" : ledTone(cpu, 60, 85), label: cpu == null ? "no data" : Math.round(cpu) + "%" },
    { id: "MEM", tone: offline ? "off" : ledTone(memory, 70, 90), label: memory == null ? "no data" : Math.round(memory) + "%" },
    { id: "DPL", tone: deployTone, label: deploy?.status ? deploy.status.replace(/_/g, " ") : "no data" }
  ];
  const n = (v, unit = "%") => (v == null ? "--" : Math.round(v) + unit);
  const lines = offline
    ? ["> power: suspended · billing paused", "> resume to bring this unit back online"]
    : [
        "> cpu " + n(cpu) + (trend ? " " + trend : "") + " · avg " + n(cpuAvg) + " · peak " + n(cpuPeak),
        "> mem " + n(memory) + " · peak " + n(memPeak) + " · net " + n(latency, "ms") + (p95 != null ? " · p95 " + n(p95, "ms") : ""),
        "> deploy " + (deploy?.status ? deploy.status.replace(/_/g, " ") : "--") + (deployedMs != null && deployedMs >= 0 ? " · up " + ago(deployedMs) : "") + (last?.status ? " · http " + last.status : "")
      ];
  return {
    unit: "UNIT-" + (String(id).replace(/[^a-z0-9]/gi, "").slice(-4).toUpperCase() || "0000"),
    code: [TYPE_CODE[type] || "SRV", REGION_CODE[String(region).toLowerCase()] || (region ? String(region).slice(0, 3).toUpperCase() : "")].filter(Boolean).join("·"),
    threat: THREAT[mood] || "UNKNOWN", leds, lines, cpuAvg, cpuPeak, p50, p95, trend, samples: points.length
  };
}

/** Fleet-wide readout for the console above the army. bots: [{ stats: robotMood(...), last }] */
export function fleetTelemetry(bots) {
  const online = bots.filter((b) => b.stats.mood !== "sleeping");
  const hp = avg(online.map((b) => b.stats.hp));
  return {
    units: bots.length, online: online.length,
    integrity: hp == null ? null : Math.round(hp),
    cpu: avg(online.map((b) => b.last?.cpu)), memory: avg(online.map((b) => b.last?.memory)),
    p50: pctile(online.map((b) => b.last?.latency), 50),
    critical: bots.filter((b) => ["dead", "fire", "angry"].includes(b.stats.mood)).length,
    updating: bots.filter((b) => b.stats.mood === "transforming").length
  };
}
