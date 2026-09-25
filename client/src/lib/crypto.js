/**
 * Aurelia end-to-end encryption (browser, WebCrypto).
 *
 * The vault key is derived from the master password on the device and never
 * sent to the server. Format is shared with the Android app
 * (mobile/src/lib/cryptoCore.js) — see server/docs/crypto.md.
 *
 *   key   = PBKDF2-HMAC-SHA256(masterPassword, salt, iterations, 32 bytes)
 *   blob  = "v1:" + base64(iv[12]) + ":" + base64(ciphertext || tag[16])   (AES-256-GCM)
 */

export const KDF_ITERATIONS = 600000;
const KEY_CHECK = "aurelia:key-check:v1";
const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;

export const toB64 = (bytes) => {
  let s = "";
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
};
export const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
export const randomSalt = () => toB64(randomBytes(16));

/** Derives the AES-GCM vault key. Returns raw bytes (so it can be held for the session). */
export async function deriveKeyBytes(password, saltB64, iterations = KDF_ITERATIONS) {
  const base = await subtle().importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle().deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromB64(saltB64), iterations }, base, 256);
  return new Uint8Array(bits);
}

export const importKey = (raw) => subtle().importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);

export async function deriveKey(password, saltB64, iterations) {
  const raw = await deriveKeyBytes(password, saltB64, iterations);
  return { raw, key: await importKey(raw) };
}

export async function encryptString(key, text) {
  const iv = randomBytes(12);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv }, key, enc.encode(text));
  return `v1:${toB64(iv)}:${toB64(new Uint8Array(ct))}`;
}

export async function decryptString(key, blob) {
  const [v, ivB64, ctB64] = String(blob).split(":");
  if (v !== "v1" || !ivB64 || !ctB64) throw new Error("Unknown vault format");
  const pt = await subtle().decrypt({ name: "AES-GCM", iv: fromB64(ivB64) }, key, fromB64(ctB64));
  return dec.decode(pt);
}

export const encryptJSON = async (key, obj) => encryptString(key, JSON.stringify(obj));
export const decryptJSON = async (key, blob) => JSON.parse(await decryptString(key, blob));

export const makeKeyCheck = (key) => encryptString(key, KEY_CHECK);
export async function verifyKey(key, check) {
  try {
    return (await decryptString(key, check)) === KEY_CHECK;
  } catch (e) {
    return false;
  }
}

/* ── Hashing (Have I Been Pwned uses SHA-1 k-anonymity) ── */
export async function sha1Hex(text) {
  const d = await subtle().digest("SHA-1", enc.encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/* ── TOTP (RFC 6238) ── */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Decode(input) {
  const clean = String(input).toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** Accepts a bare base32 secret or an otpauth:// URI. */
export function parseTotp(input) {
  const text = String(input || "").trim();
  if (!text) return null;
  if (text.startsWith("otpauth://")) {
    try {
      const url = new URL(text);
      const p = url.searchParams;
      const secret = p.get("secret");
      if (!secret) return null;
      return {
        secret: secret.replace(/\s/g, ""),
        digits: Number(p.get("digits")) || 6,
        period: Number(p.get("period")) || 30,
        algorithm: (p.get("algorithm") || "SHA1").toUpperCase(),
        issuer: p.get("issuer") || decodeURIComponent(url.pathname.replace(/^\/+/, "")).split(":")[0],
      };
    } catch (e) {
      return null;
    }
  }
  const secret = text.replace(/\s/g, "");
  return /^[A-Za-z2-7=]+$/.test(secret) && secret.length >= 16 ? { secret, digits: 6, period: 30, algorithm: "SHA1" } : null;
}

export async function totpCode(input, now = Date.now()) {
  const cfg = typeof input === "string" ? parseTotp(input) : input;
  if (!cfg) return null;
  const counter = Math.floor(now / 1000 / cfg.period);
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i -= 1) {
    msg[i] = c & 255;
    c = Math.floor(c / 256);
  }
  const hash = { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" }[cfg.algorithm] || "SHA-1";
  const k = await subtle().importKey("raw", base32Decode(cfg.secret), { name: "HMAC", hash }, false, ["sign"]);
  const h = new Uint8Array(await subtle().sign("HMAC", k, msg));
  const o = h[h.length - 1] & 15;
  const bin = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  const code = String(bin % 10 ** cfg.digits).padStart(cfg.digits, "0");
  const remaining = cfg.period - (Math.floor(now / 1000) % cfg.period);
  return { code, remaining, period: cfg.period };
}

/* ── Encrypted backups (independent export password) ── */
export async function exportBackup(items, exportPassword) {
  const salt = randomSalt();
  const { key } = await deriveKey(exportPassword, salt, KDF_ITERATIONS);
  const data = await encryptJSON(key, { items, exportedAt: new Date().toISOString() });
  return JSON.stringify({ format: "aurelia-backup", version: 1, kdf: { name: "PBKDF2-SHA256", salt, iterations: KDF_ITERATIONS }, data }, null, 2);
}

export async function importBackup(text, exportPassword) {
  const file = JSON.parse(text);
  if (file.format !== "aurelia-backup") throw new Error("That isn't an Aurelia backup file.");
  const { key } = await deriveKey(exportPassword, file.kdf.salt, file.kdf.iterations);
  try {
    return (await decryptJSON(key, file.data)).items || [];
  } catch (e) {
    throw new Error("Wrong backup password.");
  }
}
