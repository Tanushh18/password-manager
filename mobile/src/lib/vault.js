import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";
import { api, ApiError, setToken, activeServer, setActiveServer } from "./api";
import { normalizeItem } from "./items";
import { normalizeProject } from "./projectItems";
import { computeHealth } from "./health";
import { pwnedCount } from "./breach";
import { readCache, writeCache, clearCache } from "./cache";
import { saveCredentials, clearCredentials, clearLinks, getPendingLinks, ackPendingLinks, getPendingSaves, ackPendingSaves, setRequireBiometric as setAutofillBiometric } from "../../modules/stashr-autofill";

/**
 * Session + vault state for the Android app.
 *
 * status: "booting" | "signedOut" | "locked" | "ready"
 *
 * Items and projects are encrypted with the server's own key, not with
 * anything derived from the account password, so there is no separate
 * vault key on this phone — signing in is enough to see everything.
 * Biometric unlock, where turned on, is just an app-lock gate (a
 * fingerprint/face check) rather than something that releases a key,
 * since there is no key to release.
 */

const K = {
  token: "aurelia_token",
  server: "aurelia_server",
  bio: "aurelia_biometric",
  prefs: "aurelia_prefs",
};
const DEFAULT_PREFS = { autoLock: 0.5, icons: false, autofill: false, autofillBiometric: true }; // minutes; -1 = never
const BIO_OPTIONS = { promptMessage: "Unlock Aurelia" };

const VaultContext = createContext(null);

const safe = async (fn, fallback = null) => {
  try {
    return await fn();
  } catch (e) {
    return fallback;
  }
};

const toItem = (entry) => ({ ...normalizeItem(entry), id: entry._id, createdAt: entry.createdAt, updatedAt: entry.updatedAt });
const toProject = (entry) => ({ ...normalizeProject(entry), id: entry._id, createdAt: entry.createdAt, updatedAt: entry.updatedAt });

export function VaultProvider({ children }) {
  const [status, setStatus] = useState("booting");
  const [profile, setProfile] = useState(null);
  const [items, setItems] = useState([]);
  const [projects, setProjects] = useState([]);
  const [offline, setOffline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [breaches, setBreaches] = useState({});
  const [breachChecked, setBreachChecked] = useState(false);
  const [breachProgress, setBreachProgress] = useState(null);
  const [biometric, setBiometricState] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [prefs, setPrefsState] = useState(DEFAULT_PREFS);

  const backgroundAt = useRef(null);
  const pauseLock = useRef(0);

  /* ── Server profile (+ offline cache of the last known items/projects) ── */
  const loadProfile = useCallback(async () => {
    try {
      const me = await api.me();
      const { passwords, projects: projectEntries, ...rest } = me;
      const decoded = (passwords || []).map(toItem);
      const decodedProjects = (projectEntries || []).map(toProject);
      setProfile(rest);
      setItems(decoded);
      setProjects(decodedProjects);
      setOffline(false);
      SecureStore.setItemAsync(K.server, activeServer()).catch(() => {});
      writeCache({ profile: rest, items: decoded, projects: decodedProjects });
      return { profile: rest };
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 400)) throw e;
      // Network down: fall back to the last cached copy (read-only).
      const cached = await readCache();
      if (!cached) throw e;
      setProfile(cached.profile);
      setItems(cached.items || []);
      setProjects(cached.projects || []);
      setOffline(true);
      return { profile: cached.profile };
    }
  }, []);

  const wipeLocal = useCallback(async () => {
    setToken(null);
    setItems([]);
    setProjects([]);
    setProfile(null);
    setBreaches({});
    setBreachChecked(false);
    safe(() => clearCredentials());
    safe(() => clearLinks());
    await Promise.all([safe(() => SecureStore.deleteItemAsync(K.token)), safe(() => SecureStore.deleteItemAsync(K.bio)), clearCache()]);
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
        setStatus(bio === "1" ? "locked" : "ready");
      } catch (e) {
        await wipeLocal();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      await loadProfile();
      setStatus("ready");
      return { ok: true };
    },
    [loadProfile]
  );

  const unlockWithBiometrics = useCallback(async () => {
    const result = await LocalAuthentication.authenticateAsync(BIO_OPTIONS);
    if (!result.success) throw new Error(result.error === "user_cancel" ? "Cancelled" : "Fingerprint didn't match.");
    setStatus("ready");
  }, []);

  const lock = useCallback(() => {
    setStatus((s) => (s === "ready" ? "locked" : s));
  }, []);

  const setBiometric = useCallback(async (on) => {
    if (on) {
      const result = await LocalAuthentication.authenticateAsync({ ...BIO_OPTIONS, promptMessage: "Confirm it's you" });
      if (!result.success) throw new Error(result.error === "user_cancel" ? "Cancelled" : "Fingerprint didn't match.");
    }
    setBiometricState(on);
    await safe(() => SecureStore.setItemAsync(K.bio, on ? "1" : "0"));
    return true;
  }, []);

  const register = useCallback(async ({ name, email, password }) => {
    await api.register({ name, email, password, cpassword: password });
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
        if (pauseLock.current > 0 || !biometric || prefs.autoLock < 0) return;
        if (status === "ready" && away >= prefs.autoLock * 60 * 1000) lock();
      }
    });
    return () => sub.remove();
  }, [status, biometric, prefs.autoLock, lock]);

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
  const requireOnline = () => {
    if (offline) throw new Error("You're offline. Changes can be made once you're back online.");
  };

  const addItem = useCallback(async (fields) => {
    requireOnline();
    const item = normalizeItem({ ...fields, passwordUpdatedAt: new Date().toISOString() });
    const res = await api.createItem(item);
    const created = toItem(res.item);
    setItems((list) => [created, ...list]);
    return created;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline]);

  const updateItem = useCallback(async (id, fields) => {
    requireOnline();
    const current = items.find((i) => i.id === id);
    const next = normalizeItem({ ...current, ...fields });
    if (current && current.password !== next.password) next.passwordUpdatedAt = new Date().toISOString();
    const res = await api.updateItem(id, next);
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
    requireOnline();
    const now = new Date().toISOString();
    const prepared = list.map((it) => normalizeItem({ ...it, passwordUpdatedAt: it.passwordUpdatedAt || now }));
    const created = [];
    for (let i = 0; i < prepared.length; i += 500) {
      const chunk = prepared.slice(i, i + 500);
      const res = await api.createItems(chunk.map((it) => ({ data: it })));
      res.items.forEach((entry) => created.push(toItem(entry)));
    }
    setItems((l) => [...created, ...l]);
    return created.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline]);

  /* ── Projects (same server-side encrypted scheme, separate collection) ── */
  const addProject = useCallback(async (fields) => {
    requireOnline();
    const project = normalizeProject(fields);
    const res = await api.createProject(project);
    const created = toProject(res.item);
    setProjects((list) => [created, ...list]);
    return created;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline]);

  const updateProject = useCallback(async (id, fields) => {
    requireOnline();
    const current = projects.find((p) => p.id === id);
    const next = normalizeProject({ ...current, ...fields });
    const res = await api.updateProject(id, next);
    setProjects((list) => list.map((p) => (p.id === id ? { ...next, id, createdAt: p.createdAt, updatedAt: res.item.updatedAt } : p)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, offline]);

  const deleteProject = useCallback(async (id) => {
    if (offline) throw new Error("You're offline.");
    await api.deleteProject(id);
    setProjects((list) => list.filter((p) => p.id !== id));
  }, [offline]);

  const importProjects = useCallback(async (list) => {
    requireOnline();
    const prepared = list.map((p) => normalizeProject(p));
    const created = [];
    for (let i = 0; i < prepared.length; i += 500) {
      const chunk = prepared.slice(i, i + 500);
      const res = await api.createProjects(chunk.map((p) => ({ data: p })));
      res.items.forEach((entry) => created.push(toProject(entry)));
    }
    setProjects((l) => [...created, ...l]);
    return created.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline]);

  const refresh = useCallback(async () => {
    setSyncing(true);
    try {
      await loadProfile();
    } finally {
      setSyncing(false);
    }
  }, [loadProfile]);

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
    const res = await api.changePassword({ currentPassword: current, newPassword: next, code: code || undefined });
    if (res.token) {
      setToken(res.token);
      await safe(() => SecureStore.setItemAsync(K.token, res.token));
    }
    await loadProfile();
  }, [loadProfile]);

  const setPrefs = useCallback((patch) => {
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      SecureStore.setItemAsync(K.prefs, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  /* ── Autofill: keep the native service's encrypted copy of the vault in step with it ── */
  useEffect(() => {
    if (status !== "ready" && status !== "locked") return;
    if (prefs.autofill) safe(() => saveCredentials(items));
    else safe(() => clearCredentials());
  }, [status, items, prefs.autofill]);

  useEffect(() => {
    safe(() => setAutofillBiometric(prefs.autofillBiometric));
  }, [prefs.autofillBiometric]);

  /* Logins picked in autofill for a website get saved as that item's website (if it has none), so the extension and other devices know it too. */
  const [foregroundTick, setForegroundTick] = useState(0);
  const syncingLinks = useRef(false);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => s === "active" && setForegroundTick((n) => n + 1));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (status !== "ready" || offline || !prefs.autofill || syncingLinks.current) return;
    const pending = getPendingLinks();
    if (!pending.length) return;
    syncingLinks.current = true;
    (async () => {
      const done = [];
      for (const link of pending) {
        const item = items.find((i) => i.id === link.id);
        if (item && !item.url && link.key.startsWith("web:")) {
          try {
            await updateItem(link.id, { url: link.key.slice(4) });
          } catch (e) {
            continue;
          }
        }
        done.push(link);
      }
      if (done.length) ackPendingLinks(done);
    })().finally(() => {
      syncingLinks.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, offline, prefs.autofill, foregroundTick, items]);

  /* Logins the user saved from Android's "Save password to Stashr?" prompt go into the vault the next time the app is open and online. */
  const syncingSaves = useRef(false);
  useEffect(() => {
    if (status !== "ready" || offline || syncingSaves.current) return;
    const pending = getPendingSaves();
    if (!pending.length) return;
    syncingSaves.current = true;
    (async () => {
      const done = [];
      for (const save of pending) {
        try {
          const same = items.some((i) => i.username === save.username && i.password === save.password && (i.url === save.url || i.name === save.name));
          if (!same) {
            if (save.existingId) await updateItem(save.existingId, { username: save.username, password: save.password });
            else await addItem({ name: save.name, url: save.url, username: save.username, password: save.password });
          }
          done.push(save.ref);
        } catch (e) {
          // still offline or the server said no: keep it queued and try again next time
        }
      }
      if (done.length) ackPendingSaves(done);
    })().finally(() => {
      syncingSaves.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, offline, foregroundTick, items]);

  const value = useMemo(() => {
    const health = computeHealth(items, breaches);
    return {
      status,
      profile,
      items,
      broken: 0,
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
      projects,
      projectsBroken: 0,
      addProject,
      updateProject,
      deleteProject,
      importProjects,
    };
  }, [status, profile, items, offline, syncing, breaches, breachChecked, breachProgress, biometric, biometricAvailable, prefs, setPrefs, login, register, unlockWithBiometrics, lock, logout, wipeLocal, refresh, loadProfile, addItem, updateItem, toggleFavorite, deleteItem, importItems, runBreachCheck, changeMasterPassword, setBiometric, withoutAutoLock, projects, addProject, updateProject, deleteProject, importProjects]);

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
