/* Keeps login captures that are waiting for the user's decision, one per tab, for 10 minutes at most.
   The popup reads them and saves or drops them. Nothing is sent to the server from here. */
const PENDING_KEY = 'pendingSaves';
const NEVER_KEY = 'neverSaveHosts';
const TTL_MS = 10 * 60 * 1000;

async function handleSubmit(message, tabId) {
  if (!message.host || !message.password) return;
  const { [NEVER_KEY]: never = [] } = await chrome.storage.local.get(NEVER_KEY);
  if (never.includes(message.host)) return;
  const { [PENDING_KEY]: pending = {} } = await chrome.storage.session.get(PENDING_KEY);
  pending[tabId] = { host: message.host, username: message.username || '', password: message.password, at: Date.now() };
  await chrome.storage.session.set({ [PENDING_KEY]: pending });
  await chrome.action.setBadgeText({ tabId, text: '1' });
}

async function dropPending(tabId) {
  const { [PENDING_KEY]: pending = {} } = await chrome.storage.session.get(PENDING_KEY);
  delete pending[tabId];
  await chrome.storage.session.set({ [PENDING_KEY]: pending });
  await chrome.action.setBadgeText({ tabId, text: '' });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'credentials-submitted' || !sender.tab) return false;
  handleSubmit(message, sender.tab.id).then(() => sendResponse({ ok: true }));
  return true;
});

// A capture belongs to the page it came from: leaving that page drops it.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url) dropPending(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => dropPending(tabId));

/* ---- In-page dropdown support ----
   inpage.js asks for logins matching the page. Names and usernames go back freely; a password only goes back for one
   chosen item, after Touch ID when it is turned on, and only for items that belong to the page's own site. */
const API_SERVERS = [
  'https://password-manager-server-g305.onrender.com',
  'https://password-manager-server-xxdr.onrender.com'
];
const UNLOCK_TTL_MS = 5 * 60 * 1000;
const VAULT_TTL_MS = 60 * 1000;
let vaultCache = { at: 0, items: [] };

async function api(path, options = {}) {
  const { server } = await chrome.storage.local.get('server');
  const order = [server, ...API_SERVERS].filter((s, i, a) => s && a.indexOf(s) === i);
  let lastError = null;
  for (let i = 0; i < order.length; i += 1) {
    try {
      const response = await fetch(order[i] + path, options);
      if (response.status >= 502 && i < order.length - 1) continue;
      return response;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Could not reach the server.');
}

const hostOf = (value) => {
  const m = String(value || '').trim().toLowerCase().match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/\s]*@)?([^/:?#\s]+)/);
  const host = m ? m[1].replace(/^www\./, '') : '';
  return host.includes('.') ? host : '';
};
function registrable(host) {
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  const twoPartSuffix = parts[parts.length - 2].length <= 3 && parts[parts.length - 1].length === 2;
  return parts.slice(twoPartSuffix ? -3 : -2).join('.');
}
const titleOf = (pwd) => pwd.name || pwd.service || pwd.platform || 'Account';
const userOf = (pwd) => pwd.username || pwd.platEmail || '';

function matchesHost(pwd, pageHost) {
  const host = hostOf(pageHost);
  if (!host) return false;
  const site = registrable(host);
  const label = site.split('.')[0];
  const itemHost = hostOf(pwd.url);
  if (itemHost && registrable(itemHost) === site) return true;
  const name = titleOf(pwd).toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9.]/g, '');
  return name.length >= 3 && (name === label || name.includes(label) || name === host || (hostOf(name) && registrable(hostOf(name)) === site));
}

async function loadVault() {
  if (Date.now() - vaultCache.at < VAULT_TTL_MS) return vaultCache.items;
  const { token } = await chrome.storage.local.get('token');
  if (!token) return null;
  const response = await api('/password/all', { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 401) { await chrome.storage.local.remove(['token', 'server', 'email']); return null; }
  if (!response.ok) throw new Error('vault unavailable');
  const data = await response.json();
  vaultCache = { at: Date.now(), items: (data.passwords || []).filter((p) => p.password && !p.iv && !p.broken && !p.deletedAt && p.enc !== 'e2e') };
  return vaultCache.items;
}

let unlockWaiters = null;
async function ensureUnlocked() {
  const { touchIdCredential } = await chrome.storage.local.get('touchIdCredential');
  if (!touchIdCredential) return true;
  const { unlockedAt = 0 } = await chrome.storage.session.get('unlockedAt');
  if (Date.now() - unlockedAt < UNLOCK_TTL_MS) return true;
  if (!unlockWaiters) {
    unlockWaiters = [];
    const win = await chrome.windows.create({ url: chrome.runtime.getURL('unlock.html'), type: 'popup', width: 340, height: 230, focused: true });
    const finish = (ok) => {
      const waiters = unlockWaiters; unlockWaiters = null;
      chrome.windows.onRemoved.removeListener(onRemoved);
      chrome.runtime.onMessage.removeListener(onResult);
      waiters.forEach((resolve) => resolve(ok));
    };
    const onRemoved = (id) => { if (id === win.id) finish(false); };
    const onResult = (m) => { if (m?.type === 'unlock-result') finish(Boolean(m.ok)); };
    chrome.windows.onRemoved.addListener(onRemoved);
    chrome.runtime.onMessage.addListener(onResult);
  }
  return new Promise((resolve) => unlockWaiters.push(resolve));
}

async function handleInpage(message, sender) {
  const pageHost = (() => { try { return new URL(sender.tab.url).hostname; } catch (e) { return ''; } })();
  if (message.type === 'suggest') {
    let items;
    try { items = await loadVault(); } catch (e) { return { state: 'error' }; }
    if (!items) return { state: 'signed-out' };
    const matches = items.filter((p) => matchesHost(p, pageHost));
    return { state: 'ok', items: matches.map((p) => ({ id: p._id, title: titleOf(p), username: userOf(p) })) };
  }
  if (message.type === 'fill') {
    const items = await loadVault();
    const pwd = items && items.find((p) => p._id === message.id);
    if (!pwd || !matchesHost(pwd, pageHost)) return { ok: false };
    if (!(await ensureUnlocked())) return { ok: false, denied: true };
    return { ok: true, username: userOf(pwd), password: pwd.password };
  }
  if (message.type === 'save-now') {
    if (!message.password) return { ok: false };
    if (!(await ensureUnlocked())) return { ok: false, denied: true };
    const { token } = await chrome.storage.local.get('token');
    if (!token) return { ok: false };
    const response = await api('/addnewpassword', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: registrable(pageHost), platEmail: message.username || 'NA', userPass: message.password })
    });
    vaultCache = { at: 0, items: [] };
    return { ok: response.ok };
  }
  return { ok: false };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.tab || !['suggest', 'fill', 'save-now'].includes(message?.type)) return false;
  handleInpage(message, sender).then(sendResponse).catch(() => sendResponse({ ok: false, state: 'error' }));
  return true;
});
