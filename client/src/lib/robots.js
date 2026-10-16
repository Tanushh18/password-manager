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
  confused: { face: "🤔", tone: "idle", title: "Pata nahi" }
};

const LINES = {
  sleeping: ["{name} so raha hai 😴 Suspend hai, uthana ho to switch on karo.", "Shhh… {name} aaram kar raha hai. Bill bhi nahi aa raha 😌"],
  dead: ["Bhai {name} gir gaya 💀 {why} — logs dekho jaldi!", "{name} ne jawab dena band kar diya 😵 {why}"],
  transforming: ["{name} transform ho raha hai ⚡ naya deploy aa raha hai!", "Hold on… {name} nayi body pehen raha hai 🦾 ({deploy})"],
  fire: ["Bhai, {name} ki halat kharab hai 💀 {load}!", "{name} chilla raha hai 😱 {load} — restart ya plan upgrade socho."],
  sweaty: ["{name} ko thoda pasina aa raha hai 😅 {load}", "{name} mehnat kar raha hai 💪 {load}"],
  chill: ["{name} ekdum chill 😎 {speed}", "{name} mast chal raha hai ✨ {speed}"],
  confused: ["{name} ka abhi check nahi hua 🤔 Monitoring on karo to mood dikhega.", "{name} chup-chaap khada hai… data ka intezaar 📡"]
};

/**
 * input: { name, suspended, verdict, health, deployStatus, cpu, memory, latency }
 * returns { mood, face, tone, title, hp (0-100 or null), load (0-100 or null), line }
 */
export function robotMood(input = {}) {
  const name = input.name || "Server";
  const cpu = n(input.cpu), memory = n(input.memory), latency = n(input.latency);
  const load = cpu == null && memory == null ? null : Math.max(cpu ?? 0, memory ?? 0);
  const deploying = /in_progress|deploying|building/.test(String(input.deployStatus || "")) || input.verdict === "deploying";
  const down = input.verdict === "down" || ["unhealthy", "timeout"].includes(input.health) || /failed/.test(String(input.deployStatus || ""));

  let mood;
  if (input.suspended) mood = "sleeping";
  else if (deploying) mood = "transforming";
  else if (down) mood = "dead";
  else if (load != null && load >= 85) mood = "fire";
  else if ((load != null && load >= 60) || (latency != null && latency >= 1500)) mood = "sweaty";
  else if (input.health === "healthy" || input.verdict === "up" || load != null) mood = "chill";
  else mood = "confused";

  // Health points: what is left of the robot. Load and slow answers both cost HP.
  let hp = null;
  if (mood === "dead") hp = 0;
  else if (mood !== "sleeping" && (load != null || latency != null || mood === "chill")) {
    const latencyCost = latency == null ? 0 : Math.min(30, latency / 60);
    hp = Math.max(1, Math.round(100 - (load ?? 0) * 0.7 - latencyCost));
  }

  const loadText = [cpu != null ? "CPU " + pct(cpu) : "", memory != null ? "RAM " + pct(memory) : ""].filter(Boolean).join(", ") || "load high";
  const why = input.deployStatus && /failed/.test(input.deployStatus) ? "deploy fail hua" : input.health === "timeout" ? "timeout ho raha hai" : "health check fail";
  const line = pick(LINES[mood], name + mood)
    .replace("{name}", name).replace("{load}", loadText).replace("{why}", why)
    .replace("{deploy}", String(input.deployStatus || "deploy").replace(/_/g, " "))
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
