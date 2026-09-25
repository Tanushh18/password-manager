import { Platform } from "react-native";

/**
 * Offline copy of the vault. It holds exactly what the server returns —
 * encrypted item blobs plus the public profile — so it is useless without
 * the master password (or the biometric-protected key).
 */
const NAME = "vault-cache.json";

const file = () => {
  if (Platform.OS === "web") return null;
  // Lazy require keeps the web build free of the native module.
  const { File, Paths } = require("expo-file-system");
  return new File(Paths.document, NAME);
};

export async function writeCache(data) {
  try {
    const f = file();
    if (f) f.write(JSON.stringify({ savedAt: new Date().toISOString(), ...data }));
  } catch (e) {
    /* cache is best effort */
  }
}

export async function readCache() {
  try {
    const f = file();
    if (!f || !f.exists) return null;
    return JSON.parse(await f.text());
  } catch (e) {
    return null;
  }
}

export async function clearCache() {
  try {
    const f = file();
    if (f && f.exists) f.delete();
  } catch (e) {
    /* ignore */
  }
}
