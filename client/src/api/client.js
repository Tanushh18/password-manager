import axios from "axios";

// API servers, in order of preference. If one is down the client falls over
// to the next. Override with REACT_APP_API_URLS (comma separated) at build time.
// xxdr is the fixed address apps use to find the current server list (see "Server registry" below).
// (…-8gvj was deleted on Render; it is no longer listed, and dead servers are skipped automatically anyway.)
const DEFAULT_SERVERS = [
    "https://password-manager-server-xxdr.onrender.com"
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

// The session cookie lives on the one server that signed you in. Remember it, so a failover to another server (which
// has no cookie) is never mistaken for "you are signed out".
const SESSION_SERVER_KEY = "pm_session_server";
const readSessionServer = () => { try { return localStorage.getItem(SESSION_SERVER_KEY) || ""; } catch (e) { return ""; } };
const writeSessionServer = (url) => { try { if (url) localStorage.setItem(SESSION_SERVER_KEY, url); else localStorage.removeItem(SESSION_SERVER_KEY); } catch (e) { /* private mode */ } };
const isAuthUrl = (url) => /\/(login|register|authenticate|logout)$/.test(String(url || "").split("?")[0]);

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
        // The server that just signed us in (or confirmed the session) is the one that holds the cookie.
        if (/\/(login|authenticate)$/.test(String(response.config.url || "").split("?")[0]) && SERVERS[response.config._server])
            writeSessionServer(SERVERS[response.config._server]);
        if (/\/logout$/.test(String(response.config.url || "").split("?")[0])) writeSessionServer("");
        return response;
    },
    (error) =>
    {
        const config = error.config;
        // A 401 from a server that never signed us in is not "signed out": ask the server that holds the session once.
        if (config && error.response?.status === 401 && !config._sessionRetry && !/\/(login|register)$/.test(String(config.url || "").split("?")[0]))
        {
            const home = SERVERS.indexOf(readSessionServer());
            if (home >= 0 && home !== config._server)
            {
                config._sessionRetry = true;
                config._server = home;
                return instance(config);
            }
        }
        if (!config || !isServerDown(error)) return Promise.reject(error);

        // Render's free plan sleeps; waking takes up to a minute. Give the same server one long retry first.
        const timedOut = error.code === "ECONNABORTED" || /timeout/i.test(String(error.message || ""));
        if (timedOut && !config._woke)
        {
            config._woke = true;
            config.timeout = Math.max(config.timeout || 0, 75000);
            return instance(config);
        }
        if (SERVERS.length < 2) return Promise.reject(error);

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
// A server Render no longer routes (deleted service) fails at once with no CORS headers; a sleeping one is just slow.
// Drop the dead ones so a cold start never fails over to a server that does not exist.
const pruneDeadServers = async () =>
{
    if (SERVERS.length < 2) return;
    const dead = [];
    await Promise.all(SERVERS.map(async (base) =>
    {
        const started = Date.now();
        try
        {
            const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(90000) });
            if (!res.ok && res.status === 404) dead.push(base);
        }
        catch (e) { if (Date.now() - started < 8000 && e?.name !== "TimeoutError") dead.push(base); }
    }));
    const alive = SERVERS.filter((u) => !dead.includes(u));
    if (!alive.length || !dead.length) return;
    const current = SERVERS[active];
    SERVERS.splice(0, SERVERS.length, ...alive);
    const i = SERVERS.indexOf(current);
    setActive(i >= 0 ? i : 0);
};
refreshServers().finally(() => { pruneDeadServers().catch(() => {}); });

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

export { errorMessage } from "../lib/errors.js";

/* ── Render dashboard (all requests use Stashr's authenticated session) ── */
export const getRenderAccounts = () => instance.get("/render/accounts").then((r) => r.data);
export const connectRenderAccount = (data) => instance.post("/render/accounts", data).then((r) => r.data);
export const deleteRenderAccount = (id) => instance.delete("/render/accounts/" + encodeURIComponent(id)).then((r) => r.data);
export const getRenderServices = (accountId) => instance.get("/render/accounts/" + encodeURIComponent(accountId) + "/services").then((r) => r.data);
export const renameRenderService = (accountId, serviceId, name) => instance.patch(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/name`, { name }).then((r) => r.data);
export const getRenderLogs = (accountId, params) => instance.get("/render/accounts/" + encodeURIComponent(accountId) + "/logs?" + new URLSearchParams(params).toString()).then((r) => r.data);
export const getRenderEnvVars = (accountId, serviceId) => instance.get("/render/accounts/" + encodeURIComponent(accountId) + "/services/" + encodeURIComponent(serviceId) + "/env-vars").then((r) => r.data);
export const updateRenderEnvVar = (accountId, serviceId, key, value) => instance.put("/render/accounts/" + encodeURIComponent(accountId) + "/services/" + encodeURIComponent(serviceId) + "/env-vars/" + encodeURIComponent(key), { value }).then((r) => r.data);
export const deleteRenderEnvVar = (accountId, serviceId, key) => instance.delete("/render/accounts/" + encodeURIComponent(accountId) + "/services/" + encodeURIComponent(serviceId) + "/env-vars/" + encodeURIComponent(key)).then((r) => r.data);
export const getRenderDeploys = (accountId, serviceId) => instance.get("/render/accounts/" + encodeURIComponent(accountId) + "/services/" + encodeURIComponent(serviceId) + "/deploys").then((r) => r.data);
export const triggerRenderDeploy = (accountId, serviceId, clearCache = false) => instance.post("/render/accounts/" + encodeURIComponent(accountId) + "/services/" + encodeURIComponent(serviceId) + "/deploys", { clearCache }).then((r) => r.data);
export const restartRenderService = (accountId, serviceId) => instance.post("/render/accounts/" + encodeURIComponent(accountId) + "/services/" + encodeURIComponent(serviceId) + "/restart").then((r) => r.data);
export const checkRenderHealth = (accountId, serviceId) => instance.get(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/health`).then((r) => r.data);
export const deleteRenderService = (accountId, serviceId, confirmName, allowActive = false) => instance.delete(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}`, { data: { confirmName, ...(allowActive ? { allowActive: true } : {}) } }).then((r) => r.data);
export const bulkDeleteRenderServices = (services, allowActive = false) => instance.post("/render/services/bulk-delete", { services, ...(allowActive ? { allowActive: true } : {}) }, { timeout: 120000 }).then((r) => r.data);
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

/* One-click create & deploy (GitHub repo + free Render service + env vars) and Stashr -> Render env push. */
export const getRenderOwners = (accountId) => instance.get("/render/accounts/" + encodeURIComponent(accountId) + "/owners").then((r) => r.data);
export const provisionProject = (body) => instance.post("/render/provision", body, { timeout: 180000 }).then((r) => r.data);
export const createRepo = (body) => instance.post("/render/repo/create", body, { timeout: 120000 }).then((r) => r.data);
export const checkRepoCode = (body) => instance.post("/render/repo/check", body).then((r) => r.data);
export const deployProject = (body) => instance.post("/render/deploy", body, { timeout: 180000 }).then((r) => r.data);
export const getProjectDeployments = (projectId) => instance.get("/render/projects/" + encodeURIComponent(projectId) + "/deployments", { timeout: 90000 }).then((r) => r.data);
export const autoSyncProjects = (force = false) => instance.post("/render/projects/auto-sync", { force }, { timeout: 120000 }).then((r) => r.data);
export const syncAllProjectsWithRender = () => instance.post("/render/projects/sync-all", {}, { timeout: 120000 }).then((r) => r.data);
export const mergeProjects = (ids, keepId) => instance.post("/projects/merge", { ids, ...(keepId ? { keepId } : {}) }).then((r) => r.data);
export const pushProjectRenderEnv = (projectId, options = {}) => instance.post("/render/project-push/" + encodeURIComponent(projectId), options, { timeout: 90000 }).then((r) => r.data);

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
export const resolveRenderIncidents = (payload) => instance.post("/render/ops/incidents/resolve", payload).then((r) => r.data);
export const clearRenderIncidents = () => instance.post("/render/ops/incidents/clear").then((r) => r.data);
export const getRenderEvents = (accountId, serviceId, startTime) => instance.get("/render/accounts/" + encodeURIComponent(accountId) + "/services/" + encodeURIComponent(serviceId) + "/events", { params: startTime ? { startTime } : {} }).then((r) => r.data);
const domainsPath = (a, s) => "/render/accounts/" + encodeURIComponent(a) + "/services/" + encodeURIComponent(s) + "/custom-domains";
export const getCustomDomains = (a, s) => instance.get(domainsPath(a, s)).then((r) => r.data);
export const addCustomDomain = (a, s, name) => instance.post(domainsPath(a, s), { name }).then((r) => r.data);
export const verifyCustomDomain = (a, s, name) => instance.post(domainsPath(a, s) + "/" + encodeURIComponent(name) + "/verify").then((r) => r.data);
export const removeCustomDomain = (a, s, name) => instance.delete(domainsPath(a, s) + "/" + encodeURIComponent(name)).then((r) => r.data);
export const findUrlReferences = (fromUrl) => instance.post("/render/url-references", { fromUrl }, { timeout: 180000 }).then((r) => r.data);
export const replaceUrlReferences = (payload) => instance.post("/render/url-replace", payload, { timeout: 180000 }).then((r) => r.data);
export const forgotPassword = (email) => instance.post("/forgot-password", { email }, { timeout: 60000 }).then((r) => r.data);
export const resetPassword = (payload) => instance.post("/reset-password", payload, { timeout: 60000 }).then((r) => r.data);
export const getTelegram = () => instance.get("/telegram").then((r) => r.data);
export const connectTelegram = (token) => instance.post("/telegram/connect", { token }, { timeout: 60000 }).then((r) => r.data);
export const saveTelegram = (patch) => instance.put("/telegram/settings", patch).then((r) => r.data);
export const testTelegramBot = () => instance.post("/telegram/test", {}, { timeout: 60000 }).then((r) => r.data);
export const disconnectTelegram = () => instance.post("/telegram/disconnect").then((r) => r.data);
export const getRenderOpsStatus = () => instance.get("/render/ops/status").then((r) => r.data);
export const getPingResults = () => instance.get("/render/ops/pings").then((r) => r.data);
export const runPingsNow = () => instance.post("/render/ops/pings/run", {}, { timeout: 120000 }).then((r) => r.data);
export const scanHealthRoutes = () => instance.post("/render/ops/health-scan", {}, { timeout: 180000 }).then((r) => r.data);
export const addHealthRoute = (repoUrl, rootDir, merge = true) => instance.post("/github/health-route", { repoUrl, rootDir, merge }, { timeout: 120000 }).then((r) => r.data);
export const runRenderOpsNow = () => instance.post("/render/ops/run").then((r) => r.data);
export const testRenderOpsNotification = () => instance.post("/render/ops/notify/test").then((r) => r.data);
export const getRenderOpsReport = (format = "json") => instance.get("/render/ops/report", { params: { format }, responseType: format === "csv" ? "blob" : "json" }).then((r) => r.data);
export const diagnoseRenderLogs = (serviceName, logs, allowExternalProcessing = false) => instance.post("/render/ops/diagnose", { serviceName, logs, allowExternalProcessing }).then((r) => r.data);

/* Live-services usage dashboard (running Render services only; read-only provider checks). */
export const getLiveDashboard = ({ refresh } = {}) => instance.get("/render/live-dashboard", { params: refresh ? { refresh: 1 } : {}, timeout: 90000 }).then((r) => r.data);
export const getUsageAdminReport = () => instance.get("/render/usage-admin-report", { timeout: 90000 }).then((r) => r.data);
export const getUsageVariableSharing = () => instance.get("/render/usage-variable-sharing").then((r) => r.data);
export const setUsageVariableSharing = (enabled) => instance.put("/render/usage-variable-sharing", { enabled }, { timeout: 90000 }).then((r) => r.data);
export const getUsageVariableSharing = () => instance.get("/render/usage-variable-sharing").then((r) => r.data);
export const setUsageVariableSharing = (enabled) => instance.put("/render/usage-variable-sharing", { enabled }, { timeout: 90000 }).then((r) => r.data);
export const getUsageSettings = () => instance.get("/render/usage-settings").then((r) => r.data);
export const saveUsageSettings = (body) => instance.put("/render/usage-settings", body).then((r) => r.data);
