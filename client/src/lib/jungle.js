/* Jungle scene: pure helpers. Day (light theme) and night (dark theme) have their own animals; robots join in. */

export const rand = (min, max, rng = Math.random) => min + rng() * (max - min);
const pick = (list, rng) => list[Math.floor(rng() * list.length) % list.length];

/** Grass blades for an SVG 1000 units wide and 60 high. */
export function grassBlades(count = 90, rng = Math.random) {
  return Array.from({ length: count }, (_, i) => {
    const x = Math.round((1000 / count) * i + rand(-4, 4, rng));
    return {
      x: Math.max(0, Math.min(1000, x)),
      h: Math.round(rand(22, 58, rng)),
      w: Math.round(rand(5, 11, rng)),
      bend: Math.round(rand(-14, 14, rng)),
      tone: Math.floor(rng() * 3),      // 0..2: three greens
      sway: Math.floor(rng() * 4),      // 0..3: four sway speeds
    };
  });
}

/* Who walks along the grass and who flies over. A rider sits on top (a robot riding an elephant, and so on). */
export const CAST = {
  day: {
    walkers: [
      { emoji: "🐘", size: 54, rider: "🤖" }, { emoji: "🦒", size: 64 }, { emoji: "🐅", size: 46 },
      { emoji: "🦓", size: 46 }, { emoji: "🐒", size: 38 }, { emoji: "🦏", size: 50, rider: "🤖" }, { emoji: "🤖", size: 34, robot: true },
    ],
    flyers: [{ emoji: "🦜", size: 32 }, { emoji: "🐦", flock: 5, size: 20 }, { emoji: "🦋", size: 24 }, { emoji: "🤖", size: 30, robot: true }],
  },
  night: {
    walkers: [
      { emoji: "🐆", size: 46 }, { emoji: "🐺", size: 42 }, { emoji: "🐸", size: 28, hop: true }, { emoji: "🦔", size: 30 },
      { emoji: "🐘", size: 54, rider: "🤖" }, { emoji: "🤖", size: 34, robot: true },
    ],
    flyers: [{ emoji: "🦇", flock: 4, size: 22 }, { emoji: "🦉", size: 30 }, { emoji: "🤖", size: 30, robot: true }],
  },
};

/** One actor crossing the screen. kind: "walker" | "flyer"; mode: "day" | "night". */
export function makeActor(kind, mode, rng = Math.random) {
  const cast = (CAST[mode] || CAST.day)[kind === "flyer" ? "flyers" : "walkers"];
  const a = pick(cast, rng);
  return {
    ...a,
    kind,
    fromLeft: rng() < 0.5,
    seconds: Math.round(kind === "flyer" ? rand(12, 20, rng) : rand(24, 40, rng)),
    top: kind === "flyer" ? Math.round(rand(12, 38, rng)) : null, // % from the top for flyers
  };
}

/** Wait before the next actor of this kind. */
export const nextDelay = (kind, rng = Math.random) => Math.round(kind === "flyer" ? rand(9000, 18000, rng) : rand(12000, 26000, rng));

/** Floating lights: butterflies by day, fireflies by night. */
export function floaters(count = 8, rng = Math.random) {
  return Array.from({ length: count }, () => ({
    left: Math.round(rand(3, 97, rng)), bottom: Math.round(rand(6, 40, rng)),
    dx: Math.round(rand(-60, 60, rng)), dy: Math.round(rand(-70, -20, rng)),
    seconds: Math.round(rand(6, 12, rng)), delay: Math.round(rand(0, 6000, rng)),
  }));
}

export const modeFor = (theme) => (theme === "light" ? "day" : "night");
