// Background service worker for Chrome extension

chrome.runtime.onInstalled.addListener(() => {
  console.log('Password Manager Extension installed!');
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getToken') {
    chrome.storage.local.get('token', (result) => {
      sendResponse({ token: result.token });
    });
    return true; // Will respond asynchronously
  }
});

// Update extension icon/badge on tab change
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  updateBadge(tab.url);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    updateBadge(tab.url);
  }
});

function updateBadge(url) {
  try {
    const domain = new URL(url).hostname;
    chrome.action.setTitle({ title: `Password Manager - ${domain}` });
  } catch (e) {
    console.log('Invalid URL:', url);
  }
}
