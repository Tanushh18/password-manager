// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'autofill') {
    autofillForm(request.username, request.password);
    sendResponse({ success: true });
  }
});

function autofillForm(username, password) {
  // Find all input fields
  const inputs = document.querySelectorAll('input');
  let usernameField = null;
  let passwordField = null;

  // Identify username and password fields
  inputs.forEach(input => {
    const type = input.type.toLowerCase();
    const name = input.name.toLowerCase();
    const id = input.id.toLowerCase();
    const placeholder = (input.placeholder || '').toLowerCase();

    // Find password field
    if (type === 'password') {
      passwordField = input;
    }

    // Find username/email field
    if (!usernameField && (
      type === 'email' ||
      type === 'text' ||
      name.includes('email') ||
      name.includes('user') ||
      name.includes('login') ||
      id.includes('email') ||
      id.includes('user') ||
      id.includes('login') ||
      placeholder.includes('email') ||
      placeholder.includes('user') ||
      placeholder.includes('login')
    )) {
      usernameField = input;
    }
  });

  // Fallback: if no specific fields found, try first text input and last password input
  if (!usernameField) {
    const textInputs = Array.from(inputs).filter(i => i.type === 'text' || i.type === 'email');
    usernameField = textInputs[0];
  }

  if (!passwordField) {
    passwordField = inputs[inputs.length - 1];
  }

  // Fill the fields
  if (usernameField) {
    usernameField.value = username;
    usernameField.dispatchEvent(new Event('input', { bubbles: true }));
    usernameField.dispatchEvent(new Event('change', { bubbles: true }));
  }

  if (passwordField) {
    passwordField.value = password;
    passwordField.dispatchEvent(new Event('input', { bubbles: true }));
    passwordField.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Try to focus on next button or submit button
  setTimeout(() => {
    const submitBtn = document.querySelector('button[type="submit"], input[type="submit"], button:contains("Login"), button:contains("Sign in"), button:contains("Next")');
    if (submitBtn) submitBtn.focus();
  }, 100);
}
