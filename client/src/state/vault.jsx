import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../api/client";
import * as C from "../lib/crypto";
import { fromLegacy, normalizeItem } from "../lib/items";
import { computeHealth } from "../lib/health";
import { pwnedCount } from "../lib/breach";

/**
 * Session + end-to-end vault state for the website.
 *
 * status:
 *   "checking"  – asking the server who we are
 *   "signedOut" – no session
 *   "locked"    – signed in, but the vault key is not in memory (page reload, auto-lock)
 *   "ready"     – key in memory, items decrypted
 *
 * The vault key only ever lives in memory. It is derived from the master
 * password with PBKDF2 and never sent to the server.
 */

const VaultContext = createContext(null);
const PREFS_KEY = "aurelia_prefs";
const DEFAULT_PREFS = { icons: false, autoLock: 15 };

const readPrefs = () => {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") };
  } catch (e) {
    return DEFAULT_PREFS;
  }
};

const toItem = (entry, fields) => ({
  ...normalizeItem(fields),
  id: entry._id,
  createdAt: entry.createdAt,
  updatedAt: entry.updatedAt,
});

export function VaultProvider({ children }) {
  const [status, setStatus] = useState("checking");
  const [profile, setProfile] = useState(null); // /authenticate payload minus entries
  const [items, setItems] = useState([]);
  const [broken, setBroken] = useState(0); // entries that failed to decrypt
  const [breaches, setBreaches] = useState({});
  const [breachProgress, setBreachProgress] = useState(null);
  const [prefs, setPrefsState] = useState(readPrefs);
  const keyRef = useRef(null);
  const entriesRef = useRef([]);

  const setPrefs = useCallback((patch) => {
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch (e) {
        /* private mode */
      }
      return next;
    });
  }, []);

  const loadProfile = useCallback(async () => {
    const res = await api.checkAuthenticated();
    const { passwords, ...rest } = res.data;
    entriesRef.current = passwords || [];
    setProfile(rest);
    return { profile: rest, entries: passwords || [] };
  }, []);

  /* ── Boot ── */
  useEffect(() => {
    let cancelled = false;
    loadProfile()
      .then(() => !cancelled && setStatus("locked"))
      .catch(() => !cancelled && setStatus("signedOut"));
    return () => {
      cancelled = true;
    };
  }, [loadProfile]);

  const clearVault = useCallback(() => {
    keyRef.current = null;
    setItems([]);
    setBreaches({});
    setBroken(0);
  }, []);

  /* Decrypts every end-to-end entry and migrates legacy ones in the background. */
  const openWithKey = useCallback(async (key, entries) => {
    keyRef.current = key;
    const e2e = entries.filter((e) => e.enc === "e2e");
    const legacy = entries.filter((e) => e.enc !== "e2e");

    let failed = 0;
    const decrypted = [];
    for (const entry of e2e) {
      try {
        decrypted.push(toItem(entry, await C.decryptJSON(key, entry.data)));
      } catch (e) {
        failed += 1;
      }
    }

    // Legacy entries: ask the server to unseal once, re-encrypt here, upload.
    const migrations = [];
    for (const entry of legacy) {
      try {
        const res = await api.decryptLegacy(entry);
        const fields = fromLegacy(entry, res.data);
        decrypted.push(toItem(entry, fields));
        migrations.push({ id: entry._id, data: await C.encryptJSON(key, fields) });
      } catch (e) {
        failed += 1;
      }
    }
    if (migrations.length) {
      try {
        await api.migrateItems(migrations);
      } catch (e) {
        // Not fatal: they stay readable and will migrate next time.
      }
    }

    setItems(decrypted);
    setBroken(failed);
    setStatus("ready");
    return { migrated: migrations.length, failed };
  }, []);

  /** Derives the key for the signed-in account (sets up e2e for old accounts). */
  const deriveForProfile = useCallback(async (password, prof) => {
    if (prof.vault?.kdf) {
      const { key } = await C.deriveKey(password, prof.vault.kdf.salt, prof.vault.kdf.iterations);
      if (!(await C.verifyKey(key, prof.vault.keyCheck))) throw new Error("That master password is incorrect.");
      return key;
    }
    // Account created before end-to-end encryption: create its vault key now.
    const salt = C.randomSalt();
    const { key } = await C.deriveKey(password, salt, C.KDF_ITERATIONS);
    const keyCheck = await C.makeKeyCheck(key);
    try {
      await api.setupVault({ kdf: { salt, iterations: C.KDF_ITERATIONS }, keyCheck });
    } catch (e) {
      if (e?.response?.status === 409) {
        // Another device set it up first; use theirs.
        const { profile: fresh } = await loadProfile();
        return deriveForProfile(password, fresh);
      }
      throw e;
    }
    return key;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadProfile]);

  /* ── Sign in / up ── */
  const login = useCallback(
    async (email, password, code) => {
      try {
        await api.loginUser({ email, password, code: code || undefined });
      } catch (e) {
        if (e?.response?.data?.twoFactorRequired) return { twoFactorRequired: true, error: code ? api.errorMessage(e) : null };
        throw new Error(api.errorMessage(e, "That email and password don't match."));
      }
      const { profile: prof, entries } = await loadProfile();
      const key = await deriveForProfile(password, prof);
      const { profile: fresh, entries: latest } = prof.vault?.kdf ? { profile: prof, entries } : await loadProfile();
      setProfile(fresh);
      await openWithKey(key, latest);
      return { ok: true };
    },
    [loadProfile, deriveForProfile, openWithKey]
  );

  const register = useCallback(async ({ name, email, password }) => {
    const salt = C.randomSalt();
    const { key } = await C.deriveKey(password, salt, C.KDF_ITERATIONS);
    const keyCheck = await C.makeKeyCheck(key);
    try {
      await api.signupUser({ name, email, password, cpassword: password, kdf: { salt, iterations: C.KDF_ITERATIONS }, keyCheck });
    } catch (e) {
      throw new Error(api.errorMessage(e, "We couldn't create your vault."));
    }
  }, []);

  /** Unlock after a reload / auto-lock. Old accounts go through the server once. */
  const unlock = useCallback(
    async (password, code) => {
      if (!profile) throw new Error("Please sign in again.");
      if (!profile.vault?.kdf) return login(profile.email, password, code);
      const key = await deriveForProfile(password, profile);
      const { entries } = await loadProfile();
      await openWithKey(key, entries);
      return { ok: true };
    },
    [profile, login, deriveForProfile, loadProfile, openWithKey]
  );

  const lock = useCallback(() => {
    clearVault();
    setStatus((s) => (s === "ready" ? "locked" : s));
  }, [clearVault]);

  const logout = useCallback(async () => {
    try {
      await api.logoutUser();
    } catch (e) {
      /* clear locally anyway */
    }
    clearVault();
    setProfile(null);
    setStatus("signedOut");
  }, [clearVault]);

  /* ── Auto-lock after inactivity ── */
  useEffect(() => {
    if (status !== "ready" || !prefs.autoLock) return undefined;
    let timer;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(lock, prefs.autoLock * 60 * 1000);
    };
    const events = ["pointerdown", "keydown", "scroll", "pointermove"];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [status, prefs.autoLock, lock]);

  /* ── Items ── */
  const requireKey = () => {
    if (!keyRef.current) throw new Error("Your vault is locked.");
    return keyRef.current;
  };

  const addItem = useCallback(async (fields) => {
    const key = requireKey();
    const item = normalizeItem({ ...fields, passwordUpdatedAt: new Date().toISOString() });
    const res = await api.createItem(await C.encryptJSON(key, item));
    const created = toItem(res.data.item, item);
    setItems((list) => [created, ...list]);
    return created;
  }, []);

  const updateItem = useCallback(async (id, fields) => {
    const key = requireKey();
    const current = items.find((i) => i.id === id);
    const next = normalizeItem({ ...current, ...fields });
    if (current && current.password !== next.password) next.passwordUpdatedAt = new Date().toISOString();
    const res = await api.updateItem(id, await C.encryptJSON(key, next));
    setItems((list) => list.map((i) => (i.id === id ? { ...next, id, createdAt: i.createdAt, updatedAt: res.data.item.updatedAt } : i)));
    setBreaches((b) => {
      if (!current || current.password === next.password) return b;
      const copy = { ...b };
      delete copy[id];
      return copy;
    });
  }, [items]);

  const toggleFavorite = useCallback((id) => {
    const current = items.find((i) => i.id === id);
    return current ? updateItem(id, { favorite: !current.favorite }) : Promise.resolve();
  }, [items, updateItem]);

  const deleteItem = useCallback(async (id) => {
    await api.deleteItem(id);
    setItems((list) => list.filter((i) => i.id !== id));
  }, []);

  const importItems = useCallback(async (list, onProgress) => {
    const key = requireKey();
    const now = new Date().toISOString();
    const prepared = list.map((it) => normalizeItem({ ...it, passwordUpdatedAt: it.passwordUpdatedAt || now }));
    const created = [];
    for (let i = 0; i < prepared.length; i += 500) {
      const chunk = prepared.slice(i, i + 500);
      const payload = [];
      for (const it of chunk) payload.push({ data: await C.encryptJSON(key, it) });
      const res = await api.createItems(payload);
      res.data.items.forEach((entry, j) => created.push(toItem(entry, chunk[j])));
      onProgress?.(Math.min(prepared.length, i + chunk.length), prepared.length);
    }
    setItems((l) => [...created, ...l]);
    return created.length;
  }, []);

  /* ── Breach check (Have I Been Pwned, k-anonymity) ── */
  const runBreachCheck = useCallback(async () => {
    const targets = items.filter((i) => i.password);
    const found = {};
    setBreachProgress({ done: 0, total: targets.length });
    for (let n = 0; n < targets.length; n += 1) {
      try {
        const count = await pwnedCount(targets[n].password);
        if (count) found[targets[n].id] = count;
      } catch (e) {
        setBreachProgress(null);
        throw e;
      }
      setBreachProgress({ done: n + 1, total: targets.length });
    }
    setBreaches(found);
    setTimeout(() => setBreachProgress(null), 1200);
    return Object.keys(found).length;
  }, [items]);

  /* ── Account ── */
  const changeMasterPassword = useCallback(async ({ current, next, code }) => {
    const oldKey = requireKey();
    const { key: checkKey } = await C.deriveKey(current, profile.vault.kdf.salt, profile.vault.kdf.iterations);
    if (!(await C.verifyKey(checkKey, profile.vault.keyCheck))) throw new Error("Your current master password is incorrect.");

    const salt = C.randomSalt();
    const { key } = await C.deriveKey(next, salt, C.KDF_ITERATIONS);
    const keyCheck = await C.makeKeyCheck(key);
    const { entries } = await loadProfile();

    // Re-encrypt every entry, including any that still failed to migrate.
    const payload = [];
    for (const entry of entries) {
      let fields = items.find((i) => i.id === entry._id);
      if (!fields && entry.enc === "e2e") fields = await C.decryptJSON(oldKey, entry.data);
      if (!fields) fields = fromLegacy(entry, (await api.decryptLegacy(entry)).data);
      payload.push({ id: entry._id, data: await C.encryptJSON(key, normalizeItem(fields)) });
    }

    try {
      await api.changeMasterPassword({
        currentPassword: current,
        newPassword: next,
        code: code || undefined,
        kdf: { salt, iterations: C.KDF_ITERATIONS },
        keyCheck,
        items: payload,
      });
    } catch (e) {
      const err = new Error(api.errorMessage(e, "Couldn't change your master password."));
      err.twoFactorRequired = Boolean(e?.response?.data?.twoFactorRequired);
      throw err;
    }
    keyRef.current = key;
    await loadProfile();
  }, [items, profile, loadProfile]);

  const refreshProfile = useCallback(() => loadProfile().catch(() => null), [loadProfile]);

  const value = useMemo(() => {
    const health = computeHealth(items, breaches);
    return {
      status,
      profile,
      items,
      broken,
      health,
      breaches,
      breachProgress,
      prefs,
      setPrefs,
      login,
      register,
      unlock,
      lock,
      logout,
      addItem,
      updateItem,
      toggleFavorite,
      deleteItem,
      importItems,
      runBreachCheck,
      changeMasterPassword,
      refreshProfile,
      setProfileName: (name) => setProfile((p) => (p ? { ...p, name } : p)),
    };
  }, [status, profile, items, broken, breaches, breachProgress, prefs, setPrefs, login, register, unlock, lock, logout, addItem, updateItem, toggleFavorite, deleteItem, importItems, runBreachCheck, changeMasterPassword, refreshProfile]);

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export const useVault = () => useContext(VaultContext);
