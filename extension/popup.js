const API_BASE = 'http://localhost:5000/api'; // Change to your actual domain

// DOM Elements
const loginSection = document.getElementById('loginSection');
const mainSection = document.getElementById('mainSection');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
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
let allPasswords = [];

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  currentToken = await chrome.storage.local.get('token');
  currentToken = currentToken.token;

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
  const password = passwordInput.value.trim();

  if (!email || !password) {
    showError('Please enter email and password');
    return;
  }

  try {
    showLoading(true);
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Login failed');
    }

    if (!data.token) {
      throw new Error('No token received');
    }

    await chrome.storage.local.set({ token: data.token, email });
    currentToken = data.token;
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
  await chrome.storage.local.remove(['token', 'email']);
  currentToken = null;
  allPasswords = [];
  emailInput.value = '';
  passwordInput.value = '';
  showLogin();
});

// Load passwords
async function loadPasswords() {
  try {
    showLoading(true);
    const response = await fetch(`${API_BASE}/password/all`, {
      headers: { 'Authorization': `Bearer ${currentToken}` },
      credentials: 'include'
    });

    if (!response.ok) {
      if (response.status === 401) {
        await chrome.storage.local.remove(['token', 'email']);
        showLogin();
        return;
      }
      throw new Error('Failed to load passwords');
    }

    const data = await response.json();
    allPasswords = data.passwords || [];

    displayPasswords();
  } catch (error) {
    console.error('Error loading passwords:', error);
    showError('Failed to load passwords');
  } finally {
    showLoading(false);
  }
}

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
    btn.addEventListener('click', (e) => {
      const passwordId = e.target.dataset.id;
      autofillPassword(passwordId);
    });
  });

  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const passwordId = e.target.dataset.id;
      copyPassword(passwordId);
    });
  });

  document.querySelectorAll('.qr-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const passwordId = e.target.dataset.id;
      showQRCode(passwordId);
    });
  });
}

// Create password element
function createPasswordElement(pwd) {
  return `
    <div class="password-item">
      <div class="password-info">
        <div class="password-service">${pwd.service || pwd.platform || 'Account'}</div>
        <div class="password-username">${pwd.username || pwd.platEmail || 'Unknown'}</div>
      </div>
      <div class="password-actions">
        <button class="icon-btn autofill-btn" data-id="${pwd._id}" title="Autofill">📝</button>
        <button class="icon-btn copy-btn" data-id="${pwd._id}" title="Copy Password">📋</button>
        <button class="icon-btn qr-btn" data-id="${pwd._id}" title="QR Code">📱</button>
      </div>
    </div>
  `;
}

// Get current domain
async function getCurrentDomain() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = new URL(tabs[0].url);
  return url.hostname;
}

// Filter passwords by domain
function filterPasswordsByDomain(domain) {
  return allPasswords.filter(pwd => {
    const service = (pwd.service || pwd.platform || '').toLowerCase();
    return service.includes(domain.replace('www.', '')) ||
           domain.includes(service);
  });
}

// Autofill password
async function autofillPassword(passwordId) {
  try {
    const pwd = allPasswords.find(p => p._id === passwordId);
    if (!pwd) return;

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tabs[0].id, {
      action: 'autofill',
      username: pwd.username || pwd.platEmail || '',
      password: pwd.password || ''
    });

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

  // Generate QR code using QR Server (free API)
  const qrData = JSON.stringify({
    id: pwd._id,
    service: pwd.service || pwd.platform,
    username: pwd.username || pwd.platEmail
  });

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrData)}`;

  qrContainer.innerHTML = `
    <img src="${qrUrl}" alt="QR Code">
    <p style="font-size: 12px; color: #666; margin-top: 8px;">
      ${pwd.service || pwd.platform}<br>
      ${pwd.username || pwd.platEmail}
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
