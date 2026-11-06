/* Small extension window that asks for the fingerprint (WebAuthn needs an extension page, not the web page the
   dropdown sits on). On success it records the time and tells the background, which then completes the fill or save. */
const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const msg = document.getElementById('msg');

async function unlock() {
  msg.classList.add('hidden');
  try {
    const { touchIdCredential } = await chrome.storage.local.get('touchIdCredential');
    if (!touchIdCredential) throw new Error('Touch ID is not turned on.');
    await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: fromB64(touchIdCredential), transports: ['internal'] }],
        userVerification: 'required',
        timeout: 60000
      }
    });
    await chrome.storage.session.set({ unlockedAt: Date.now() });
    await chrome.runtime.sendMessage({ type: 'unlock-result', ok: true });
    window.close();
  } catch (error) {
    msg.textContent = 'Touch ID was not verified.';
    msg.classList.remove('hidden');
  }
}

document.getElementById('retry').addEventListener('click', unlock);
unlock();
