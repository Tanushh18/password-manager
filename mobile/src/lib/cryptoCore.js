/**
 * Aurelia end-to-end encryption — shared core for the Android app.
 *
 * Takes a Node-compatible crypto implementation (react-native-quick-crypto on
 * the phone, node:crypto in tests) and produces exactly the same format as the
 * website (client/src/lib/crypto.js):
 *
 *   key   = PBKDF2-HMAC-SHA256(masterPassword, salt, iterations, 32 bytes)
 *   blob  = "v1:" + base64(iv[12]) + ":" + base64(ciphertext || tag[16])   (AES-256-GCM)
 */

export const KDF_ITERATIONS = 600000;
const KEY_CHECK = "aurelia:key-check:v1";

/* ── byte helpers (no Buffer / TextEncoder assumptions) ── */
export function utf8Encode(str) {
  const out = [];
  for (let i = 0; i < str.length; i += 1) {
    let c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const n = str.charCodeAt(i + 1);
      if (n >= 0xdc00 && n <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (n - 0xdc00);
        i += 1;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
}

export function utf8Decode(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    let c;
    if (b < 0x80) { c = b; i += 1; }
    else if (b < 0xe0) { c = ((b & 31) << 6) | (bytes[i + 1] & 63); i += 2; }
    else if (b < 0xf0) { c = ((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63); i += 3; }
    else { c = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63); i += 4; }
    s += String.fromCodePoint(c);
  }
  return s;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function toB64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64[n & 63] : "=";
  }
  return out;
}
export function fromB64(text) {
  const clean = String(text).replace(/[^A-Za-z0-9+/]/g, "");
  const out = [];
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | ((B64.indexOf(clean[i + 2]) & 63) << 6) | (B64.indexOf(clean[i + 3]) & 63);
    out.push((n >> 16) & 255);
    if (clean[i + 2] !== undefined) out.push((n >> 8) & 255);
    if (clean[i + 3] !== undefined) out.push(n & 255);
  }
  return new Uint8Array(out);
}
const u8 = (b) => new Uint8Array(b.buffer ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b);
const concat = (a, b) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
};
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

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
    const q = text.split("?")[1] || "";
    const params = {};
    q.split("&").forEach((pair) => {
      const [k, v = ""] = pair.split("=");
      if (k) params[decodeURIComponent(k).toLowerCase()] = decodeURIComponent(v.replace(/\+/g, " "));
    });
    if (!params.secret) return null;
    const label = decodeURIComponent((text.split("?")[0].split("/").pop() || ""));
    return {
      secret: params.secret.replace(/\s/g, ""),
      digits: Number(params.digits) || 6,
      period: Number(params.period) || 30,
      algorithm: (params.algorithm || "SHA1").toUpperCase(),
      issuer: params.issuer || label.split(":")[0],
    };
  }
  const secret = text.replace(/\s/g, "");
  return /^[A-Za-z2-7=]+$/.test(secret) && secret.length >= 16 ? { secret, digits: 6, period: 30, algorithm: "SHA1" } : null;
}

export function createCrypto(nc) {
  const randomBytes = (n) => u8(nc.randomBytes(n));

  const deriveKey = (password, saltB64, iterations = KDF_ITERATIONS) =>
    new Promise((resolve, reject) => {
      nc.pbkdf2(utf8Encode(password), fromB64(saltB64), iterations, 32, "sha256", (err, key) =>
        err ? reject(err) : resolve(u8(key))
      );
    });

  async function encryptString(key, text) {
    const iv = randomBytes(12);
    const cipher = nc.createCipheriv("aes-256-gcm", key, iv);
    const a = u8(cipher.update(utf8Encode(text)));
    const b = u8(cipher.final());
    const tag = u8(cipher.getAuthTag());
    return `v1:${toB64(iv)}:${toB64(concat(concat(a, b), tag))}`;
  }

  async function decryptString(key, blob) {
    const [v, ivB64, ctB64] = String(blob).split(":");
    if (v !== "v1" || !ivB64 || !ctB64) throw new Error("Unknown vault format");
    const all = fromB64(ctB64);
    const decipher = nc.createDecipheriv("aes-256-gcm", key, fromB64(ivB64));
    decipher.setAuthTag(all.slice(all.length - 16));
    const a = u8(decipher.update(all.slice(0, all.length - 16)));
    const b = u8(decipher.final());
    return utf8Decode(concat(a, b));
  }

  const encryptJSON = (key, obj) => encryptString(key, JSON.stringify(obj));
  const decryptJSON = async (key, blob) => JSON.parse(await decryptString(key, blob));

  const makeKeyCheck = (key) => encryptString(key, KEY_CHECK);
  async function verifyKey(key, check) {
    try {
      return (await decryptString(key, check)) === KEY_CHECK;
    } catch (e) {
      return false;
    }
  }

  const sha1Hex = async (text) => hex(u8(nc.createHash("sha1").update(utf8Encode(text)).digest())).toUpperCase();

  async function totpCode(input, now = Date.now()) {
    const cfg = typeof input === "string" ? parseTotp(input) : input;
    if (!cfg) return null;
    let c = Math.floor(now / 1000 / cfg.period);
    const msg = new Uint8Array(8);
    for (let i = 7; i >= 0; i -= 1) {
      msg[i] = c & 255;
      c = Math.floor(c / 256);
    }
    const alg = { SHA1: "sha1", SHA256: "sha256", SHA512: "sha512" }[cfg.algorithm] || "sha1";
    const h = u8(nc.createHmac(alg, base32Decode(cfg.secret)).update(msg).digest());
    const o = h[h.length - 1] & 15;
    const bin = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
    return {
      code: String(bin % 10 ** cfg.digits).padStart(cfg.digits, "0"),
      remaining: cfg.period - (Math.floor(now / 1000) % cfg.period),
      period: cfg.period,
    };
  }

  async function exportBackup(items, exportPassword) {
    const salt = toB64(randomBytes(16));
    const key = await deriveKey(exportPassword, salt, KDF_ITERATIONS);
    const data = await encryptJSON(key, { items, exportedAt: new Date().toISOString() });
    return JSON.stringify({ format: "aurelia-backup", version: 1, kdf: { name: "PBKDF2-SHA256", salt, iterations: KDF_ITERATIONS }, data }, null, 2);
  }

  async function importBackup(text, exportPassword) {
    const file = JSON.parse(text);
    if (file.format !== "aurelia-backup") throw new Error("That isn't an Aurelia backup file.");
    const key = await deriveKey(exportPassword, file.kdf.salt, file.kdf.iterations);
    try {
      return (await decryptJSON(key, file.data)).items || [];
    } catch (e) {
      throw new Error("Wrong backup password.");
    }
  }

  return {
    KDF_ITERATIONS,
    randomBytes,
    randomSalt: () => toB64(randomBytes(16)),
    deriveKey,
    encryptString,
    decryptString,
    encryptJSON,
    decryptJSON,
    makeKeyCheck,
    verifyKey,
    sha1Hex,
    totpCode,
    parseTotp,
    exportBackup,
    importBackup,
    toB64,
    fromB64,
  };
}
