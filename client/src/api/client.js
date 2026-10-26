import axios from "axios";

// API servers, in order of preference. If one is down the client falls over
// to the next. Override with REACT_APP_API_URLS (comma separated) at build time.
// xxdr is the fixed address apps use to find the current server list (see "Server registry" below).
// The main server. Other servers come from the Stashr server list (the Servers page), never from here.
const DEFAULT_SERVERS = [
    "https://password-manager-server-xxdr.onrender.com"
];

const SERVERS = (import.meta.env.VITE_API_URLS || import.meta.env.REACT_APP_API_URLS || import.meta.env.REACT_APP_API_URL || "")
    .split(",")
    .map((u) => u.trim().replace(/\/+$/, ""))
    .filter(Boolean);
if (SERVERS.length === 0) SERVERS.push(...DEFAULT_SERVERS);

// The build-time server list is the primary configured endpoint. The Stashr registry adds
// fallback servers on startup; keeping the configured endpoint first ensures this deployment uses v2.
const BOOTSTRAP = [...SERVERS];
const REGISTRY_CACHE_KEY = "pm_registry_stashr";
const REGISTRY_APP = "stashr";

const mergeServers = (fresh) =>
{
    const list = [...BOOTSTRAP, ...fresh].filter((u, i, a) => u && a.indexOf(u) === i);
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
const REQUEST_TIMEOUT_MS = 8000;

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

// In-flight request count, so the page can show a loader while the server works (see Components/NetBar).
let inflight = 0;
const watchers = new Set();
export const onActivity = (fn) => { watchers.add(fn); fn(inflight); return () => watchers.delete(fn); };
const track = (d) => { inflight = Math.max(0, inflight + d); watchers.forEach((fn) => fn(inflight)); };
const baseAdapter = axios.getAdapter(instance.defaults.adapter);
instance.defaults.adapter = (config) =>
{
    track(1);
    return baseAdapter(config).finally(() => track(-1));
};

// Fallback for browsers that refuse the cross-site session cookie: the sign-in token is kept here and sent as a
// Bearer header instead. Only used after the cookie was seen to fail; cleared on sign-out or a rejected session.
const BEARER_KEY = "pm_bearer";
export const getBearer = () => { try { return localStorage.getItem(BEARER_KEY) || ""; } catch (e) { return ""; } };
export const setBearer = (token) => { try { if (token) localStorage.setItem(BEARER_KEY, token); else localStorage.removeItem(BEARER_KEY); } catch (e) { /* private mode */ } };

instance.interceptors.request.use((config) =>
{
    const bearer = getBearer();
    if (bearer && !/\/(login|register)$/.test(String(config.url || "").split("?")[0])) config.headers.Authorization = "Bearer " + bearer;
    config.headers["X-Client-Id"] = CLIENT_ID;
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
        if (/\/logout$/.test(String(response.config.url || "").split("?")[0])) { writeSessionServer(""); setBearer(""); }
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
            config.timeout = Math.max(config.timeout || 0, 25000);
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

/* ── Personal AI Photo Cloud ── */
export const getPhotoCloudDashboard = () => instance.get("/photo-cloud/dashboard", { timeout: 30000 }).then((r) => r.data);
export const setPhotoFavorite = (id, favorite) => instance.patch(`/photo-cloud/media/${encodeURIComponent(id)}`, { favorite }).then((r) => r.data);
export const removePhotoMedia = (id) => instance.delete(`/photo-cloud/media/${encodeURIComponent(id)}`).then((r) => r.data);
export const connectPhotoGoogleAccount = (data) => instance.post("/photo-cloud/connections", data).then((r) => r.data);
export const startPhotoGoogleOAuth = (label, returnTo) => instance.get("/photo-cloud/google/start", { params: { label, ...(returnTo ? { returnTo } : {}) } }).then((r) => r.data);
export const getBlob = (path) => instance.get(path, { responseType: "blob", timeout: 60000 }).then((r) => r.data);
export const getAdminUsers = (q = "") => instance.get("/admin/users", { params: { q, limit: 300 } }).then((r) => r.data);
export const setUserFeature = (id, key, enabled) => instance.put(`/admin/users/${encodeURIComponent(id)}/features`, { key, enabled }).then((r) => r.data);
export const listPhotoImports = () => instance.get("/photo-import/batches").then((r) => r.data);
export const createPhotoImport = (data) => instance.post("/photo-import/batches", data, { timeout: 60000 }).then((r) => r.data);
export const getPhotoImport = (id) => instance.get(`/photo-import/batches/${encodeURIComponent(id)}`, { timeout: 30000 }).then((r) => r.data);
export const photoImportAction = (id, action) => instance.post(`/photo-import/batches/${encodeURIComponent(id)}/${action}`, {}, { timeout: 60000 }).then((r) => r.data);
export const deletePhotoImport = (id) => instance.delete(`/photo-import/batches/${encodeURIComponent(id)}`).then((r) => r.data);
export const renamePhotoImport = (id, label) => instance.patch(`/photo-import/batches/${encodeURIComponent(id)}`, { label }).then((r) => r.data);
export const createFolderShare = (data) => instance.post("/photo-cloud/folder-shares", data).then((r) => r.data);
export const listFolderShares = () => instance.get("/photo-cloud/folder-shares").then((r) => r.data);
export const revokeFolderShare = (id) => instance.delete(`/photo-cloud/folder-shares/${encodeURIComponent(id)}`).then((r) => r.data);
export const getSharedWithMe = () => instance.get("/photo-cloud/shared-with-me").then((r) => r.data);
export const getSharedMedia = (id) => instance.get(`/photo-cloud/shared/${encodeURIComponent(id)}/media`, { timeout: 30000 }).then((r) => r.data);
export const importExistingPhotos = () => instance.post("/photo-cloud/import-existing", {}, { timeout: 180000 }).then((r) => r.data);
export const createPhotoFolder = (name, parentId) => instance.post("/photo-cloud/folders", { name, parentId }).then((r) => r.data);
export const deletePhotoFolder = (id) => instance.delete(`/photo-cloud/folders/${encodeURIComponent(id)}`).then((r) => r.data);
export const syncPhotoGoogleAccount = (id) => instance.post(`/photo-cloud/connections/${encodeURIComponent(id)}/sync`).then((r) => r.data);
export const updatePhotoConnection = (id, data) => instance.put(`/photo-cloud/connections/${encodeURIComponent(id)}`, data).then((r) => r.data);
export const disconnectPhotoConnection = (id) => instance.delete(`/photo-cloud/connections/${encodeURIComponent(id)}`).then((r) => r.data);
export const exportPhotoManifest = () => instance.get("/photo-cloud/export").then((r) => r.data);
export const savePhotoRoutingPolicy = (data) => instance.put("/photo-cloud/routing-policy", data).then((r) => r.data);
export const createPhotoBackupJob = (data) => instance.post("/photo-cloud/backup/jobs", data).then((r) => r.data);
export const createPhotoShare = (data) => instance.post("/photo-cloud/shares", data).then((r) => r.data);
export const getPhotoShares = () => instance.get("/photo-cloud/shares").then((r) => r.data);
export const revokePhotoShare = (id) => instance.delete(`/photo-cloud/shares/${encodeURIComponent(id)}`).then((r) => r.data);
export const getPublicPhotoShare = (token) => instance.get(`/public/photo-cloud/shares/${encodeURIComponent(token)}`, { withCredentials: false }).then((r) => r.data);

/* ── Auth ── */
// Several screens ask for the profile at once on load; share one in-flight request instead of loading the vault N times.
let profileInFlight = null;
export const checkAuthenticated = () => {
    if (!profileInFlight) profileInFlight = instance.get("/authenticate").finally(() => { profileInFlight = null; });
    return profileInFlight;
};
export const loginUser = (data) => instance.post("/login", data);
export const logoutUser = () => instance.get("/logout");
export const signupUser = (data) => instance.post("/register", data);

/* ── Vault (server-side encrypted) ── */
/* Delta sync + live events. `clientId` marks this tab's own writes so its event stream can ignore them. */
export const CLIENT_ID = Math.random().toString(36).slice(2, 10);
export const getVaultChanges = (since) => instance.get("/vault/changes", { params: since ? { since } : {}, timeout: 30000 }).then((r) => r.data);
/* EventSource cannot send the Authorization header the app fallback uses, so the stream is read with fetch. */
export const openVaultEvents = (signal) => {
    const headers = { Accept: "text/event-stream" };
    const bearer = getBearer();
    if (bearer) headers.Authorization = "Bearer " + bearer;
    return fetch(SERVERS[active] + "/vault/events", { headers, credentials: "include", signal, cache: "no-store" });
};

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
export const getRenderAccounts = () => instance.get("/render/accounts", { timeout: 30000 }).then((r) => r.data);
export const connectRenderAccount = (data) => instance.post("/render/accounts", data).then((r) => r.data);
export const deleteRenderAccount = (id) => instance.delete("/render/accounts/" + encodeURIComponent(id)).then((r) => r.data);
export const getRenderServices = (accountId) => instance.get("/render/accounts/" + encodeURIComponent(accountId) + "/services", { timeout: 20000 }).then((r) => r.data);
export const renameRenderService = (accountId, serviceId, name) => instance.patch(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/name`, { name }).then((r) => r.data);
export const getRenderLogs = (accountId, params) => instance.get("/render/accounts/" + encodeURIComponent(accountId) + "/logs?" + new URLSearchParams(params).toString()).then((r) => r.data);
export const getServiceBranches = (accountId, serviceId) => instance.get("/render/accounts/" + encodeURIComponent(accountId) + "/services/" + encodeURIComponent(serviceId) + "/branches", { timeout: 30000 }).then((r) => r.data);
export const setServiceBranch = (accountId, serviceId, branch, deploy = true) => instance.post("/render/accounts/" + encodeURIComponent(accountId) + "/services/" + encodeURIComponent(serviceId) + "/branch", { branch, deploy }, { timeout: 60000 }).then((r) => r.data);
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


// Aim for ~120 points whatever the range: a fixed 60s step makes 24h/7d pull 1,440+ points from Render, which is what made charts slow.
const metricResolution = (startTime) => Math.max(60, Math.min(3600, Math.ceil((Date.now() - Date.parse(startTime)) / 1000 / 120 / 30) * 30 || 60));
export const getRenderMetrics = (accountId, serviceId, metric, startTime) => instance.get(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/metrics`, { params: { metric, startTime, resolutionSeconds: metricResolution(startTime) } }).then((r) => r.data);

export const getRenderDbExports = (accountId, postgresId) => instance.get(`/render/accounts/${encodeURIComponent(accountId)}/postgres/${encodeURIComponent(postgresId)}/exports`).then((r) => r.data);
export const createRenderDbExport = (accountId, postgresId) => instance.post(`/render/accounts/${encodeURIComponent(accountId)}/postgres/${encodeURIComponent(postgresId)}/exports`).then((r) => r.data);

export const syncProjectRenderEnv = (projectId, options = {}) => instance.post("/render/project-sync/" + encodeURIComponent(projectId), options, { timeout: 60000 }).then((r) => r.data);

/* One-click create & deploy (GitHub repo + free Render service + env vars) and Stashr -> Render env push. */
export const getRenderOwners = (accountId) => instance.get("/render/accounts/" + encodeURIComponent(accountId) + "/owners").then((r) => r.data);
export const provisionProject = (body) => instance.post("/render/provision", body, { timeout: 180000 }).then((r) => r.data);
export const createRepo = (body) => instance.post("/render/repo/create", body, { timeout: 120000 }).then((r) => r.data);
export const checkRepoCode = (body) => instance.post("/render/repo/check", body).then((r) => r.data);
export const deployProject = (body) => instance.post("/render/deploy", body, { timeout: 180000 }).then((r) => r.data);
export const getProjectDeployments = (projectId) => instance.get("/render/projects/" + encodeURIComponent(projectId) + "/deployments", { timeout: 30000 }).then((r) => r.data);
export const autoSyncProjects = (force = false) => instance.post("/render/projects/auto-sync", { force }, { timeout: 120000 }).then((r) => r.data);
export const syncAllProjectsWithRender = () => instance.post("/render/projects/sync-all", {}, { timeout: 120000 }).then((r) => r.data);
export const mergeProjects = (ids, keepId) => instance.post("/projects/merge", { ids, ...(keepId ? { keepId } : {}) }).then((r) => r.data);
export const pushProjectRenderEnv = (projectId, options = {}) => instance.post("/render/project-push/" + encodeURIComponent(projectId), options, { timeout: 90000 }).then((r) => r.data);

/* Automatic upkeep: live project health/drift (auto-links to Render first) and Servers-tab sync. */
export const getProjectStatuses = ({ id, refresh } = {}) => instance.get("/render/projects/status", { params: { ...(id ? { id } : {}), ...(refresh ? { refresh: 1 } : {}) }, timeout: 30000 }).then((r) => r.data);
export const getRegistrySync = ({ refresh } = {}) => instance.get("/render/registry-sync", { params: refresh ? { refresh: 1 } : {}, timeout: 30000 }).then((r) => r.data);
export const syncRegistryEnv = (app, options = {}) => instance.post("/render/registry-env-sync/" + encodeURIComponent(app), options, { timeout: 90000 }).then((r) => r.data);
export const setRegistryAutoSync = (app, autoSync) => instance.put("/render/registry-sync/" + encodeURIComponent(app), { autoSync }).then((r) => r.data);

/* GitHub connections for the Projects page (tokens stay encrypted server-side). */
export const getGithubAccounts = () => instance.get("/github/accounts").then((r) => r.data);
export const connectGithubAccount = (data) => instance.post("/github/accounts", data).then((r) => r.data);
export const deleteGithubAccount = (id) => instance.delete("/github/accounts/" + encodeURIComponent(id)).then((r) => r.data);
export const getGithubRepo = (url, refresh = false) => instance.get("/github/repo", { params: { url, ...(refresh ? { refresh: 1 } : {}) } }).then((r) => r.data);
export const getGithubRepos = (accountId, refresh = false) => instance.get("/github/accounts/" + encodeURIComponent(accountId) + "/repos", { params: refresh ? { refresh: 1 } : {}, timeout: 30000 }).then((r) => r.data);
export const getGithubBranches = (githubAccountId, url) => instance.get("/github/repo/branches", { params: { githubAccountId, url }, timeout: 30000 }).then((r) => r.data);
export const deleteGithubBranches = (body) => instance.post("/github/repo/branches/delete", body, { timeout: 120000 }).then((r) => r.data);
const deployOpsPath = (projectId) => "/deploy-ops/projects/" + encodeURIComponent(projectId);
/* Every hosting provider (Render, Vercel, Netlify, Railway, Cloudflare Pages) behind one set of calls. `ref` names one server. */
export const getDeployTargets = (projectId) => instance.get(deployOpsPath(projectId) + "/targets", { timeout: 90000 }).then((r) => r.data);
export const getDeployEnv = (projectId, ref) => instance.get(deployOpsPath(projectId) + "/env", { params: { ref }, timeout: 60000 }).then((r) => r.data);
export const setDeployEnv = (projectId, ref, key, value) => instance.put(deployOpsPath(projectId) + "/env", { ref, key, value }).then((r) => r.data);
export const redeployDeployTarget = (projectId, ref, branch = "") => instance.post(deployOpsPath(projectId) + "/redeploy", { ref, branch }, { timeout: 120000 }).then((r) => r.data);
export const getDeployHistory = (projectId, ref) => instance.get(deployOpsPath(projectId) + "/deploys", { params: { ref }, timeout: 60000 }).then((r) => r.data);
export const getDeployLogs = (projectId, ref, deployId = "") => instance.get(deployOpsPath(projectId) + "/logs", { params: { ref, deployId }, timeout: 60000 }).then((r) => r.data);
export const setDeployBranch = (projectId, ref, branch, deploy = true) => instance.put(deployOpsPath(projectId) + "/branch", { ref, branch, deploy }, { timeout: 120000 }).then((r) => r.data);
export const moveDeployAccount = (projectId, ref, accountId) => instance.put(deployOpsPath(projectId) + "/account", { ref, accountId }).then((r) => r.data);
export const syncDeployEnv = (projectId, body) => instance.post(deployOpsPath(projectId) + "/sync", body, { timeout: 180000 }).then((r) => r.data);
const movePath = (projectId) => "/move-server/" + encodeURIComponent(projectId);
/* Move one Render server to another account, one step per call (plan, create, status, frontends, relink, delete-old). */
export const movePlan = (projectId, body) => instance.post(movePath(projectId) + "/plan", body, { timeout: 90000 }).then((r) => r.data);
export const moveCreate = (projectId, body) => instance.post(movePath(projectId) + "/create", body, { timeout: 90000 }).then((r) => r.data);
export const moveCopyGroups = (projectId, body) => instance.post(movePath(projectId) + "/config/copy-groups", body, { timeout: 180000 }).then((r) => r.data);
export const moveStatus = (projectId, params) => instance.get(movePath(projectId) + "/status", { params, timeout: 60000 }).then((r) => r.data);
export const moveOrigin = (projectId, serviceId) => instance.get(movePath(projectId) + "/origin", { params: { serviceId } }).then((r) => r.data);
export const movePrepareDomains = (projectId, body) => instance.post(movePath(projectId) + "/domains/prepare", body, { timeout: 120000 }).then((r) => r.data);
export const moveVerifyDomains = (projectId, body) => instance.post(movePath(projectId) + "/domains/verify", body, { timeout: 120000 }).then((r) => r.data);
export const moveFrontends = (projectId, body) => instance.post(movePath(projectId) + "/frontends", body, { timeout: 180000 }).then((r) => r.data);
export const moveRelink = (projectId, body) => instance.post(movePath(projectId) + "/relink", body).then((r) => r.data);
export const moveDeleteOld = (projectId, body) => instance.post(movePath(projectId) + "/delete-old", body, { timeout: 60000 }).then((r) => r.data);

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
export const getLiveDashboard = ({ refresh, rescan } = {}) => instance.get("/render/live-dashboard", { params: { ...(refresh || rescan ? { refresh: 1 } : {}), ...(rescan ? { rescan: 1 } : {}) }, timeout: rescan ? 90000 : 45000 }).then((r) => r.data);
export const getUsageNeeds = () => instance.get("/render/usage-needs").then((r) => r.data);
export const getUsageSettings = () => instance.get("/render/usage-settings").then((r) => r.data);
export const saveUsageSettings = (body) => instance.put("/render/usage-settings", body).then((r) => r.data);

/* Other hosting providers (Vercel, Netlify, Railway, Cloudflare Pages): connections and "deploy this repo + branch". */
export const getHostAccounts = () => instance.get("/hosts/accounts").then((r) => r.data);
export const connectHostAccount = (body) => instance.post("/hosts/accounts", body, { timeout: 45000 }).then((r) => r.data);
export const deleteHostAccount = (id) => instance.delete("/hosts/accounts/" + encodeURIComponent(id)).then((r) => r.data);
export const deployToHost = (body) => instance.post("/hosts/deploy", body, { timeout: 180000 }).then((r) => r.data);
export const getHostSites = (accountId) => instance.get("/hosts/accounts/" + encodeURIComponent(accountId) + "/sites", { timeout: 45000 }).then((r) => r.data);
export const getProjectHostLinks = (projectId) => instance.get("/hosts/projects/" + encodeURIComponent(projectId) + "/links", { timeout: 60000 }).then((r) => r.data);
export const linkHostSite = (projectId, body) => instance.post("/hosts/projects/" + encodeURIComponent(projectId) + "/links", body, { timeout: 45000 }).then((r) => r.data);
export const unlinkHostSite = (projectId, linkId) => instance.delete("/hosts/projects/" + encodeURIComponent(projectId) + "/links/" + encodeURIComponent(linkId)).then((r) => r.data);
export const getHostLinkBranches = (projectId, linkId) => instance.get("/hosts/projects/" + encodeURIComponent(projectId) + "/links/" + encodeURIComponent(linkId) + "/branches", { timeout: 30000 }).then((r) => r.data);
export const redeployHostLink = (projectId, linkId, branch) => instance.post("/hosts/projects/" + encodeURIComponent(projectId) + "/links/" + encodeURIComponent(linkId) + "/redeploy", { branch }, { timeout: 60000 }).then((r) => r.data);
