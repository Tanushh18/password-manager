// Web build of the app (Expo web / previews): same format via WebCrypto.
import { parseTotp, toB64, fromB64, utf8Encode, utf8Decode, KDF_ITERATIONS } from "./cryptoCore";

const subtle = () => globalThis.crypto.subtle;
const KEY_CHECK = "aurelia:key-check:v1";
const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const aes = (raw) => subtle().importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);

async function deriveKey(password, saltB64, iterations = KDF_ITERATIONS) {
  const base = await subtle().importKey("raw", utf8Encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await subtle().deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromB64(saltB64), iterations }, base, 256));
}
async function encryptString(key, text) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, await aes(key), utf8Encode(text)));
  return `v1:${toB64(iv)}:${toB64(ct)}`;
}
async function decryptString(key, blob) {
  const [v, iv, ct] = String(blob).split(":");
  if (v !== "v1") throw new Error("Unknown vault format");
  return utf8Decode(new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await aes(key), fromB64(ct))));
}
const encryptJSON = (k, o) => encryptString(k, JSON.stringify(o));
const decryptJSON = async (k, b) => JSON.parse(await decryptString(k, b));
async function verifyKey(key, check) {
  try {
    return (await decryptString(key, check)) === KEY_CHECK;
  } catch (e) {
    return false;
  }
}
async function sha1Hex(text) {
  const d = new Uint8Array(await subtle().digest("SHA-1", utf8Encode(text)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32 = (s) => {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of String(s).toUpperCase().replace(/[^A-Z2-7]/g, "")) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
};
async function totpCode(input, now = Date.now()) {
  const cfg = typeof input === "string" ? parseTotp(input) : input;
  if (!cfg) return null;
  let c = Math.floor(now / 1000 / cfg.period);
  const msg = new Uint8Array(8);
  for (let i = 7; i >= 0; i -= 1) { msg[i] = c & 255; c = Math.floor(c / 256); }
  const hash = { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" }[cfg.algorithm] || "SHA-1";
  const k = await subtle().importKey("raw", b32(cfg.secret), { name: "HMAC", hash }, false, ["sign"]);
  const h = new Uint8Array(await subtle().sign("HMAC", k, msg));
  const o = h[h.length - 1] & 15;
  const bin = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return { code: String(bin % 10 ** cfg.digits).padStart(cfg.digits, "0"), remaining: cfg.period - (Math.floor(now / 1000) % cfg.period), period: cfg.period };
}
async function exportBackup(items, password) {
  const salt = toB64(randomBytes(16));
  const key = await deriveKey(password, salt);
  const data = await encryptJSON(key, { items, exportedAt: new Date().toISOString() });
  return JSON.stringify({ format: "aurelia-backup", version: 1, kdf: { name: "PBKDF2-SHA256", salt, iterations: KDF_ITERATIONS }, data }, null, 2);
}
async function importBackup(text, password) {
  const file = JSON.parse(text);
  if (file.format !== "aurelia-backup") throw new Error("That isn't an Aurelia backup file.");
  const key = await deriveKey(password, file.kdf.salt, file.kdf.iterations);
  try {
    return (await decryptJSON(key, file.data)).items || [];
  } catch (e) {
    throw new Error("Wrong backup password.");
  }
}

export default {
  KDF_ITERATIONS,
  randomBytes,
  randomSalt: () => toB64(randomBytes(16)),
  deriveKey,
  encryptString,
  decryptString,
  encryptJSON,
  decryptJSON,
  makeKeyCheck: (k) => encryptString(k, KEY_CHECK),
  verifyKey,
  sha1Hex,
  totpCode,
  parseTotp,
  exportBackup,
  importBackup,
  toB64,
  fromB64,
};
