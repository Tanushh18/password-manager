import C from "./crypto";

/**
 * Have I Been Pwned "range" API (k-anonymity): only the first 5 characters of
 * the password's SHA-1 hash leave the phone, never the password itself.
 */
const cache = new Map();

export async function pwnedCount(password) {
  if (!password) return 0;
  const hash = await C.sha1Hex(password);
  if (cache.has(hash)) return cache.get(hash);
  const url = `https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`;
  let res = null;
  for (let attempt = 0; attempt < 2 && !(res && res.ok); attempt += 1) {
    try {
      res = await fetch(url, { headers: { "Add-Padding": "true" } });
    } catch (e) {
      res = null;
    }
  }
  if (!res || !res.ok) throw new Error("Breach check is unavailable right now. Please try again.");
  const suffix = hash.slice(5);
  let count = 0;
  for (const line of (await res.text()).split("\n")) {
    const [s, n] = line.trim().split(":");
    if (s === suffix) {
      count = Number(n) || 0;
      break;
    }
  }
  cache.set(hash, count);
  return count;
}
