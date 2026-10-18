import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

/* Every Render service across the connected accounts, as one flat list (shared by Servers, Monitoring and detail). */
let cache = null;
const subs = new Set();

export const unwrap = (list, key) => (Array.isArray(list) ? list : []).map((row) => row?.[key] || row).filter(Boolean);

const flat = (account, s) => ({
  key: `${account.id}:${s.id}`, accountId: account.id, accountName: account.name, id: s.id, name: s.name || s.id, type: s.type || "",
  suspended: s.suspended === "suspended", url: s.serviceDetails?.url || "", plan: s.serviceDetails?.plan || s.serviceDetails?.buildPlan || "",
  region: s.serviceDetails?.region || "", repo: s.repo || "", branch: s.branch || "", dashboardUrl: s.dashboardUrl || "",
});

export function useServers() {
  const [data, setData] = useState(cache);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { subs.add(setData); return () => subs.delete(setData); }, []);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { accounts } = await api.renderAccounts();
      const lists = await Promise.all(accounts.map((a) => api.renderServices(a.id).then((r) => unwrap(r.services, "service").map((s) => flat(a, s))).catch(() => null)));
      const failed = lists.filter((l) => l === null).length;
      cache = { accounts, services: lists.flat().filter(Boolean), failed };
      subs.forEach((fn) => fn(cache));
      setError("");
    } catch (e) { setError(e.message || "Could not load servers."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (!cache) reload(); }, [reload]);
  return { data, loading, error, reload };
}
