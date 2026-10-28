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
