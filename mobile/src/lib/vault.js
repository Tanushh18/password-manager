import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";
import { api, ApiError, setToken, activeServer, setActiveServer } from "./api";
import C from "./crypto";
import { fromLegacy, normalizeItem } from "./items";
import { computeHealth } from "./health";
import { pwnedCount } from "./breach";
import { readCache, writeCache, clearCache } from "./cache";

/**
 * Session + end-to-end vault state for the Android app.
 *
 * status: "booting" | "signedOut" | "locked" | "ready"
 *
 * The vault key is derived on the phone from the master password (PBKDF2-SHA256,
 * 600k rounds, native) and never sent to the server. With biometric unlock on,
 * the key is kept in the Android Keystore and released only after a fingerprint
 * / face check.
 */

const K = {
  token: "aurelia_token",
  server: "aurelia_server",
  bio: "aurelia_biometric",
  key: "aurelia_vault_key",
  prefs: "aurelia_prefs",
};
const DEFAULT_PREFS = { autoLock: 0.5, icons: false }; // minutes; -1 = never
const BIO_OPTIONS = { requireAuthentication: true, authenticationPrompt: "Unlock your Aurelia vault" };

const VaultContext = createContext(null);

const safe = async (fn, fallback = null) => {
  try {
    return await fn();
  } catch (e) {
    return fallback;
  }
};

const toItem = (entry, fields) => ({ ...normalizeItem(fields), id: entry._id, createdAt: entry.createdAt, updatedAt: entry.updatedAt });

export function VaultProvider({ children }) {
  const [status, setStatus] = useState("booting");
  const [profile, setProfile] = useState(null);
  const [items, setItems] = useState([]);
  const [broken, setBroken] = useState(0);
  const [offline, setOffline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [breaches, setBreaches] = useState({});
  const [breachChecked, setBreachChecked] = useState(false);
  const [breachProgress, setBreachProgress] = useState(null);
  const [biometric, setBiometricState] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [prefs, setPrefsState] = useState(DEFAULT_PREFS);

  const keyRef = useRef(null);
  const entriesRef = useRef([]);
  const backgroundAt = useRef(null);
  const pauseLock = useRef(0);

  /* ── Server profile (+ offline cache of the encrypted vault) ── */
  const loadProfile = useCallback(async () => {
    try {
      const me = await api.me();
      const { passwords, ...rest } = me;
      entriesRef.current = passwords || [];
      setProfile(rest);
      setOffline(false);
      SecureStore.setItemAsync(K.server, activeServer()).catch(() => {});
      writeCache({ profile: rest, entries: entriesRef.current });
      return { profile: rest, entries: entriesRef.current };
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 400)) throw e;
      // Network down: fall back to the last encrypted copy (read-only).
      const cached = await readCache();
      if (!cached) throw e;
      entriesRef.current = cached.entries || [];
      setProfile(cached.profile);
      setOffline(true);
      return { profile: cached.profile, entries: entriesRef.current };
    }
  }, []);

  const wipeLocal = useCallback(async () => {
    setToken(null);
    keyRef.current = null;
    entriesRef.current = [];
    setItems([]);
    setProfile(null);
    setBreaches({});
    setBreachChecked(false);
    setBroken(0);
    await Promise.all([
      safe(() => SecureStore.deleteItemAsync(K.token)),
      safe(() => SecureStore.deleteItemAsync(K.key)),
      safe(() => SecureStore.deleteItemAsync(K.bio)),
      clearCache(),
    ]);
    setBiometricState(false);
    setStatus("signedOut");
  }, []);

  /* ── Boot ── */
  useEffect(() => {
    (async () => {
      const [token, server, bio, prefsText, hasHw, enrolled] = await Promise.all([
        safe(() => SecureStore.getItemAsync(K.token)),
        safe(() => SecureStore.getItemAsync(K.server)),
        safe(() => SecureStore.getItemAsync(K.bio)),
        safe(() => SecureStore.getItemAsync(K.prefs)),
        safe(() => LocalAuthentication.hasHardwareAsync(), false),
        safe(() => LocalAuthentication.isEnrolledAsync(), false),
      ]);
      setBiometricAvailable(Boolean(hasHw && enrolled) && Platform.OS !== "web");
      setBiometricState(bio === "1");
      if (prefsText) setPrefsState({ ...DEFAULT_PREFS, ...safeParse(prefsText) });
      if (server) setActiveServer(server);
      if (!token) return setStatus("signedOut");

      setToken(token === "cookie" ? null : token);
      try {
        await loadProfile();
        setStatus("locked");
      } catch (e) {
        await wipeLocal();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Open the vault with a key ── */
  const openWithKey = useCallback(async (key, entries) => {
    keyRef.current = key;
    const decrypted = [];
    let failed = 0;
    const legacy = [];
    for (const entry of entries) {
      if (entry.enc !== "e2e") {
        legacy.push(entry);
        continue;
      }
      try {
        decrypted.push(toItem(entry, await C.decryptJSON(key, entry.data)));
      } catch (e) {
        failed += 1;
      }
    }
    // Old server-encrypted entries: unseal once, re-encrypt here, upload.
    const migrations = [];
    for (const entry of legacy) {
      try {
        const fields = fromLegacy(entry, await api.decryptLegacy(entry));
        decrypted.push(toItem(entry, fields));
        migrations.push({ id: entry._id, data: await C.encryptJSON(key, fields) });
      } catch (e) {
        failed += 1;
      }
    }
    if (migrations.length) await safe(() => api.migrate(migrations));
    setItems(decrypted);
    setBroken(failed);
    setStatus("ready");
  }, []);

  const deriveForProfile = useCallback(async (password, prof) => {
    if (prof.vault?.kdf) {
      const key = await C.deriveKey(password, prof.vault.kdf.salt, prof.vault.kdf.iterations);
      if (!(await C.verifyKey(key, prof.vault.keyCheck))) throw new Error("That master password is incorrect.");
      return key;
    }
    // Account from before end-to-end encryption: create its vault key now.
    const salt = C.randomSalt();
    const key = await C.deriveKey(password, salt, C.KDF_ITERATIONS);
    const keyCheck = await C.makeKeyCheck(key);
    try {
      await api.setupVault({ kdf: { salt, iterations: C.KDF_ITERATIONS }, keyCheck });
    } catch (e) {
      if (e.status === 409) {
        const { profile: fresh } = await loadProfile();
        return deriveForProfile(password, fresh);
      }
      throw e;
    }
    return key;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadProfile]);

  const storeBiometricKey = useCallback(async (key) => {
    await SecureStore.setItemAsync(K.key, C.toB64(key), BIO_OPTIONS);
  }, []);

  /* ── Sign in / up ── */
  const login = useCallback(
    async (email, password, code) => {
      let res;
      try {
        res = await api.login({ email: email.trim(), password, code: code || undefined });
      } catch (e) {
        if (e.data?.twoFactorRequired) return { twoFactorRequired: true, error: code ? e.message : null };
        throw new Error(e.status === 400 ? "That email and password don't match." : e.message);
      }
      if (res?.token) {
        setToken(res.token);
        await safe(() => SecureStore.setItemAsync(K.token, res.token));
      } else {
        await safe(() => SecureStore.setItemAsync(K.token, "cookie"));
      }
      const { profile: prof } = await loadProfile();
      const key = await deriveForProfile(password, prof);
      const { entries } = await loadProfile();
      await openWithKey(key, entries);
      return { ok: true };
    },
    [loadProfile, deriveForProfile, openWithKey]
  );

  const register = useCallback(async ({ name, email, password }) => {
    const salt = C.randomSalt();
    const key = await C.deriveKey(password, salt, C.KDF_ITERATIONS);
    const keyCheck = await C.makeKeyCheck(key);
    await api.register({ name, email, password, cpassword: password, kdf: { salt, iterations: C.KDF_ITERATIONS }, keyCheck });
  }, []);

  const unlock = useCallback(
    async (password) => {
      if (!profile?.vault?.kdf) return login(profile.email, password);
      const key = await deriveForProfile(password, profile);
      const { entries } = await loadProfile().catch(() => ({ entries: entriesRef.current }));
      await openWithKey(key, entries);
      return { ok: true };
    },
    [profile, login, deriveForProfile, loadProfile, openWithKey]
  );

  const unlockWithBiometrics = useCallback(async () => {
    const stored = await SecureStore.getItemAsync(K.key, BIO_OPTIONS);
    if (!stored) throw new Error("Biometric unlock needs your master password once more.");
    const key = C.fromB64(stored);
    if (profile?.vault?.keyCheck && !(await C.verifyKey(key, profile.vault.keyCheck))) {
      await safe(() => SecureStore.deleteItemAsync(K.key));
      throw new Error("Your master password changed. Enter it to unlock.");
    }
    const { entries } = await loadProfile().catch(() => ({ entries: entriesRef.current }));
    await openWithKey(key, entries);
  }, [profile, loadProfile, openWithKey]);

  const lock = useCallback(() => {
    keyRef.current = null;
    setItems([]);
    setStatus((s) => (s === "ready" ? "locked" : s));
  }, []);

  const logout = useCallback(async () => {
    await safe(() => api.logout());
    await wipeLocal();
  }, [wipeLocal]);

  /* ── Auto-lock when the app has been in the background ── */
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background" || next === "inactive") {
        if (!backgroundAt.current) backgroundAt.current = Date.now();
        return;
      }
      if (next === "active") {
        const away = backgroundAt.current ? Date.now() - backgroundAt.current : 0;
        backgroundAt.current = null;
        if (pauseLock.current > 0 || prefs.autoLock < 0) return;
        if (status === "ready" && away >= prefs.autoLock * 60 * 1000) lock();
      }
    });
    return () => sub.remove();
  }, [status, prefs.autoLock, lock]);

  /** Runs fn without auto-locking (file pickers and share sheets background the app). */
  const withoutAutoLock = useCallback(async (fn) => {
    pauseLock.current += 1;
    try {
      return await fn();
    } finally {
      setTimeout(() => {
        pauseLock.current -= 1;
      }, 1500);
    }
  }, []);

  /* ── Items ── */
  const requireKey = () => {
    if (!keyRef.current) throw new Error("Your vault is locked.");
    if (offline) throw new Error("You're offline. Changes can be made once you're back online.");
    return keyRef.current;
  };

  const addItem = useCallback(async (fields) => {
    const key = requireKey();
    const item = normalizeItem({ ...fields, passwordUpdatedAt: new Date().toISOString() });
    const res = await api.createItem(await C.encryptJSON(key, item));
    const created = toItem(res.item, item);
    setItems((list) => [created, ...list]);
    return created;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline]);

  const updateItem = useCallback(async (id, fields) => {
    const key = requireKey();
    const current = items.find((i) => i.id === id);
    const next = normalizeItem({ ...current, ...fields });
    if (current && current.password !== next.password) next.passwordUpdatedAt = new Date().toISOString();
    const res = await api.updateItem(id, await C.encryptJSON(key, next));
    setItems((list) => list.map((i) => (i.id === id ? { ...next, id, createdAt: i.createdAt, updatedAt: res.item.updatedAt } : i)));
    if (current && current.password !== next.password) {
      setBreaches((b) => {
        const copy = { ...b };
        delete copy[id];
        return copy;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, offline]);

  const toggleFavorite = useCallback(
    (id) => {
      const current = items.find((i) => i.id === id);
      return current ? updateItem(id, { favorite: !current.favorite }) : Promise.resolve();
    },
    [items, updateItem]
  );

  const deleteItem = useCallback(async (id) => {
    if (offline) throw new Error("You're offline.");
    await api.deleteItem(id);
    setItems((list) => list.filter((i) => i.id !== id));
  }, [offline]);

  const importItems = useCallback(async (list) => {
    const key = requireKey();
    const now = new Date().toISOString();
    const prepared = list.map((it) => normalizeItem({ ...it, passwordUpdatedAt: it.passwordUpdatedAt || now }));
    const created = [];
    for (let i = 0; i < prepared.length; i += 500) {
      const chunk = prepared.slice(i, i + 500);
      const payload = [];
      for (const it of chunk) payload.push({ data: await C.encryptJSON(key, it) });
      const res = await api.createItems(payload);
      res.items.forEach((entry, j) => created.push(toItem(entry, chunk[j])));
    }
    setItems((l) => [...created, ...l]);
    return created.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline]);

  const refresh = useCallback(async () => {
    if (!keyRef.current) return;
    setSyncing(true);
    try {
      const { entries } = await loadProfile();
      await openWithKey(keyRef.current, entries);
    } finally {
      setSyncing(false);
    }
  }, [loadProfile, openWithKey]);

  /* ── Breach check ── */
  const runBreachCheck = useCallback(async () => {
    const targets = items.filter((i) => i.password);
    const found = {};
    setBreachProgress({ done: 0, total: targets.length });
    try {
      for (let n = 0; n < targets.length; n += 1) {
        const count = await pwnedCount(targets[n].password);
        if (count) found[targets[n].id] = count;
        setBreachProgress({ done: n + 1, total: targets.length });
      }
    } finally {
      setBreachProgress(null);
    }
    setBreaches(found);
    setBreachChecked(true);
    return Object.keys(found).length;
  }, [items]);

  /* ── Account ── */
  const changeMasterPassword = useCallback(async ({ current, next, code }) => {
    const oldKey = requireKey();
    const checkKey = await C.deriveKey(current, profile.vault.kdf.salt, profile.vault.kdf.iterations);
    if (!(await C.verifyKey(checkKey, profile.vault.keyCheck))) throw new Error("Your current master password is incorrect.");
    const salt = C.randomSalt();
    const key = await C.deriveKey(next, salt, C.KDF_ITERATIONS);
    const keyCheck = await C.makeKeyCheck(key);
    const { entries } = await loadProfile();
    const payload = [];
    for (const entry of entries) {
      let fields = items.find((i) => i.id === entry._id);
      if (!fields && entry.enc === "e2e") fields = await C.decryptJSON(oldKey, entry.data);
      if (!fields) fields = fromLegacy(entry, await api.decryptLegacy(entry));
      payload.push({ id: entry._id, data: await C.encryptJSON(key, normalizeItem(fields)) });
    }
    const res = await api.changePassword({
      currentPassword: current,
      newPassword: next,
      code: code || undefined,
      kdf: { salt, iterations: C.KDF_ITERATIONS },
      keyCheck,
      items: payload,
    });
    if (res.token) {
      setToken(res.token);
      await safe(() => SecureStore.setItemAsync(K.token, res.token));
    }
    keyRef.current = key;
    if (biometric) await safe(() => storeBiometricKey(key));
    await loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, profile, biometric, loadProfile, storeBiometricKey, offline]);

  const setBiometric = useCallback(async (on) => {
    if (on) {
      if (!keyRef.current) throw new Error("Unlock your vault first.");
      await storeBiometricKey(keyRef.current);
    } else {
      await safe(() => SecureStore.deleteItemAsync(K.key));
    }
    setBiometricState(on);
    await safe(() => SecureStore.setItemAsync(K.bio, on ? "1" : "0"));
    return true;
  }, [storeBiometricKey]);

  const setPrefs = useCallback((patch) => {
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      SecureStore.setItemAsync(K.prefs, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const value = useMemo(() => {
    const health = computeHealth(items, breaches);
    return {
      status,
      profile,
      items,
      broken,
      offline,
      syncing,
      health,
      breaches,
      breachChecked,
      breachProgress,
      biometric,
      biometricAvailable,
      prefs,
      setPrefs,
      login,
      register,
      unlock,
      unlockWithBiometrics,
      lock,
      logout,
      wipeLocal,
      refresh,
      refreshProfile: () => loadProfile().catch(() => null),
      addItem,
      updateItem,
      toggleFavorite,
      deleteItem,
      importItems,
      runBreachCheck,
      changeMasterPassword,
      setBiometric,
      withoutAutoLock,
      setProfileName: (name) => setProfile((p) => (p ? { ...p, name } : p)),
    };
  }, [status, profile, items, broken, offline, syncing, breaches, breachChecked, breachProgress, biometric, biometricAvailable, prefs, setPrefs, login, register, unlock, unlockWithBiometrics, lock, logout, wipeLocal, refresh, loadProfile, addItem, updateItem, toggleFavorite, deleteItem, importItems, runBreachCheck, changeMasterPassword, setBiometric, withoutAutoLock]);

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

export const useVault = () => useContext(VaultContext);
