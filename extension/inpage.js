/* In-page dropdown. When a username or password field gets focus, shows the saved logins for this site right under it
   (pick one to fill) and, once a password has been typed, a "Save this login" row. It only receives names and usernames
   to display; the password of a chosen login is requested from the background at click time. */
(() => {
  const USERNAME_HINT = /user|email|login|account/i;
  const TEXTUAL = ['text', 'email', 'tel', ''];

  let host = null, root = null, panel = null, current = null;

  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const isPassword = (el) => el instanceof HTMLInputElement && el.type === 'password';
  const scopeOf = (el) => el.form || document;
  const passwordIn = (el) => Array.from(scopeOf(el).querySelectorAll('input[type="password"]')).find(visible) || null;

  function isLoginField(el) {
    if (!(el instanceof HTMLInputElement) || el.disabled || el.readOnly || !visible(el)) return false;
    if (isPassword(el)) return true;
    if (!TEXTUAL.includes(el.type)) return false;
    const pw = passwordIn(el);
    if (!pw) return false;
    return USERNAME_HINT.test(`${el.name} ${el.id} ${el.autocomplete} ${el.placeholder}`) || el.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING;
  }

  function fieldsFor(el) {
    const password = isPassword(el) ? el : passwordIn(el);
    const inputs = Array.from(scopeOf(el).querySelectorAll('input')).filter((i) => TEXTUAL.includes(i.type) && visible(i) && !i.disabled);
    const before = password ? inputs.filter((i) => password.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_PRECEDING) : inputs;
    const username = isPassword(el) ? (before.slice().reverse().find((i) => USERNAME_HINT.test(`${i.name} ${i.id} ${i.autocomplete} ${i.placeholder}`)) || before[before.length - 1] || null) : el;
    return { username, password };
  }

  function setValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    if (setter && setter.set) setter.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const ask = (message) => new Promise((resolve) => {
    try { chrome.runtime.sendMessage(message, (response) => resolve(chrome.runtime.lastError ? null : response)); } catch (e) { resolve(null); }
  });

  function ensurePanel() {
    if (host) return;
    host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:0;left:0;';
    root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .box{position:fixed;min-width:240px;max-width:340px;background:#fff;color:#14302b;border:1px solid #cfdad7;border-radius:10px;
          box-shadow:0 8px 28px rgba(0,0,0,.22);font:13px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden}
        @media(prefers-color-scheme:dark){.box{background:#17211f;color:#e6f0ee;border-color:#2f4440}.row:hover,.row:focus{background:#22322f}.sub{color:#9bb3ae}.head{color:#9bb3ae}}
        .head{padding:7px 12px 4px;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#5a7771}
        .row{display:flex;gap:10px;align-items:center;width:100%;padding:8px 12px;border:0;background:none;color:inherit;text-align:left;cursor:pointer;font:inherit}
        .row:hover,.row:focus{background:#eef5f3;outline:none}
        .av{flex:none;width:26px;height:26px;border-radius:50%;background:#0d6e5c;color:#fff;display:grid;place-items:center;font-weight:600}
        .t{font-weight:600}.sub{font-size:12px;color:#5a7771;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:240px}
        .msg{padding:10px 12px;color:#5a7771}
        .add{border-top:1px solid #e1eae8}
      </style>
      <div class="box" role="listbox" aria-label="Stashr logins" hidden></div>`;
    panel = root.querySelector('.box');
    // Keep the field focused while the dropdown is clicked.
    panel.addEventListener('mousedown', (e) => e.preventDefault());
    (document.documentElement || document.body).appendChild(host);
  }

  function place(el) {
    const r = el.getBoundingClientRect();
    panel.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - 344))}px`;
    panel.style.top = `${Math.min(r.bottom + 4, window.innerHeight - 60)}px`;
  }

  function hide() {
    if (panel) panel.hidden = true;
    current = null;
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function show(el) {
    ensurePanel();
    current = el;
    const info = await ask({ type: 'suggest' });
    if (current !== el) return;
    const { username, password } = fieldsFor(el);
    const canSave = password && password.value;
    let html = '<div class="head">Stashr</div>';
    if (!info || info.state === 'error') html += '<div class="msg">Could not reach Stashr.</div>';
    else if (info.state === 'signed-out') html += '<div class="msg">Sign in from the Stashr toolbar icon.</div>';
    else if (!info.items.length) html += '<div class="msg">No saved logins for this site.</div>';
    else html += info.items.map((i) => `<button class="row" data-fill="${esc(i.id)}"><span class="av">${esc((i.title.trim()[0] || '•').toUpperCase())}</span><span><div class="t">${esc(i.title)}</div><div class="sub">${esc(i.username || 'No username')}</div></span></button>`).join('');
    if (canSave && info && info.state === 'ok') html += '<button class="row add" data-save="1"><span class="av">+</span><span><div class="t">Save this login to Stashr</div></span></button>';
    if (html === '<div class="head">Stashr</div>') return hide();
    panel.innerHTML = html;
    panel.hidden = false;
    place(el);

    panel.querySelectorAll('[data-fill]').forEach((btn) => btn.addEventListener('click', async (event) => {
      if (!event.isTrusted) return;
      const result = await ask({ type: 'fill', id: btn.dataset.fill });
      if (result && result.ok) {
        if (username && result.username) setValue(username, result.username);
        if (password) setValue(password, result.password);
        hide();
      } else if (result && result.denied) {
        panel.querySelector('.head').textContent = 'Stashr · Touch ID not verified';
      }
    }));
    const save = panel.querySelector('[data-save]');
    if (save) save.addEventListener('click', async (event) => {
      if (!event.isTrusted) return;
      const result = await ask({ type: 'save-now', username: username ? username.value : '', password: password.value });
      panel.innerHTML = `<div class="head">Stashr</div><div class="msg">${result && result.ok ? 'Login saved.' : result && result.denied ? 'Touch ID not verified, nothing saved.' : 'Could not save this login.'}</div>`;
      setTimeout(hide, 1800);
    });
  }

  document.addEventListener('focusin', (event) => {
    const el = event.target;
    if (isLoginField(el)) show(el); else if (!(host && event.composedPath().includes(host))) hide();
  }, true);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hide(); }, true);
  document.addEventListener('mousedown', (event) => { if (host && !event.composedPath().includes(host) && !isLoginField(event.target)) hide(); }, true);
  window.addEventListener('scroll', () => { if (current && panel && !panel.hidden) place(current); }, true);
  window.addEventListener('resize', hide);
})();
