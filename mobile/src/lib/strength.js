import * as Crypto from "expo-crypto";

/**
 * Password strength estimate (0-4). Same rules as the server
 * (server/utils/strength.js) and the website (client/src/utils/strength.js).
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

export const strengthColor = (theme, score) =>
  score <= 1 ? theme.danger : score === 2 ? theme.warn : theme.ok;

const SETS = {
  lower: "abcdefghijkmnopqrstuvwxyz",
  upper: "ABCDEFGHJKLMNPQRSTUVWXYZ",
  digits: "23456789",
  symbols: "!@#$%^&*-_=+?",
};

const WORDS = [
  "aurora", "velvet", "comet", "ember", "harbor", "lunar", "maple", "nimbus", "orbit", "prism",
  "quartz", "raven", "solar", "tidal", "umber", "vivid", "willow", "zephyr", "cobalt", "delta",
  "fable", "glacier", "hazel", "ivory", "jasper", "kiwi", "lotus", "meadow", "nova", "opal",
  "pixel", "quill", "ripple", "sierra", "tango", "ultra", "violet", "wander", "xenon", "yonder",
];

const randomInt = (n) => {
  const buf = new Uint32Array(1);
  Crypto.getRandomValues(buf);
  return buf[0] % n;
};

/** Cryptographically random password with at least one of each chosen set. */
export function generatePassword({ length = 18, upper = true, digits = true, symbols = true } = {}) {
  const sets = [SETS.lower];
  if (upper) sets.push(SETS.upper);
  if (digits) sets.push(SETS.digits);
  if (symbols) sets.push(SETS.symbols);
  const all = sets.join("");

  const chars = sets.map((set) => set[randomInt(set.length)]);
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** Memorable passphrase like "Comet-velvet-Orbit-42". */
export function generatePassphrase({ words = 4, separator = "-" } = {}) {
  const parts = Array.from({ length: words }, () => {
    const w = WORDS[randomInt(WORDS.length)];
    return randomInt(2) ? w[0].toUpperCase() + w.slice(1) : w;
  });
  parts.push(String(10 + randomInt(90)));
  return parts.join(separator);
}
