import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

/**
 * Talks to the same Express API as the website.
 * - Bearer token auth (the server also accepts its cookie; RN keeps both).
 * - Fails over between the configured servers when one is down / asleep.
 */
// Override at build time with EXPO_PUBLIC_API_URLS="https://a.com,https://b.com"
const fromEnv = (process.env.EXPO_PUBLIC_API_URLS || "").split(",").map((u) => u.trim()).filter(Boolean);
let active = 0;
const SERVERS = (fromEnv.length
  ? fromEnv
  : Constants.expoConfig?.extra?.apiServers || [
      "https://password-manager-server-xxdr.onrender.com",
      "https://password-manager-server-8gvj.onrender.com",
    ]
).map((u) => u.replace(/\/+$/, ""));

const TIMEOUT_MS = 25000;

// The server list is kept in the Stashr registry (edited on the web "Servers" page), so a changed URL
// never needs a rebuild. The list above is only the bootstrap: the app asks the registry on start,
// caches the answer on the device, and keeps the bootstrap at the end as a last resort.
const BOOTSTRAP = [...SERVERS];
const REGISTRY_KEY = "stashr.registry.stashr";

const cleanList = (urls) =>
  (Array.isArray(urls) ? urls : [])
    .map((u) => (typeof u === "string" ? u.trim().replace(/\/+$/, "") : ""))
    .filter((u) => /^https?:\/\//i.test(u));

function applyServers(fresh) {
  const list = [...fresh, ...BOOTSTRAP].filter((u, i, a) => u && a.indexOf(u) === i);
  const current = SERVERS[active];
  SERVERS.splice(0, SERVERS.length, ...list);
  const i = SERVERS.indexOf(current);
  active = i >= 0 ? i : 0;
}

let token = null;

export const setToken = (t) => {
  token = t || null;
};
export const activeServer = () => SERVERS[active];
export const setActiveServer = (url) => {
  const i = SERVERS.indexOf(url);
  if (i >= 0) active = i;
};

/** Pull the current server list from the registry (background; the app never waits on it). */
export async function refreshServers() {
  try {
    const cached = cleanList(JSON.parse((await SecureStore.getItemAsync(REGISTRY_KEY)) || "[]"));
    if (cached.length) applyServers(cached);
  } catch (e) {
    /* no cache yet */
  }
  for (const base of [...SERVERS]) {
    const res = await once(base, "/registry/stashr", { auth: false, timeout: 60000 });
    const urls = res.status === 200 ? cleanList(res.data && res.data.urls) : [];
    if (urls.length) {
      applyServers(urls);
      SecureStore.setItemAsync(REGISTRY_KEY, JSON.stringify(urls)).catch(() => {});
      return urls;
    }
  }
  return null;
}

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

const isDown = (status) => status === 0 || status === 502 || status === 503 || status === 504;

async function once(base, path, { method = "GET", body, auth = true, timeout = TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const headers = { Accept: "application/json", "X-Client": "mobile" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "include",
      signal: controller.signal,
    });

    const text = await res.text();
    let data = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      /* plain text answer (e.g. /decrypt) */
    }
    return { status: res.status, data };
  } catch (e) {
    return { status: 0, data: null, error: e };
  } finally {
    clearTimeout(timer);
  }
}

export async function request(path, options = {}) {
  let last = null;
  for (let tries = 0; tries < SERVERS.length; tries += 1) {
    const index = (active + tries) % SERVERS.length;
    const res = await once(SERVERS[index], path, options);
    last = res;
    if (!isDown(res.status)) {
      active = index;
      if (res.status >= 200 && res.status < 300) return res.data;
      const message =
        (res.data && typeof res.data === "object" && res.data.error) ||
        (typeof res.data === "string" && res.data) ||
        `Request failed (${res.status})`;
      throw new ApiError(message, res.status, res.data);
    }
    // Token/session lives on one server; only fail over for unauthenticated calls
    // or when every server shares the same database (they do in our Render setup).
  }
  throw new ApiError(
    "Can't reach the vault right now. The free server may be waking up — try again in a moment.",
    last?.status || 0
  );
}

export const api = {
  health: () => request("/health", { auth: false, timeout: 15000 }),
  login: (body) => request("/login", { method: "POST", body: { ...body, client: "mobile" }, auth: false }),
  register: (data) => request("/register", { method: "POST", body: data, auth: false }),
  me: () => request("/authenticate"),
  logout: () => request("/logout"),

  // Photos (Google Drive storage)
  photoDashboard: () => request("/photo-cloud/dashboard"),
  photoGoogleStart: (label) => request(`/photo-cloud/google/start?client=mobile&label=${encodeURIComponent(label || "Google account")}`),
  photoSync: (id) => request(`/photo-cloud/connections/${encodeURIComponent(id)}/sync`, { method: "POST", body: {}, timeout: 90000 }),
  photoUpdateAccount: (id, data) => request(`/photo-cloud/connections/${encodeURIComponent(id)}`, { method: "PUT", body: data }),
  photoDisconnect: (id) => request(`/photo-cloud/connections/${encodeURIComponent(id)}`, { method: "DELETE" }),
  photoPolicy: (data) => request("/photo-cloud/routing-policy", { method: "PUT", body: data }),
  photoExport: () => request("/photo-cloud/export", { timeout: 60000 }),
  photoUploadStart: (data) => request("/photo-cloud/upload/start", { method: "POST", body: data, timeout: 60000 }),
  photoUploadComplete: (jobId, fileId) => request(`/photo-cloud/upload/${encodeURIComponent(jobId)}/complete`, { method: "POST", body: { fileId }, timeout: 60000 }),
  photoUploadFail: (jobId, data) => request(`/photo-cloud/upload/${encodeURIComponent(jobId)}/fail`, { method: "POST", body: data }),
  photoUploadCancel: (jobId) => request(`/photo-cloud/upload/${encodeURIComponent(jobId)}/cancel`, { method: "POST", body: {} }),
  photoMediaUpdate: (id, data) => request("/photo-cloud/media/item", { method: "PUT", body: { id, ...data } }),
  photoMediaRemove: (id, scope) => request(`/photo-cloud/media/item?id=${encodeURIComponent(id)}&scope=${scope}`, { method: "DELETE" }),
  photoShares: () => request("/photo-cloud/shares"),
  photoShare: (data) => request("/photo-cloud/shares", { method: "POST", body: data }),
  photoRevokeShare: (id) => request(`/photo-cloud/shares/${encodeURIComponent(id)}`, { method: "DELETE" }),
  albumCreate: (name) => request("/photo-cloud/albums", { method: "POST", body: { name } }),
  albumRename: (id, name) => request(`/photo-cloud/albums/${encodeURIComponent(id)}`, { method: "PUT", body: { name } }),
  albumDelete: (id) => request(`/photo-cloud/albums/${encodeURIComponent(id)}`, { method: "DELETE" }),
  albumAdd: (id, mediaIds) => request(`/photo-cloud/albums/${encodeURIComponent(id)}/items`, { method: "POST", body: { mediaIds } }),
  albumRemove: (id, mediaIds) => request(`/photo-cloud/albums/${encodeURIComponent(id)}/items`, { method: "DELETE", body: { mediaIds } }),

  photoImportExisting: () => request("/photo-cloud/import-existing", { method: "POST", body: {}, timeout: 180000 }),
  photoWorkers: () => request("/photo-cloud/workers", { timeout: 30000 }),
  folderCreate: (name, parentId) => request("/photo-cloud/folders", { method: "POST", body: { name, parentId } }),
  folderRename: (id, name) => request(`/photo-cloud/folders/${encodeURIComponent(id)}`, { method: "PUT", body: { name } }),
  folderDelete: (id) => request(`/photo-cloud/folders/${encodeURIComponent(id)}`, { method: "DELETE" }),

  folderShare: (folderId, email, allowDownload) => request("/photo-cloud/folder-shares", { method: "POST", body: { folderId, email, allowDownload } }),
  folderShares: () => request("/photo-cloud/folder-shares"),
  folderUnshare: (id) => request(`/photo-cloud/folder-shares/${encodeURIComponent(id)}`, { method: "DELETE" }),
  sharedWithMe: () => request("/photo-cloud/shared-with-me"),
  sharedMedia: (id) => request(`/photo-cloud/shared/${encodeURIComponent(id)}/media`, { timeout: 40000 }),

  // Render servers, deploys and environment
  renderAccounts: () => request("/render/accounts"),
  renderServices: (accountId) => request(`/render/accounts/${encodeURIComponent(accountId)}/services`, { timeout: 40000 }),
  renderDeploys: (accountId, serviceId) => request(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/deploys`),
  renderDeploy: (accountId, serviceId) => request(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/deploys`, { method: "POST", body: { clearCache: false }, timeout: 40000 }),
  renderRestart: (accountId, serviceId) => request(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/restart`, { method: "POST", body: {}, timeout: 40000 }),
  renderSuspend: (accountId, serviceId) => request(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/suspend`, { method: "POST", body: {}, timeout: 40000 }),
  renderResume: (accountId, serviceId) => request(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/resume`, { method: "POST", body: {}, timeout: 40000 }),
  renderEnvVars: (accountId, serviceId) => request(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/env-vars`, { timeout: 40000 }),
  renderHealth: (accountId, serviceId) => request(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/health`, { timeout: 40000 }),
  projectStatus: () => request("/render/projects/status", { timeout: 60000 }),

  // Monitoring
  opsStatus: () => request("/render/ops/status"),
  opsIncidents: () => request("/render/ops/incidents?limit=50"),
  opsResolve: (payload) => request("/render/ops/incidents/resolve", { method: "POST", body: payload }),
  pings: () => request("/render/ops/pings"),
  runPings: () => request("/render/ops/pings/run", { method: "POST", body: {}, timeout: 120000 }),

  // GitHub
  githubAccounts: () => request("/github/accounts", { timeout: 40000 }),
  githubConnect: (token, name) => request("/github/accounts", { method: "POST", body: { token, name }, timeout: 40000 }),
  githubDisconnect: (id) => request(`/github/accounts/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // Server URLs (admin) and environment sync across an app's servers
  registrySync: (refresh) => request(`/render/registry-sync${refresh ? "?refresh=1" : ""}`, { timeout: 60000 }),
  registryEnvSync: (app, body) => request(`/render/registry-env-sync/${encodeURIComponent(app)}`, { method: "POST", body, timeout: 90000 }),

  // Vault (server-side encrypted)
  createItem: (data) => request("/vault/items", { method: "POST", body: { data } }),
  createItems: (items) => request("/vault/items/bulk", { method: "POST", body: { items }, timeout: 60000 }),
  updateItem: (id, data) => request(`/vault/items/${id}`, { method: "PUT", body: { data } }),
  deleteItem: (id) => request(`/vault/items/${id}`, { method: "DELETE" }),

  // Project tracker (server-side encrypted, same scheme as the vault)
  createProject: (data) => request("/projects/items", { method: "POST", body: { data } }),
  createProjects: (items) => request("/projects/items/bulk", { method: "POST", body: { items }, timeout: 60000 }),
  updateProject: (id, data) => request(`/projects/items/${id}`, { method: "PUT", body: { data } }),
  deleteProject: (id) => request(`/projects/items/${id}`, { method: "DELETE" }),

  // Account
  updateProfile: (name) => request("/account/profile", { method: "POST", body: { name } }),
  changePassword: (data) => request("/account/password", { method: "POST", body: { ...data, client: "mobile" }, timeout: 60000 }),
  logoutAll: () => request("/account/logout-all", { method: "POST" }),
  deleteAccount: (data) => request("/account/delete", { method: "POST", body: data }),
  twoFactorSetup: (password) => request("/2fa/setup", { method: "POST", body: { password } }),
  twoFactorEnable: (code) => request("/2fa/enable", { method: "POST", body: { code } }),
  twoFactorDisable: (data) => request("/2fa/disable", { method: "POST", body: data }),
  twoFactorRecoveryCodes: (data) => request("/2fa/recovery-codes", { method: "POST", body: data }),
};

/** URL + headers for an authenticated image/video request (thumbnails and originals come through the API). */
export const mediaSource = (id, size = "thumb", extra = "") => ({
  uri: `${activeServer()}/photo-cloud/media/content?id=${encodeURIComponent(id)}&size=${size}${extra}`,
  headers: token ? { Authorization: `Bearer ${token}`, "X-Client": "mobile" } : {},
});

/** For background work that runs before the app has unlocked: read the saved session token. */
export async function loadSavedToken() {
  if (token) return true;
  try {
    const saved = await SecureStore.getItemAsync("aurelia_token");
    if (saved && saved !== "cookie") { token = saved; return true; }
  } catch (e) { /* no saved session */ }
  return false;
}

/** Preview of a photo in a folder someone shared with you. */
export const sharedSource = (shareId, id, size = "large") => ({
  uri: `${activeServer()}/photo-cloud/shared/${encodeURIComponent(shareId)}/content?id=${encodeURIComponent(id)}&size=${size}`,
  headers: token ? { Authorization: `Bearer ${token}`, "X-Client": "mobile" } : {},
});
