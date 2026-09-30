# Stashr Autofill (Chrome extension)

Fills your saved Stashr logins on any website with one click.

- Sign in with your Stashr email and password (and your 2-step code if you use one).
- Click the toolbar icon on a login page: logins for that site are listed first, then all accounts.
- Autofill, copy the password, or show a QR code with the account name and username (the password is never put in the QR).
- Talks only to the Stashr servers listed in `manifest.json` and tries the second one if the first is asleep.
- Only asks for the `activeTab`, `scripting` and `storage` permissions. It does nothing on a page until you click the icon.

## Try it locally (Chrome / Edge / Brave)

1. Open `chrome://extensions`, turn on **Developer mode**.
2. **Load unpacked** and pick this `extension/` folder.

## Build the zip for the Chrome Web Store

From the repository root:

```sh
cd extension
zip -r ../stashr-autofill-extension.zip manifest.json popup.html popup.css popup.js icons
```

Upload that zip in the Chrome Web Store Developer Dashboard. Bump `version` in `manifest.json` for every new upload.

## Notes

- Only logins that have a plain password are shown. Very old entries that the server still keeps encrypted are hidden.
- Item names are always shown as text, never as HTML.
- The QR image is drawn by api.qrserver.com, which sees the account name and username. Say so in the store's privacy section, or remove the QR button.
