/* MPIN sign-in: a 4-digit code that works only on a device where you already signed in with your email and password.
   The server gives that device a long random secret once; it is kept here, and the MPIN is checked together with it. */
const KEY = "stashr_mpin";

export const isPin = (v) => /^\d{4}$/.test(String(v ?? ""));

/** Too easy to guess (the server refuses these too): 1111, 0000, 1234, 4321 and the like. */
export const weakPin = (pin) =>
  /^(\d)\1{3}$/.test(pin) || ["0123", "1234", "2345", "3456", "4567", "5678", "6789", "9876", "8765", "7654", "6543", "5432", "4321", "3210"].includes(pin);

/** The saved { deviceId, deviceSecret } of this device, or null. */
export function readMpin() {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) || "null");
    return j && /^[a-f0-9]{24}$/.test(j.deviceId || "") && /^[a-f0-9]{48}$/.test(j.deviceSecret || "") ? { deviceId: j.deviceId, deviceSecret: j.deviceSecret } : null;
  } catch {
    return null;
  }
}

export function saveMpin(device) {
  try { localStorage.setItem(KEY, JSON.stringify({ deviceId: device.deviceId, deviceSecret: device.deviceSecret })); } catch { /* private mode */ }
}

export function clearMpin() {
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
}
