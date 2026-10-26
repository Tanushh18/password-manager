/**
 * Password strength estimate (0-4). Same rules as server/utils/strength.js
 * and the Android app, so every surface shows the same verdict.
 */
const COMMON = new Set([
  "password", "123456", "12345678", "123456789", "qwerty", "abc123", "111111",
  "iloveyou", "admin", "welcome", "letmein", "monkey", "dragon", "football",
  "password1", "1234567", "sunshine", "princess", "000000", "qwerty123",
]);

export const LABELS = ["Very weak", "Weak", "Fair", "Strong", "Excellent"];

export function estimate(value) {
  const pwd = String(value || "");
  if (!pwd) return { score: 0, label: "Empty", bits: 0 };
  if (COMMON.has(pwd.toLowerCase())) return { score: 0, label: LABELS[0], bits: 0 };

  let pool = 0;
  if (/[a-z]/.test(pwd)) pool += 26;
  if (/[A-Z]/.test(pwd)) pool += 26;
  if (/[0-9]/.test(pwd)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pwd)) pool += 33;

  let bits = pwd.length * Math.log2(Math.max(pool, 1));
  if (/(.)\1{2,}/.test(pwd)) bits -= 10;
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|qwer|asdf)/i.test(pwd)) bits -= 10;

  const score = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  return { score, label: LABELS[score], bits: Math.max(0, Math.round(bits)) };
}

const SETS = {
  lower: "abcdefghijkmnopqrstuvwxyz",
  upper: "ABCDEFGHJKLMNPQRSTUVWXYZ",
  digits: "23456789",
  symbols: "!@#$%^&*-_=+?",
};

/** Uniform random integer in [0, n) via crypto.getRandomValues (rejection sampling, no modulo bias). */
function rand(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do { globalThis.crypto.getRandomValues(buf); } while (buf[0] >= limit);
  return buf[0] % n;
}

/** Cryptographically random password with at least one of each chosen set. */
export function generatePassword({ length = 18, symbols = true, digits = true, upper = true, lower = true } = {}) {
  const sets = [];
  if (lower) sets.push(SETS.lower);
  if (upper) sets.push(SETS.upper);
  if (digits) sets.push(SETS.digits);
  if (symbols) sets.push(SETS.symbols);
  if (!sets.length) sets.push(SETS.lower); // nothing chosen: fall back to lowercase
  const all = sets.join("");


  const chars = sets.map((set) => set[rand(set.length)]);
  while (chars.length < length) chars.push(all[rand(all.length)]);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = rand(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** Small built-in word list for passphrases (4-6 letters, easy to type). */
export const WORDS = (
  "amber anchor apple arbor arrow aspen atlas basin beacon birch bloom bridge brook cabin canal canopy cedar cliff cloud coast comet coral crane creek crest delta dune eagle ember fern field fjord flint forest frost garden geyser glade grove harbor hazel heron island ivory jade jungle kayak lagoon lantern larch ledge lemon lily lotus maple marsh meadow mesa mint moss night oasis ocean olive orbit orchid otter palm pebble pine planet plume pond prairie quartz rain rapids raven reef ridge river robin runway sage savanna shore sierra signal slate solar spruce stone storm summit swift terrace thunder tide timber trail tulip tundra valley vapor violet willow wind zephyr"
).split(" ");

/** Random passphrase from WORDS, e.g. "Cedar-river-7-orbit". */
export function generatePassphrase({ words = 4, separator = "-", capitalize = true, number = true } = {}) {
  const count = Math.min(10, Math.max(3, Math.round(words) || 4));
  const parts = Array.from({ length: count }, () => WORDS[rand(WORDS.length)]);
  if (capitalize) { const i = rand(count); parts[i] = parts[i][0].toUpperCase() + parts[i].slice(1); }
  if (number) parts.splice(rand(count + 1), 0, String(rand(90) + 10));
  return parts.join(separator);
}
