import { robotMood } from "./robots.js";

/* The Robot Floor: each server is a robot running between its job inbox and its server rack.
   The busier the server (CPU) the faster it runs and the more crates it carries; RAM swells its belly and fills the memory bar. */

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Seconds for one trip across the floor: 10 s when idle down to 2.2 s flat out. */
export function paceSeconds(cpu, mood) {
  if (mood === "fire" || mood === "angry") return 2.2;
  const c = num(cpu);
  if (c == null) return 7;
  return Math.round((10 - Math.min(100, Math.max(0, c)) * 0.078) * 10) / 10;
}

/** What the robot is doing: running, burning (running scared), sleeping, down or deploying. */
export function laneState(mood) {
  if (mood === "sleeping") return "sleeping";
  if (mood === "dead") return "down";
  if (mood === "transforming") return "deploying";
  if (mood === "fire" || mood === "angry") return "burning";
  return "running";
}

/** Crates carried: one per ~35% of CPU, up to 3 (a stack means the server has a lot of work). */
export const cratesFor = (cpu) => (num(cpu) == null ? 0 : Math.min(3, Math.floor(cpu / 35) + (cpu > 4 ? 1 : 0)));

/** Memory level and a one-line note in the app's Hinglish voice. */
export function memoryNote(memory) {
  const m = num(memory);
  if (m == null) return { level: "unknown", note: "RAM ka data nahi" };
  if (m >= 90) return { level: "full", note: "Memory bhar gayi! 🧠 restart ya upgrade socho" };
  if (m >= 75) return { level: "heavy", note: "RAM bhari ho rahi hai, nazar rakho" };
  if (m >= 50) return { level: "ok", note: "RAM theek-thaak" };
  return { level: "light", note: "RAM halka hai" };
}

/** bots: results of botFor() (RobotArmy). incidentKeys: Set of service keys with an open incident. */
export function lanesFromBots(bots, incidentKeys) {
  const has = (k) => Boolean(incidentKeys && (incidentKeys.has ? incidentKeys.has(k) : false));
  return bots.map((b) => {
    const mood = b.stats.mood;
    return {
      key: b.key, name: b.s.name, mood, face: b.stats.face, title: b.stats.title, line: b.stats.line, hp: b.stats.hp, load: b.stats.load,
      cpu: num(b.last?.cpu), memory: num(b.last?.memory), latency: num(b.last?.latency),
      deploy: b.last?.deploy?.status ? String(b.last.deploy.status).replace(/_/g, " ") : "",
      incident: has(b.key), state: laneState(mood), pace: paceSeconds(b.last?.cpu, mood), crates: cratesFor(b.last?.cpu), mem: memoryNote(b.last?.memory),
    };
  });
}

/** A fixed demo fleet so the floor is never empty (and can be shown without any server connected). */
export function demoLanes(now = Date.now()) {
  const specs = [
    { name: "api-gateway", cpu: 38, memory: 52, latency: 120, health: "healthy" },
    { name: "worker-queue", cpu: 78, memory: 71, latency: 340, health: "healthy", deployStatus: "build_in_progress" },
    { name: "image-resizer", cpu: 93, memory: 94, latency: 900, health: "healthy" },
    { name: "cron-runner", cpu: 6, memory: 31, latency: 90, health: "healthy" },
    { name: "legacy-admin", suspended: true },
    { name: "payments-hook", health: "unhealthy", verdict: "down", cpu: 2, memory: 40, latency: null },
  ];
  return specs.map((sp, i) => {
    const stats = robotMood({ name: sp.name, suspended: sp.suspended, verdict: sp.verdict, health: sp.health, deployStatus: sp.deployStatus, cpu: sp.cpu, memory: sp.memory, latency: sp.latency, now });
    return {
      key: "demo-" + i, name: sp.name, mood: stats.mood, face: stats.face, title: stats.title, line: stats.line, hp: stats.hp, load: stats.load,
      cpu: sp.cpu ?? null, memory: sp.memory ?? null, latency: sp.latency ?? null, deploy: i === 1 ? "build in progress" : "live",
      incident: sp.name === "payments-hook", state: laneState(stats.mood), pace: paceSeconds(sp.cpu, stats.mood), crates: cratesFor(sp.cpu), mem: memoryNote(sp.memory), demo: true,
    };
  });
}
