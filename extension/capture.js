/* Login capture. Runs on every page, but only reads a form when it is submitted and it has a filled password field.
   Then it sends the page host, the username and the password to the background, which asks the user before saving.
   Nothing else on the page is read, and nothing is sent when no password was typed. */
(() => {
  const USERNAME_HINT = /user|email|login|account/i;
  const TEXTUAL = ['text', 'email', 'tel', ''];

  const usernameFieldOf = (form, passwordField) => {
    const before = Array.from(form.querySelectorAll('input'))
      .filter((el) => TEXTUAL.includes(el.type) && !el.disabled)
      .filter((el) => passwordField.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING);
    return before.slice().reverse().find((el) => USERNAME_HINT.test(`${el.name} ${el.id} ${el.autocomplete} ${el.placeholder}`))
      || before[before.length - 1]
      || null;
  };

  const handle = (form) => {
    const passwordField = form.querySelector('input[type="password"]');
    if (!passwordField || !passwordField.value) return;
    const username = usernameFieldOf(form, passwordField);
    chrome.runtime.sendMessage({
      type: 'credentials-submitted',
      host: location.hostname,
      username: username ? username.value : '',
      password: passwordField.value
    }).catch(() => {});
  };

  document.addEventListener('submit', (event) => {
    if (event.target instanceof HTMLFormElement) handle(event.target);
  }, true);

  // Pages that submit with a button and no submit event: the click is the signal.
  document.addEventListener('click', (event) => {
    const button = event.target.closest && event.target.closest('button, input[type="submit"]');
    if (button && button.form) handle(button.form);
  }, true);
})();
