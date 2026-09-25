import Constants from "expo-constants";

/**
 * Talks to the same Express API as the website.
 * - Bearer token auth (the server also accepts its cookie; RN keeps both).
 * - Fails over between the configured servers when one is down / asleep.
 */
// Override at build time with EXPO_PUBLIC_API_URLS="https://a.com,https://b.com"
const fromEnv = (process.env.EXPO_PUBLIC_API_URLS || "").split(",").map((u) => u.trim()).filter(Boolean);
const SERVERS = (fromEnv.length
  ? fromEnv
  : Constants.expoConfig?.extra?.apiServers || [
      "https://password-manager-server-xxdr.onrender.com",
      "https://password-manager-server-8gvj.onrender.com",
    ]
).map((u) => u.replace(/\/+$/, ""));

const TIMEOUT_MS = 25000;

let active = 0;
let token = null;

export const setToken = (t) => {
  token = t || null;
};
export const activeServer = () => SERVERS[active];
export const setActiveServer = (url) => {
  const i = SERVERS.indexOf(url);
  if (i >= 0) active = i;
};

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
  login: (email, password) => request("/login", { method: "POST", body: { email, password, client: "mobile" }, auth: false }),
  register: (data) => request("/register", { method: "POST", body: data, auth: false }),
  me: () => request("/authenticate"),
  logout: () => request("/logout"),
  add: (entry) => request("/addnewpassword", { method: "POST", body: entry }),
  update: (entry) => request("/updatepassword", { method: "POST", body: entry }),
  remove: (id) => request("/deletepassword", { method: "POST", body: { id } }),
  decrypt: (entry) =>
    request("/decrypt", { method: "POST", body: { id: entry._id, iv: entry.iv, encryptedPassword: entry.password } }),
  insights: () => request("/insights"),
};
