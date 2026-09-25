import { sha1Hex } from "./crypto.js";

/**
 * Have I Been Pwned "range" API (k-anonymity): only the first 5 characters of
 * the password's SHA-1 hash leave the device, never the password itself.
 * https://haveibeenpwned.com/API/v3#PwnedPasswords
 */
const cache = new Map();

export async function pwnedCount(password) {
  if (!password) return 0;
  const hash = await sha1Hex(password);
  if (cache.has(hash)) return cache.get(hash);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  const url = `https://api.pwnedpasswords.com/range/${prefix}`;
  let res;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      res = await fetch(url, { headers: { "Add-Padding": "true" } });
      if (res.ok) break;
    } catch (e) {
      res = null;
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  if (!res || !res.ok) throw new Error("Breach check is unavailable right now. Please try again.");
  const text = await res.text();
  let count = 0;
  for (const line of text.split("\n")) {
    const [s, n] = line.trim().split(":");
    if (s === suffix) {
      count = Number(n) || 0;
      break;
    }
  }
  cache.set(hash, count);
  return count;
}
