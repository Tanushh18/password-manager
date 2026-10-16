import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import * as api from "../api/client";
import { bootVerdict, bootDelay } from "../lib/errors";
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
const DEFAULT_PREFS = { icons: false, searchValues: true };

const readPrefs = () => {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") };
  } catch (e) {
    return DEFAULT_PREFS;
  }
};

const SYNC_MS = 60 * 1000;            // passwords + projects re-read from the server while the tab is visible
// Cheap fingerprint of the lists, so an unchanged background sync does not re-render everything.
const signature = (list) => (list || []).map((e) => e._id + ":" + (e.updatedAt || "")).join("|");

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

  const lastSig = useRef({ items: null, projects: null });
  const loadProfile = useCallback(async () => {
    const res = await api.checkAuthenticated().catch((e) => { console.warn("[stashr] /authenticate failed", { status: e?.response?.status, error: e?.response?.data?.error, server: api.API_URL(), code: e?.code }); throw e; });
    const { passwords, projects: projectEntries, ...rest } = res.data;
    setProfile(rest);
    const itemsSig = signature(passwords), projectsSig = signature(projectEntries);
    if (itemsSig !== lastSig.current.items) { lastSig.current.items = itemsSig; setItems((passwords || []).map(toItem)); }
    if (projectsSig !== lastSig.current.projects) { lastSig.current.projects = projectsSig; setProjects((projectEntries || []).map(toProject)); }
    return rest;
  }, []);

  /* ── Boot: a saved session is only dropped when the server says it is invalid (401). A sleeping server or a network
        error says nothing about the session, so keep it and try again instead of showing the sign-in page. ── */
  const [waking, setWaking] = useState(false);
  useEffect(() => {
    let cancelled = false, timer = null, attempt = 0;
    const run = () => {
      loadProfile()
        .then(() => { if (!cancelled) { setWaking(false); setStatus("ready"); } })
        .catch((error) => {
          if (cancelled) return;
          if (bootVerdict(error, attempt) === "signedOut") { if (error?.response?.status === 401) api.setBearer(""); setWaking(false); setStatus("signedOut"); return; }
          setWaking(true);
          timer = window.setTimeout(run, bootDelay(attempt));
          attempt += 1;
        });
    };
    run();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [loadProfile]);

  const clearVault = useCallback(() => {
    lastSig.current = { items: null, projects: null };
    setItems([]);
    setBreaches({});
    setProjects([]);
  }, []);

  /* ── Sign in / up ── */
  const login = useCallback(
    async (email, password, code) => {
      let loginResponse = null;
      try {
        loginResponse = await api.loginUser({ email, password, code: code || undefined, returnToken: true });
      } catch (e) {
        if (e?.response?.data?.twoFactorRequired) return { twoFactorRequired: true, error: code ? api.errorMessage(e) : null };
        const status = e?.response?.status;
        const error = new Error(api.errorMessage(e, "That email and password don't match."));
        error.kind = !e?.response ? "network" : status === 429 ? "limited" : status >= 500 ? "server" : status === 400 || status === 401 ? "credentials" : "other";
        throw error;
      }
      console.info("[stashr] login accepted by", api.API_URL());
      api.setBearer("");
      try {
        try {
          await loadProfile();
        } catch (first) {
          // The browser did not keep the session cookie (cross-site cookies blocked): use the token instead.
          const token = loginResponse?.data?.token;
          if (first?.response?.status !== 401 || !token) throw first;
          console.warn("[stashr] the browser blocked the session cookie, using the token fallback");
          api.setBearer(token);
          await loadProfile();
        }
      } catch (e) {
        api.setBearer("");
        console.error("[stashr] login worked but the session check failed", { status: e?.response?.status, data: e?.response?.data, server: api.API_URL(), message: e?.message });
        const error = new Error(e?.response?.status === 401
          ? "Signed in, but the browser did not keep the session. Allow third-party cookies / cross-site cookies for this site, then try again."
          : api.errorMessage(e, "Signed in, but your vault could not be loaded."));
        error.kind = !e?.response ? "network" : e.response.status >= 500 ? "server" : "other";
        throw error;
      }
      setStatus("ready");
      return { ok: true };
    },
    [loadProfile]
  );

  const register = useCallback(async ({ name, email, password }) => {
    try {
      await api.signupUser({ name, email, password, cpassword: password });
    } catch (e) {
      const error = new Error(api.errorMessage(e, "We couldn't create your account."));
      error.kind = !e?.response ? "network" : e.response.status === 429 ? "limited" : e.response.status >= 500 ? "server" : "invalid";
      throw error;
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

  /* Lock = sign out on this device: everything is hidden until you sign in again. */
  const lock = useCallback(async () => {
    await logout();
  }, [logout]);

  /* ── Auto-sync: changes made in the extension, the app or another tab show up here on their own ── */
  useEffect(() => {
    if (status !== "ready") return undefined;
    let timer = null;
    const sync = () => {
      if (document.hidden) return;
      loadProfile().catch((e) => { if (e?.response?.status === 401) { clearVault(); setProfile(null); setStatus("signedOut"); } });
    };
    const onVisible = () => { if (!document.hidden) sync(); };
    timer = window.setInterval(sync, SYNC_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", sync);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", sync); };
  }, [status, loadProfile, clearVault]);


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
      lock,
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
    status, waking, profile, items, breaches, breachProgress, prefs, setPrefs, login, register, logout, lock,
    addItem, updateItem, toggleFavorite, deleteItem, importItems, runBreachCheck, changePassword, refreshProfile,
    projects, addProject, updateProjectEntry, deleteProjectEntry, importProjects,
  ]);

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export const useVault = () => useContext(VaultContext);
