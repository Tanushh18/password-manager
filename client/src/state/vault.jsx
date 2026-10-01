import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as api from "../api/client";
import { normalizeItem } from "../lib/items";
import { normalizeProject } from "../lib/projectItems";
import { computeHealth } from "../lib/health";
import { pwnedCount } from "../lib/breach";

/**
 * Session + vault state for the website.
 *
 * status:
 *   "checking"  – asking the server who we are
 *   "signedOut" – no session
 *   "ready"     – signed in, items loaded
 *
 * Items and projects are encrypted with the server's own key, not with
 * anything derived from the account password, so there is no separate
 * unlock step: signing in is enough to see everything.
 */

const VaultContext = createContext(null);
const PREFS_KEY = "aurelia_prefs";
const DEFAULT_PREFS = { icons: false, autoLock: 15, searchValues: true };

const readPrefs = () => {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") };
  } catch (e) {
    return DEFAULT_PREFS;
  }
};

const toItem = (entry) => ({ ...normalizeItem(entry), id: entry._id, createdAt: entry.createdAt, updatedAt: entry.updatedAt });
const toProject = (entry) => ({ ...normalizeProject(entry), id: entry._id, createdAt: entry.createdAt, updatedAt: entry.updatedAt });

export function VaultProvider({ children }) {
  const [status, setStatus] = useState("checking");
  const [profile, setProfile] = useState(null); // /authenticate payload minus entries
  const [items, setItems] = useState([]);
  const [breaches, setBreaches] = useState({});
  const [breachProgress, setBreachProgress] = useState(null);
  const [prefs, setPrefsState] = useState(readPrefs);
  const [projects, setProjects] = useState([]);

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
    const { passwords, projects: projectEntries, ...rest } = res.data;
    setProfile(rest);
    setItems((passwords || []).map(toItem));
    setProjects((projectEntries || []).map(toProject));
    return rest;
  }, []);

  /* ── Boot ── */
  useEffect(() => {
    let cancelled = false;
    loadProfile()
      .then(() => !cancelled && setStatus("ready"))
      .catch(() => !cancelled && setStatus("signedOut"));
    return () => {
      cancelled = true;
    };
  }, [loadProfile]);

  const clearVault = useCallback(() => {
    setItems([]);
    setBreaches({});
    setProjects([]);
  }, []);

  /* ── Sign in / up ── */
  const login = useCallback(
    async (email, password, code) => {
      try {
        await api.loginUser({ email, password, code: code || undefined });
      } catch (e) {
        if (e?.response?.data?.twoFactorRequired) return { twoFactorRequired: true, error: code ? api.errorMessage(e) : null };
        throw new Error(api.errorMessage(e, "That email and password don't match."));
      }
      await loadProfile();
      setStatus("ready");
      return { ok: true };
    },
    [loadProfile]
  );

  const register = useCallback(async ({ name, email, password }) => {
    try {
      await api.signupUser({ name, email, password, cpassword: password });
    } catch (e) {
      throw new Error(api.errorMessage(e, "We couldn't create your account."));
    }
  }, []);

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

  /* ── Items ── */
  const addItem = useCallback(async (fields) => {
    const item = normalizeItem({ ...fields, passwordUpdatedAt: new Date().toISOString() });
    const res = await api.createItem(item);
    const created = toItem(res.data.item);
    setItems((list) => [created, ...list]);
    return created;
  }, []);

  const updateItem = useCallback(async (id, fields) => {
    const current = items.find((i) => i.id === id);
    const next = normalizeItem({ ...current, ...fields });
    if (current && current.password !== next.password) next.passwordUpdatedAt = new Date().toISOString();
    const res = await api.updateItem(id, next);
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

  /* ── Projects ── */
  const addProject = useCallback(async (fields) => {
    const project = normalizeProject(fields);
    const res = await api.createProject(project);
    const created = toProject(res.data.item);
    setProjects((list) => [created, ...list]);
    return created;
  }, []);

  const updateProjectEntry = useCallback(async (id, fields) => {
    const current = projects.find((p) => p.id === id);
    const next = normalizeProject({ ...current, ...fields });
    const res = await api.updateProject(id, next);
    setProjects((list) => list.map((p) => (p.id === id ? { ...next, id, createdAt: p.createdAt, updatedAt: res.data.item.updatedAt } : p)));
  }, [projects]);

  const deleteProjectEntry = useCallback(async (id) => {
    await api.deleteProject(id);
    setProjects((list) => list.filter((p) => p.id !== id));
  }, []);

  const importProjects = useCallback(async (list, onProgress) => {
    const prepared = list.map((p) => normalizeProject(p));
    const created = [];
    for (let i = 0; i < prepared.length; i += 500) {
      const chunk = prepared.slice(i, i + 500);
      const res = await api.createProjects(chunk.map((p) => ({ data: p })));
      res.data.items.forEach((entry) => created.push(toProject(entry)));
      onProgress?.(Math.min(prepared.length, i + chunk.length), prepared.length);
    }
    setProjects((list2) => [...created, ...list2]);
    return created.length;
  }, []);

  const importItems = useCallback(async (list, onProgress) => {
    const now = new Date().toISOString();
    const prepared = list.map((it) => normalizeItem({ ...it, passwordUpdatedAt: it.passwordUpdatedAt || now }));
    const created = [];
    for (let i = 0; i < prepared.length; i += 500) {
      const chunk = prepared.slice(i, i + 500);
      const res = await api.createItems(chunk.map((it) => ({ data: it })));
      res.data.items.forEach((entry) => created.push(toItem(entry)));
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
  const changePassword = useCallback(async ({ current, next, code }) => {
    try {
      await api.changePassword({ currentPassword: current, newPassword: next, code: code || undefined });
    } catch (e) {
      const err = new Error(api.errorMessage(e, "Couldn't change your password."));
      err.twoFactorRequired = Boolean(e?.response?.data?.twoFactorRequired);
      throw err;
    }
    await loadProfile();
  }, [loadProfile]);

  const refreshProfile = useCallback(() => loadProfile().catch(() => null), [loadProfile]);

  const value = useMemo(() => {
    const health = computeHealth(items, breaches);
    return {
      status,
      profile,
      items,
      broken: 0,
      health,
      breaches,
      breachProgress,
      prefs,
      setPrefs,
      login,
      register,
      logout,
      addItem,
      updateItem,
      toggleFavorite,
      deleteItem,
      importItems,
      runBreachCheck,
      changePassword,
      refreshProfile,
      setProfileName: (name) => setProfile((p) => (p ? { ...p, name } : p)),
      projects,
      projectsBroken: 0,
      addProject,
      updateProject: updateProjectEntry,
      deleteProject: deleteProjectEntry,
      importProjects,
    };
  }, [
    status, profile, items, breaches, breachProgress, prefs, setPrefs, login, register, logout,
    addItem, updateItem, toggleFavorite, deleteItem, importItems, runBreachCheck, changePassword, refreshProfile,
    projects, addProject, updateProjectEntry, deleteProjectEntry, importProjects,
  ]);

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export const useVault = () => useContext(VaultContext);
