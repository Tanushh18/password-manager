/* Fun effects: a tiny event bus plus the pure helpers the effects layer uses. The layer itself is Components/SkyFx. */

const listeners = new Set();
const lastAt = new Map();
export const MIN_GAP_MS = 700; // the same effect cannot fire twice within this time

export const fx = {
  /** Subscribe to effects; returns an unsubscribe function. */
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  /** Ask for an effect: "land" (plane lands), "boom" (explosion) or "robot" (a robot flies by). Never throws. */
  emit(type, detail = {}, now = Date.now()) {
    if (now - (lastAt.get(type) || 0) < MIN_GAP_MS) return false;
    lastAt.set(type, now);
    listeners.forEach((fn) => { try { fn({ type, ...detail }); } catch (e) { /* an effect must never break the app */ } });
    return true;
  },
  /** Test helper. */
  reset() { listeners.clear(); lastAt.clear(); },
};

export const rand = (min, max, rng = Math.random) => min + rng() * (max - min);

/** Delay before the next ambient effect of this kind, in milliseconds. */
export function nextDelay(kind, rng = Math.random) {
  if (kind === "plane") return Math.round(rand(50000, 95000, rng));
  return Math.round(rand(9000, 20000, rng)); // robot
}

/** Explosion sparks: angle in degrees, distance in px, size in px, a colour from fire tones, and a small stagger. */
const FIRE = ["#ff3b1d", "#ff7a00", "#ffc400", "#fff1a8", "#ff5e3a"];
export function sparks(count = 18, rng = Math.random) {
  return Array.from({ length: count }, (_, i) => ({
    angle: Math.round((360 / count) * i + rand(-9, 9, rng)),
    dist: Math.round(rand(46, 120, rng)),
    size: Math.round(rand(5, 12, rng)),
    color: FIRE[Math.floor(rng() * FIRE.length)],
    delay: Math.round(rand(0, 90, rng)),
  }));
}

/** Flight settings for one robot crossing the screen. */
export function robotFlight(rng = Math.random) {
  return {
    top: Math.round(rand(9, 46, rng)),            // % from the top
    size: Math.round(rand(34, 52, rng)),
    seconds: Math.round(rand(13, 22, rng)),
    fromLeft: rng() < 0.5,
    bob: Math.round(rand(10, 26, rng)),           // px of up/down wobble
    hue: Math.round(rand(160, 320, rng)),
  };
}
