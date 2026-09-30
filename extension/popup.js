const API_SERVERS = [
  'https://password-manager-server-8gvj.onrender.com',
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
    allPasswords = (data.passwords || []).filter((p) => p.password && !p.iv && !p.broken && p.enc !== 'e2e');

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
