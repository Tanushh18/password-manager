import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";
import { api, ApiError, setToken, activeServer, setActiveServer } from "./api";

const K = {
  token: "aurelia_token",
  server: "aurelia_server",
  bio: "aurelia_biometric",
  user: "aurelia_user",
};
const RELOCK_AFTER_MS = 30 * 1000;

const VaultContext = createContext(null);

const safe = async (fn, fallback = null) => {
  try {
    return await fn();
  } catch (e) {
    return fallback;
  }
};

/**
 * Session + vault state for the whole app.
 * status: "booting" | "signedOut" | "locked" | "ready"
 */
export function VaultProvider({ children }) {
  const [status, setStatus] = useState("booting");
  const [user, setUser] = useState(null);
  const [passwords, setPasswords] = useState([]);
  const [insights, setInsights] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [biometric, setBiometricState] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const plain = useRef(new Map()); // decrypted values, memory only
  const backgroundAt = useRef(null);

  const persistServer = () => SecureStore.setItemAsync(K.server, activeServer()).catch(() => {});

  const loadInsights = useCallback(async () => {
    const data = await safe(() => api.insights());
    if (data) setInsights(data);
  }, []);

  const refresh = useCallback(async () => {
    setSyncing(true);
    try {
      const me = await api.me();
      setUser({ name: me.name, email: me.email });
      setPasswords(me.passwords || []);
      SecureStore.setItemAsync(K.user, JSON.stringify({ name: me.name, email: me.email })).catch(() => {});
      persistServer();
      loadInsights();
      return true;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 400 || e.status === 401)) {
        await signOutLocal();
      }
      throw e;
    } finally {
      setSyncing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadInsights]);

  const signOutLocal = useCallback(async () => {
    setToken(null);
    plain.current.clear();
    setUser(null);
    setPasswords([]);
    setInsights(null);
    setStatus("signedOut");
    await Promise.all([safe(() => SecureStore.deleteItemAsync(K.token)), safe(() => SecureStore.deleteItemAsync(K.user))]);
  }, []);

  /* ── Boot: restore the saved session ── */
  useEffect(() => {
    (async () => {
      const [savedToken, savedServer, bio, savedUser, hasHw, enrolled] = await Promise.all([
        safe(() => SecureStore.getItemAsync(K.token)),
        safe(() => SecureStore.getItemAsync(K.server)),
        safe(() => SecureStore.getItemAsync(K.bio)),
        safe(() => SecureStore.getItemAsync(K.user)),
        safe(() => LocalAuthentication.hasHardwareAsync(), false),
        safe(() => LocalAuthentication.isEnrolledAsync(), false),
      ]);
      setBiometricAvailable(Boolean(hasHw && enrolled));
      setBiometricState(bio === "1");
      if (savedServer) setActiveServer(savedServer);

      if (!savedToken) {
        setStatus("signedOut");
        return;
      }
      setToken(savedToken === "cookie" ? null : savedToken);
      if (savedUser) setUser(safeParse(savedUser));

      if (bio === "1" && hasHw && enrolled) {
        setStatus("locked");
        return;
      }
      setStatus("ready");
      refresh().catch(() => {});
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Auto-lock when the app comes back after a while ── */
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background" || next === "inactive") {
        if (!backgroundAt.current) backgroundAt.current = Date.now();
        return;
      }
      if (next === "active") {
        const away = backgroundAt.current ? Date.now() - backgroundAt.current : 0;
        backgroundAt.current = null;
        if (status === "ready" && biometric && biometricAvailable && away > RELOCK_AFTER_MS) {
          plain.current.clear();
          setStatus("locked");
        }
      }
    });
    return () => sub.remove();
  }, [status, biometric, biometricAvailable]);

  const unlock = useCallback(async () => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Unlock Aurelia",
      promptSubtitle: "Confirm it's you to open your vault",
      cancelLabel: "Cancel",
    });
    if (result.success) {
      setStatus("ready");
      refresh().catch(() => {});
    }
    return result.success;
  }, [refresh]);

  const login = useCallback(
    async (email, password) => {
      const res = await api.login(email.trim(), password);
      if (res?.token) {
        setToken(res.token);
        await safe(() => SecureStore.setItemAsync(K.token, res.token));
      } else {
        // Older server without bearer support: the session cookie carries us.
        await safe(() => SecureStore.setItemAsync(K.token, "cookie"));
      }
      await refresh();
      setStatus("ready");
    },
    [refresh]
  );

  const register = useCallback((data) => api.register(data), []);

  const logout = useCallback(async () => {
    await safe(() => api.logout());
    await signOutLocal();
  }, [signOutLocal]);

  const add = useCallback(
    async ({ platform, platEmail, userPass }) => {
      await api.add({ platform, platEmail: platEmail || "NA", userPass, userEmail: user?.email || "" });
      await refresh();
    },
    [refresh, user]
  );

  const update = useCallback(
    async ({ id, platform, platEmail, userPass }) => {
      await api.update({ id, platform, platEmail, userPass });
      plain.current.delete(id);
      await refresh();
    },
    [refresh]
  );

  const remove = useCallback(async (id) => {
    await api.remove(id);
    plain.current.delete(id);
    setPasswords((list) => list.filter((p) => p._id !== id));
    loadInsights();
  }, [loadInsights]);

  const reveal = useCallback(async (entry) => {
    const cached = plain.current.get(entry._id);
    if (cached !== undefined) return cached;
    const value = await api.decrypt(entry);
    const text = typeof value === "string" ? value : String(value ?? "");
    plain.current.set(entry._id, text);
    return text;
  }, []);

  const setBiometric = useCallback(
    async (on) => {
      if (on) {
        const res = await LocalAuthentication.authenticateAsync({ promptMessage: "Turn on biometric unlock" });
        if (!res.success) return false;
      }
      setBiometricState(on);
      await safe(() => SecureStore.setItemAsync(K.bio, on ? "1" : "0"));
      return true;
    },
    []
  );

  const value = useMemo(
    () => ({
      status,
      user,
      passwords,
      insights,
      syncing,
      biometric,
      biometricAvailable,
      login,
      register,
      logout,
      refresh,
      add,
      update,
      remove,
      reveal,
      unlock,
      setBiometric,
    }),
    [status, user, passwords, insights, syncing, biometric, biometricAvailable, login, register, logout, refresh, add, update, remove, reveal, unlock, setBiometric]
  );

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

/** Map of insight items keyed by password id. */
export const useInsightMap = () => {
  const { insights } = useVault();
  return useMemo(() => {
    const map = {};
    (insights?.items || []).forEach((i) => {
      map[i.id] = i;
    });
    return map;
  }, [insights]);
};
