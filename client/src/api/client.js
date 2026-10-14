import axios from "axios";

// API servers, in order of preference. If one is down the client falls over
// to the next. Override with REACT_APP_API_URLS (comma separated) at build time.
// xxdr is the fixed address apps use to find the current server list (see "Server registry" below).
const DEFAULT_SERVERS = [
    "https://password-manager-server-xxdr.onrender.com",
    "https://password-manager-server-8gvj.onrender.com"
];

const SERVERS = (import.meta.env.VITE_API_URLS || import.meta.env.REACT_APP_API_URLS || import.meta.env.REACT_APP_API_URL || "")
    .split(",")
    .map((u) => u.trim().replace(/\/+$/, ""))
    .filter(Boolean);
if (SERVERS.length === 0) SERVERS.push(...DEFAULT_SERVERS);

// Servers come from the Stashr registry (edited on the Servers page), so changing a URL never needs a
// redeploy. The build-time list above is only the bootstrap: it is asked for the registry on start,
// the last answer is cached on this device, and the bootstrap stays at the end as a last resort.
const BOOTSTRAP = [...SERVERS];
const REGISTRY_CACHE_KEY = "pm_registry_stashr";
const REGISTRY_APP = "stashr";

const mergeServers = (fresh) =>
{
    const list = [...fresh, ...BOOTSTRAP].filter((u, i, a) => u && a.indexOf(u) === i);
    const current = SERVERS[active];
    SERVERS.splice(0, SERVERS.length, ...list);
    const i = SERVERS.indexOf(current);
    active = i >= 0 ? i : 0;
};

const cleanList = (urls) =>
    (Array.isArray(urls) ? urls : [])
        .map((u) => (typeof u === "string" ? u.trim().replace(/\/+$/, "") : ""))
        .filter((u) => /^https?:\/\//i.test(u));

const STORAGE_KEY = "pm_active_server";
const REQUEST_TIMEOUT_MS = 20000;

const readActive = () =>
{
    try
    {
        const i = SERVERS.indexOf(sessionStorage.getItem(STORAGE_KEY));
        return i >= 0 ? i : 0;
    }
    catch (e) { return 0; }
};

// Sticky: keep using the server that last worked (its login cookie lives there).
let active = readActive();
const setActive = (i) =>
{
    active = i;
    try { sessionStorage.setItem(STORAGE_KEY, SERVERS[i]); } catch (e) { /* ignore */ }
};

try
{
    const cached = cleanList(JSON.parse(localStorage.getItem(REGISTRY_CACHE_KEY) || "[]"));
    if (cached.length) mergeServers(cached);
}
catch (e) { /* no cache yet */ }

const instance = axios.create({
    headers: {
        "Accept": "application/json",
        "Content-Type": "application/json"
    },
    timeout: REQUEST_TIMEOUT_MS,
    withCredentials: true
});

instance.interceptors.request.use((config) =>
{
    if (config._server === undefined) config._server = active;
    config.baseURL = SERVERS[config._server];
    return config;
});

// Down = no response at all (network error / timeout) or a gateway error.
const isServerDown = (error) =>
    !error.response || [502, 503, 504].includes(error.response.status);

instance.interceptors.response.use(
    (response) =>
    {
        if (response.config._server !== undefined && response.config._server !== active)
            setActive(response.config._server);
        return response;
    },
    (error) =>
    {
        const config = error.config;
        if (!config || !isServerDown(error) || SERVERS.length < 2) return Promise.reject(error);

        config._tried = (config._tried || 0) + 1;
        if (config._tried >= SERVERS.length) return Promise.reject(error);

        config._server = (config._server + 1) % SERVERS.length;
        return instance(config);
    }
);

export const API_URL = () => SERVERS[active];

// Ask the servers for the current list (in the background, never blocks the UI).
export const refreshServers = async () =>
{
    for (const base of [...SERVERS])
    {
        try
        {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 60000);
            const res = await fetch(`${base}/registry/${REGISTRY_APP}`, { signal: controller.signal });
            clearTimeout(timer);
            if (!res.ok) continue;
            const urls = cleanList((await res.json()).urls);
            if (!urls.length) continue;
            mergeServers(urls);
            try { localStorage.setItem(REGISTRY_CACHE_KEY, JSON.stringify(urls)); } catch (e) { /* ignore */ }
            return urls;
        }
        catch (e) { /* try the next server */ }
    }
    return null;
};
refreshServers();

/* ── Server registry (admin only) ── */
export const getRegistry = () => instance.get("/registry");
export const saveRegistry = (app, urls) => instance.put(`/registry/${app}`, { urls });
export const checkServer = (url) => instance.post("/registry/check", { url }, { timeout: 30000 });

/* ── Auth ── */
export const checkAuthenticated = () => instance.get("/authenticate");
export const loginUser = (data) => instance.post("/login", data);
export const logoutUser = () => instance.get("/logout");
export const signupUser = (data) => instance.post("/register", data);

/* ── Vault (server-side encrypted) ── */
export const createItem = (data) => instance.post("/vault/items", { data });
export const createItems = (items) => instance.post("/vault/items/bulk", { items });
export const updateItem = (id, data) => instance.put(`/vault/items/${id}`, { data });
export const deleteItem = (id) => instance.delete(`/vault/items/${id}`);

/* ── Project tracker (server-side encrypted) ── */
export const createProject = (data) => instance.post("/projects/items", { data });
export const createProjects = (items) => instance.post("/projects/items/bulk", { items });
export const updateProject = (id, data) => instance.put(`/projects/items/${id}`, { data });
export const deleteProject = (id) => instance.delete(`/projects/items/${id}`);

/* ── Account ── */
export const updateProfile = (name) => instance.post("/account/profile", { name });
export const changePassword = (data) => instance.post("/account/password", data);
export const logoutEverywhere = () => instance.post("/account/logout-all");
export const deleteAccount = (data) => instance.post("/account/delete", data);
export const twoFactorSetup = (password) => instance.post("/2fa/setup", { password });
export const twoFactorEnable = (code) => instance.post("/2fa/enable", { code });
export const twoFactorDisable = (data) => instance.post("/2fa/disable", data);
export const twoFactorRecoveryCodes = (data) => instance.post("/2fa/recovery-codes", data);

// Health probe used by the live status indicators (and by the cron job server side).
export const checkHealth = () => instance.get("/health", { withCredentials: false });

export const errorMessage = (err, fallback = "Something went wrong. Please try again.") =>
    err?.response?.data?.error ||
    (!err?.response ? "We can't reach the vault right now. The free server may be waking up — try again in a moment." : fallback);

/* ── Render dashboard (all requests use Stashr's authenticated session) ── */
export const getRenderAccounts = () => instance.get("/render/accounts").then((r) => r.data);
export const connectRenderAccount = (data) => instance.post("/render/accounts", data).then((r) => r.data);
export const deleteRenderAccount = (id) => instance.delete("/render/accounts/" + encodeURIComponent(id)).then((r) => r.data);
export const getRenderServices = (accountId) => instance.get("/render/accounts/" + encodeURIComponent(accountId) + "/services").then((r) => r.data);
export const getRenderLogs = (accountId, params) => instance.get("/render/accounts/" + encodeURIComponent(accountId) + "/logs?" + new URLSearchParams(params).toString()).then((r) => r.data);
export const getRenderEnvVars = (accountId, serviceId) => instance.get("/render/accounts/" + encodeURIComponent(accountId) + "/services/" + encodeURIComponent(serviceId) + "/env-vars").then((r) => r.data);
export const updateRenderEnvVar = (accountId, serviceId, key, value) => instance.put("/render/accounts/" + encodeURIComponent(accountId) + "/services/" + encodeURIComponent(serviceId) + "/env-vars/" + encodeURIComponent(key), { value }).then((r) => r.data);
export const deleteRenderEnvVar = (accountId, serviceId, key) => instance.delete("/render/accounts/" + encodeURIComponent(accountId) + "/services/" + encodeURIComponent(serviceId) + "/env-vars/" + encodeURIComponent(key)).then((r) => r.data);
export const getRenderDeploys = (accountId, serviceId) => instance.get("/render/accounts/" + encodeURIComponent(accountId) + "/services/" + encodeURIComponent(serviceId) + "/deploys").then((r) => r.data);
export const triggerRenderDeploy = (accountId, serviceId, clearCache = false) => instance.post("/render/accounts/" + encodeURIComponent(accountId) + "/services/" + encodeURIComponent(serviceId) + "/deploys", { clearCache }).then((r) => r.data);
export const restartRenderService = (accountId, serviceId) => instance.post("/render/accounts/" + encodeURIComponent(accountId) + "/services/" + encodeURIComponent(serviceId) + "/restart").then((r) => r.data);
export const checkRenderHealth = (accountId, serviceId) => instance.get(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/health`).then((r) => r.data);
export const deleteRenderService = (accountId, serviceId, confirmName) => instance.delete(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}`, { data: { confirmName } }).then((r) => r.data);
export const bulkDeleteRenderServices = (services) => instance.post("/render/services/bulk-delete", { services }, { timeout: 120000 }).then((r) => r.data);
export const suspendRenderService = (accountId, serviceId) => instance.post(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/suspend`).then((r) => r.data);
export const resumeRenderService = (accountId, serviceId) => instance.post(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/resume`).then((r) => r.data);
export const rollbackRenderDeploy = (accountId, serviceId, deployId) => instance.post(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/rollback`, { deployId }).then((r) => r.data);
export const cancelRenderDeploy = (accountId, serviceId, deployId) => instance.post(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/deploys/${encodeURIComponent(deployId)}/cancel`).then((r) => r.data);
export const createRenderSnapshot = (accountId, serviceId) => instance.post(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/snapshots`).then((r) => r.data);
export const getRenderSnapshots = (accountId, serviceId) => instance.get(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/snapshots`).then((r) => r.data);
export const restoreRenderSnapshot = (accountId, serviceId, snapshotId) => instance.post(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/snapshots/${encodeURIComponent(snapshotId)}/restore`).then((r) => r.data);
export const getRenderAudit = (limit = 50) => instance.get("/render/audit?limit=" + encodeURIComponent(limit)).then((r) => r.data);
export const getRenderEnvGroups = (accountId) => instance.get(`/render/accounts/${encodeURIComponent(accountId)}/env-groups`).then((r) => r.data);


export const getRenderMetrics = (accountId, serviceId, metric, startTime) => instance.get(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/metrics`, { params: { metric, startTime, resolutionSeconds: 60 } }).then((r) => r.data);

export const getRenderDbExports = (accountId, postgresId) => instance.get(`/render/accounts/${encodeURIComponent(accountId)}/postgres/${encodeURIComponent(postgresId)}/exports`).then((r) => r.data);
export const createRenderDbExport = (accountId, postgresId) => instance.post(`/render/accounts/${encodeURIComponent(accountId)}/postgres/${encodeURIComponent(postgresId)}/exports`).then((r) => r.data);

export const syncProjectRenderEnv = (projectId, options = {}) => instance.post("/render/project-sync/" + encodeURIComponent(projectId), options, { timeout: 60000 }).then((r) => r.data);

/* Automatic upkeep: live project health/drift (auto-links to Render first) and Servers-tab sync. */
export const getProjectStatuses = ({ id, refresh } = {}) => instance.get("/render/projects/status", { params: { ...(id ? { id } : {}), ...(refresh ? { refresh: 1 } : {}) }, timeout: 60000 }).then((r) => r.data);
export const getRegistrySync = () => instance.get("/render/registry-sync", { timeout: 60000 }).then((r) => r.data);
export const setRegistryAutoSync = (app, autoSync) => instance.put("/render/registry-sync/" + encodeURIComponent(app), { autoSync }).then((r) => r.data);

/* GitHub connections for the Projects page (tokens stay encrypted server-side). */
export const getGithubAccounts = () => instance.get("/github/accounts").then((r) => r.data);
export const connectGithubAccount = (data) => instance.post("/github/accounts", data).then((r) => r.data);
export const deleteGithubAccount = (id) => instance.delete("/github/accounts/" + encodeURIComponent(id)).then((r) => r.data);
export const getGithubRepo = (url, refresh = false) => instance.get("/github/repo", { params: { url, ...(refresh ? { refresh: 1 } : {}) } }).then((r) => r.data);

/* Persistent Render operations: all credentials remain encrypted server-side. */
export const getRenderOpsConfig = () => instance.get("/render/ops/config").then((r) => r.data);
export const saveRenderOpsConfig = (config) => instance.put("/render/ops/config", config).then((r) => r.data);
export const getRenderOpsHistory = (limit = 100) => instance.get("/render/ops/history", { params: { limit } }).then((r) => r.data);
export const getRenderOpsIncidents = (limit = 100) => instance.get("/render/ops/incidents", { params: { limit } }).then((r) => r.data);
export const runRenderOpsNow = () => instance.post("/render/ops/run").then((r) => r.data);
export const testRenderOpsNotification = () => instance.post("/render/ops/notify/test").then((r) => r.data);
export const getRenderOpsReport = (format = "json") => instance.get("/render/ops/report", { params: { format }, responseType: format === "csv" ? "blob" : "json" }).then((r) => r.data);
export const diagnoseRenderLogs = (serviceName, logs, allowExternalProcessing = false) => instance.post("/render/ops/diagnose", { serviceName, logs, allowExternalProcessing }).then((r) => r.data);
