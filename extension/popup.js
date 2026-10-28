const API_SERVERS = [
  'https://password-manager-server-xxdr.onrender.com',
  'https://password-manager-server-xxdr.onrender.com'
];

// DOM Elements
const loginSection = document.getElementById('loginSection');
const mainSection = document.getElementById('mainSection');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const codeInput = document.getElementById('code');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const loginError = document.getElementById('loginError');
const currentPasswordsDiv = document.getElementById('currentPasswords');
const allPasswordsDiv = document.getElementById('allPasswords');
const qrSection = document.getElementById('qrSection');
const qrContainer = document.getElementById('qrContainer');
const closeQrBtn = document.getElementById('closeQrBtn');
const loadingSpinner = document.getElementById('loadingSpinner');

let currentToken = null;
let preferredServer = null;
let allPasswords = [];

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Tries the server that issued the token first, then the others (Render free servers sleep).
async function api(path, options = {}) {
  const order = [preferredServer, ...API_SERVERS].filter((s, i, a) => s && a.indexOf(s) === i);
  let lastError = null;
  for (let i = 0; i < order.length; i += 1) {
    try {
      const response = await fetch(order[i] + path, options);
      if (response.status >= 502 && i < order.length - 1) continue;
      response.server = order[i];
      return response;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Could not reach the server.');
}

const authHeaders = () => ({ Authorization: `Bearer ${currentToken}` });

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  const stored = await chrome.storage.local.get(['token', 'server']);
  currentToken = stored.token || null;
  preferredServer = stored.server || null;

  if (currentToken) {
    showMain();
    await loadPasswords();
  } else {
    showLogin();
  }
});

// Login
loginBtn.addEventListener('click', async () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const code = codeInput.value.trim();

  if (!email || !password) {
    showError('Please enter email and password');
    return;
  }

  try {
    showLoading(true);
    const response = await api('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, client: 'mobile', code: code || undefined })
    });

    const data = await response.json().catch(() => ({}));

    if (data.twoFactorRequired) {
      codeInput.classList.remove('hidden');
      codeInput.focus();
      throw new Error(data.error || 'Enter the code from your authenticator app.');
    }
    if (!response.ok) {
      throw new Error(data.error || data.message || 'Login failed');
    }
    if (!data.token) {
      throw new Error('No token received');
    }

    currentToken = data.token;
    preferredServer = response.server;
    await chrome.storage.local.set({ token: data.token, server: response.server, email });
    passwordInput.value = '';
    codeInput.value = '';
    codeInput.classList.add('hidden');
    showMain();
    await loadPasswords();
  } catch (error) {
    showError(error.message);
  } finally {
    showLoading(false);
  }
});

// Logout
logoutBtn.addEventListener('click', async () => {
  try {
    await api('/logout', { headers: authHeaders() });
  } catch (error) {
    // still sign out locally
  }
  await chrome.storage.local.remove(['token', 'server', 'email']);
  currentToken = null;
  preferredServer = null;
  allPasswords = [];
  emailInput.value = '';
  passwordInput.value = '';
  showLogin();
});

// Load passwords
async function loadPasswords() {
  try {
    showLoading(true);
    const response = await api('/password/all', { headers: authHeaders() });

    if (!response.ok) {
      if (response.status === 401) {
        await chrome.storage.local.remove(['token', 'server', 'email']);
        currentToken = null;
        showLogin();
        return;
      }
      throw new Error('Failed to load passwords');
    }

    const data = await response.json();
    // Old server-encrypted entries only carry ciphertext; only show logins we can actually fill.
    allPasswords = (data.passwords || []).filter((p) => p.password && !p.iv && !p.broken && !p.deletedAt && p.enc !== 'e2e');

    displayPasswords();
  } catch (error) {
    console.error('Error loading passwords:', error);
    showError('Failed to load passwords');
  } finally {
    showLoading(false);
  }
}

const titleOf = (pwd) => pwd.name || pwd.service || pwd.platform || 'Account';
const userOf = (pwd) => pwd.username || pwd.platEmail || '';

// Display passwords
async function displayPasswords() {
  await showPendingSave();
  const currentDomain = await getCurrentDomain();

  // Show passwords for current domain
  const currentDomainPasswords = filterPasswordsByDomain(currentDomain);

  if (currentDomainPasswords.length > 0) {
    document.getElementById('currentDomainSection').style.display = 'block';
    currentPasswordsDiv.innerHTML = currentDomainPasswords
      .map(pwd => createPasswordElement(pwd))
      .join('');
  } else {
    document.getElementById('currentDomainSection').style.display = 'none';
  }

  // Show all passwords
  document.getElementById('allPasswordsSection').style.display = allPasswords.length > 0 ? 'block' : 'none';
  allPasswordsDiv.innerHTML = allPasswords
    .map(pwd => createPasswordElement(pwd))
    .join('');

  // Add event listeners
  document.querySelectorAll('.autofill-btn').forEach(btn => {
    btn.addEventListener('click', (e) => autofillPassword(e.currentTarget.dataset.id));
  });

  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', (e) => copyPassword(e.currentTarget.dataset.id));
  });

  document.querySelectorAll('.qr-btn').forEach(btn => {
    btn.addEventListener('click', (e) => showQRCode(e.currentTarget.dataset.id));
  });

  const googleAccounts = allPasswords.filter(isGoogleEntry);
  document.getElementById('googleSection').classList.toggle('hidden', googleAccounts.length === 0);
  document.getElementById('googleAccounts').innerHTML = googleAccounts
    .map(pwd => `
      <div class="password-item">
        <div class="password-info">
          <div class="password-service">${escapeHtml(titleOf(pwd))}</div>
          <div class="password-username">${escapeHtml(userOf(pwd) || 'Unknown')}</div>
        </div>
        <div class="password-actions">
          <button class="btn btn-small google-signin-btn" data-id="${escapeHtml(pwd._id)}">Sign in</button>
        </div>
      </div>`)
    .join('');
  document.querySelectorAll('.google-signin-btn').forEach(btn => {
    btn.addEventListener('click', (e) => googleSignIn(e.currentTarget.dataset.id));
  });
}

// Create password element (all text is escaped: item names come from the vault)
function createPasswordElement(pwd) {
  return `
    <div class="password-item">
      <div class="password-info">
        <div class="password-service">${escapeHtml(titleOf(pwd))}</div>
        <div class="password-username">${escapeHtml(userOf(pwd) || 'Unknown')}</div>
      </div>
      <div class="password-actions">
        <button class="icon-btn autofill-btn" data-id="${escapeHtml(pwd._id)}" title="Autofill">📝</button>
        <button class="icon-btn copy-btn" data-id="${escapeHtml(pwd._id)}" title="Copy Password">📋</button>
        <button class="icon-btn qr-btn" data-id="${escapeHtml(pwd._id)}" title="QR Code">📱</button>
      </div>
    </div>
  `;
}

// Get current domain
async function getCurrentDomain() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return new URL(tabs[0].url).hostname;
  } catch (error) {
    return '';
  }
}

const hostOf = (value) => {
  const m = String(value || '').trim().toLowerCase().match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/\s]*@)?([^/:?#\s]+)/);
  const host = m ? m[1].replace(/^www\./, '') : '';
  return host.includes('.') ? host : '';
};

// "accounts.google.com" -> "google.com", "news.bbc.co.uk" -> "bbc.co.uk"
function registrable(host) {
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  const twoPartSuffix = parts[parts.length - 2].length <= 3 && parts[parts.length - 1].length === 2;
  return parts.slice(twoPartSuffix ? -3 : -2).join('.');
}

// Filter passwords by domain: the item's website first, then its name
function filterPasswordsByDomain(domain) {
  const host = hostOf(domain);
  if (!host) return [];
  const site = registrable(host);
  const label = site.split('.')[0];
  return allPasswords.filter((pwd) => {
    const itemHost = hostOf(pwd.url);
    if (itemHost && registrable(itemHost) === site) return true;
    const name = titleOf(pwd).toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9.]/g, '');
    return name.length >= 3 && (name === label || name.includes(label) || name === host || hostOf(name) === host || (hostOf(name) && registrable(hostOf(name)) === site));
  });
}

// Runs inside the page (self-contained: it is serialised and injected).
function fillFormInPage(username, password) {
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const inputs = Array.from(document.querySelectorAll('input')).filter((el) => visible(el) && !el.disabled && !el.readOnly);
  const passwordField = inputs.find((el) => el.type === 'password') || null;
  const hint = (el) => `${el.name} ${el.id} ${el.placeholder} ${el.autocomplete}`.toLowerCase();
  const isTextual = (el) => ['text', 'email', 'tel', ''].includes(el.type);

  const before = passwordField ? inputs.slice(0, inputs.indexOf(passwordField)).filter(isTextual) : inputs.filter(isTextual);
  const usernameField =
    before.slice().reverse().find((el) => /user|email|login|account/.test(hint(el))) ||
    (passwordField ? before[before.length - 1] : before.find((el) => /user|email|login|account/.test(hint(el)))) ||
    null;

  const setValue = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    if (setter && setter.set) setter.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  let filled = false;
  if (usernameField && username) {
    setValue(usernameField, username);
    filled = true;
  }
  if (passwordField) {
    setValue(passwordField, password);
    filled = true;
  }
  return filled;
}

// Autofill password
async function autofillPassword(passwordId) {
  try {
    const pwd = allPasswords.find(p => p._id === passwordId);
    if (!pwd) return;

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: fillFormInPage,
      args: [userOf(pwd), pwd.password || '']
    });

    if (!result || !result.result) {
      showError('No login form found on this page.');
      return;
    }
    showSuccess('Password autofilled!');
    setTimeout(() => window.close(), 1500);
  } catch (error) {
    showError('Failed to autofill. Make sure you are on a login page.');
  }
}

// Copy password
// Login captured by background.js on the current tab, if it is recent and not already saved.
const SAVE_TTL_MS = 10 * 60 * 1000;
async function pendingSaveForTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return null;
  const { pendingSaves = {} } = await chrome.storage.session.get('pendingSaves');
  const pending = pendingSaves[tab.id];
  if (!pending || Date.now() - pending.at > SAVE_TTL_MS) return null;
  return { tabId: tab.id, ...pending };
}

function alreadySaved(pending) {
  const site = registrable(pending.host);
  const user = pending.username.toLowerCase();
  return allPasswords.some((p) => {
    const itemHost = hostOf(p.url);
    const itemSite = itemHost ? registrable(itemHost) : titleOf(p).toLowerCase();
    return itemSite === site && userOf(p).toLowerCase() === user;
  });
}

async function clearPendingSave(tabId) {
  const { pendingSaves = {} } = await chrome.storage.session.get('pendingSaves');
  delete pendingSaves[tabId];
  await chrome.storage.session.set({ pendingSaves });
  await chrome.action.setBadgeText({ tabId, text: '' });
}

async function showPendingSave() {
  const card = document.getElementById('savePrompt');
  const pending = await pendingSaveForTab();
  if (!pending || alreadySaved(pending)) {
    card.classList.add('hidden');
    return;
  }
  const who = pending.username ? ` (${pending.username})` : '';
  document.getElementById('savePromptText').textContent = `Save this login for ${registrable(pending.host)}${who}?`;
  card.classList.remove('hidden');
}

async function savePendingLogin() {
  const pending = await pendingSaveForTab();
  if (!pending) return;
  try {
    const response = await api('/addnewpassword', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: registrable(pending.host), platEmail: pending.username || 'NA', userPass: pending.password })
    });
    if (!response.ok) throw new Error('save failed');
    await clearPendingSave(pending.tabId);
    showSuccess('Login saved.');
    await loadPasswords();
    await showPendingSave();
  } catch (error) {
    showError('Could not save this login. Try again.');
  }
}

document.getElementById('saveYes').addEventListener('click', savePendingLogin);
document.getElementById('saveNo').addEventListener('click', async () => {
  const pending = await pendingSaveForTab();
  if (pending) await clearPendingSave(pending.tabId);
  document.getElementById('savePrompt').classList.add('hidden');
});
document.getElementById('saveNever').addEventListener('click', async () => {
  const pending = await pendingSaveForTab();
  if (!pending) return;
  const { neverSaveHosts = [] } = await chrome.storage.local.get('neverSaveHosts');
  await chrome.storage.local.set({ neverSaveHosts: [...new Set([...neverSaveHosts, pending.host])] });
  await clearPendingSave(pending.tabId);
  document.getElementById('savePrompt').classList.add('hidden');
});

// A saved entry is a Google account when its website (or, without one, its name) is google.com.
function isGoogleEntry(pwd) {
  const host = hostOf(pwd.url);
  if (host) return registrable(host) === 'google.com';
  return /\bgoogle\b/i.test(titleOf(pwd));
}

// Resolves when the tab has finished loading, or after a timeout.
function waitForTabComplete(tabId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const done = () => { chrome.tabs.onUpdated.removeListener(onUpdated); clearTimeout(timer); resolve(); };
    const onUpdated = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
    const timer = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

// Runs inside accounts.google.com, one step per call. Google navigates between its steps, which ends this script's
// context, so the popup injects it again on each new page. Self-contained: it cannot use popup variables.
// It picks the account in the chooser when this browser is already signed in with it, types the email, then the
// password. It never clicks a challenge (code, passkey, "verify it's you").
async function googleSignInInPage(email, password) {
  if (location.hostname !== 'accounts.google.com') return { status: 'wrong-site' };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (el) => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const setValue = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const clickNext = (id) => {
    const button = document.querySelector('#' + id + ' button') || document.getElementById(id);
    if (button) button.click();
  };
  const chooserRow = () => Array.from(document.querySelectorAll('[data-identifier]')).find((el) => el.getAttribute('data-identifier') === email);
  const emailField = () => document.querySelector('input#identifierId');
  const passwordField = () => document.querySelector('input[type="password"][name="Passwd"]') || document.querySelector('input[type="password"]');

  let target = null;
  const end = Date.now() + 15000;
  while (Date.now() < end && !target) {
    target = [chooserRow(), emailField(), passwordField()].find(visible) || null;
    if (!target) await sleep(300);
  }
  if (!target) {
    return { status: /verify|code|passkey/i.test(document.body.textContent || '') ? 'challenge' : 'not-found' };
  }
  if (target === chooserRow()) { target.click(); return { status: 'chooser-selected' }; }
  if (target === emailField()) { setValue(target, email); clickNext('identifierNext'); return { status: 'email-submitted' }; }
  setValue(target, password);
  clickNext('passwordNext');
  return { status: 'password-submitted' };
}

// Opens Google sign-in in a new tab and signs in with the chosen account, one page at a time.
async function googleSignIn(passwordId) {
  const pwd = allPasswords.find(p => p._id === passwordId);
  if (!pwd) return;
  try {
    const tab = await chrome.tabs.create({ url: 'https://accounts.google.com/', active: true });
    let status = 'failed';
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await waitForTabComplete(tab.id);
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: googleSignInInPage,
        args: [userOf(pwd), pwd.password || '']
      });
      status = injected && injected.result ? injected.result.status : 'failed';
      if (status !== 'email-submitted' && status !== 'chooser-selected') break;
      await new Promise((resolve) => setTimeout(resolve, 1500)); // let Google move to the next page
    }
    if (status === 'password-submitted') showSuccess('Signed in to Google. If Google asks for a code or approval, finish it on the page.');
    else if (status === 'challenge') showError('Google wants a code or approval. Finish it on the page.');
    else if (status === 'not-found') showError("Couldn't find Google's sign-in form.");
    else showError('Google sign-in did not finish.');
  } catch (error) {
    showError('Google sign-in failed. Try again.');
  }
}

async function copyPassword(passwordId) {
  try {
    const pwd = allPasswords.find(p => p._id === passwordId);
    if (!pwd) return;

    await navigator.clipboard.writeText(pwd.password || '');
    showSuccess('Password copied to clipboard!');
  } catch (error) {
    showError('Failed to copy password');
  }
}

// Show QR Code
function showQRCode(passwordId) {
  const pwd = allPasswords.find(p => p._id === passwordId);
  if (!pwd) return;

  qrContainer.innerHTML = '';

  // Generate QR code using QR Server (free API). Only the account name and username go into it, never the password.
  const qrData = JSON.stringify({
    id: pwd._id,
    service: titleOf(pwd),
    username: userOf(pwd)
  });

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrData)}`;

  qrContainer.innerHTML = `
    <img src="${escapeHtml(qrUrl)}" alt="QR Code">
    <p style="font-size: 12px; color: #666; margin-top: 8px;">
      ${escapeHtml(titleOf(pwd))}<br>
      ${escapeHtml(userOf(pwd))}
    </p>
  `;

  qrSection.style.display = 'block';
}

// Close QR
closeQrBtn.addEventListener('click', () => {
  qrSection.style.display = 'none';
  qrContainer.innerHTML = '';
});

// Show/Hide sections
function showLogin() {
  loginSection.classList.remove('hidden');
  mainSection.classList.add('hidden');
}

function showMain() {
  loginSection.classList.add('hidden');
  mainSection.classList.remove('hidden');
}

function showError(msg) {
  loginError.textContent = msg;
  loginError.classList.remove('hidden');
  setTimeout(() => loginError.classList.add('hidden'), 5000);
}

function showSuccess(msg) {
  const el = document.createElement('div');
  el.className = 'success';
  el.textContent = msg;
  document.body.insertBefore(el, document.body.firstChild);
  setTimeout(() => el.remove(), 3000);
}

function showLoading(show) {
  loadingSpinner.classList.toggle('hidden', !show);
}
