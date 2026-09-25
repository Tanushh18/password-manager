# Aurelia for Android

The Aurelia vault as a native Android app (Expo SDK 57, Expo Router, React Native 0.86).
It uses **the same API, database and encryption format** as the website, so one account works on both.

## Features

- **Zero-knowledge encryption** — PBKDF2-SHA256 (600k rounds) and AES-256-GCM run natively
  (`react-native-quick-crypto` / OpenSSL). The key is derived on the phone and never sent anywhere.
- **Biometric unlock** — the vault key is stored in the Android Keystore and released only after a
  fingerprint / face check; auto-lock when the app is backgrounded (30 s by default).
- **Rich items** — website, username, password, notes, folders, favourites, and **2FA secrets with live
  codes** (paste a setup key, or scan the QR code with the camera).
- **Vault health** — weak, reused, old and **breached** passwords (Have I Been Pwned, k-anonymity).
- **Generator** — random passwords (8–48 chars) or memorable passphrases.
- **Account** — two-factor login with recovery codes, change master password (full re-key), sign out
  other devices, delete account.
- **Your data** — encrypted backup and CSV export through the share sheet; import Aurelia backups or
  Chrome / Bitwarden / 1Password / LastPass CSVs.
- **Offline** — the last synced (encrypted) vault opens read-only without a connection.
- **Privacy** — screenshots blocked and the app hidden in recents; copied secrets are wiped from the
  clipboard after 30 s; revealed passwords hide after 20 s.
- **Aurora UI** — animated aurora background, glass cards, haptics, dark / light / system theme.

## Develop

Native modules (crypto, biometrics, camera) need a development build, not Expo Go:

```sh
cd mobile
npm install
npx expo run:android                                  # builds and installs a dev build
EXPO_PUBLIC_API_URLS=http://192.168.1.20:8000 npx expo start --dev-client
```

The default API servers are in `app.json → expo.extra.apiServers`.

## Build an installable app

### With EAS (recommended)

```sh
export EXPO_TOKEN=<token from https://expo.dev/settings/access-tokens>
npx eas-cli@latest init --non-interactive --force   # first time: creates/links the EAS project
npm run build:apk    # installable .apk (profile "preview")
npm run build:aab    # Play Store bundle (profile "production")
```

Or add `EXPO_TOKEN` as a GitHub secret and run the **Android build (EAS)** workflow.
Once the project is linked, `app.config.js` turns on over-the-air updates (`eas update`), and the
app's *Settings → Check for updates* pulls them.

### Locally (Android SDK + JDK 17)

```sh
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease     # app/build/outputs/apk/release/app-release.apk
```

Local release builds are signed with the debug key; use EAS (or your own keystore) for the Play Store.

## Play Store checklist

- Privacy policy: `https://<your-website>/privacy` (page included in the website).
- Data safety: account email + name (for sign-in); vault contents are end-to-end encrypted;
  camera used only for scanning 2FA QR codes; no ads, analytics or tracking.
- Build with `npm run build:aab` and submit with `npx eas-cli submit -p android`.

## Structure

```
src/app/              routes (Expo Router)
  _layout.js          providers, fonts, auth guards (signed out / locked / ready), FLAG_SECURE
  auth/               welcome, sign in (+2FA), sign up
  lock.js             biometric / master password unlock
  (tabs)/             vault, health, generator, settings + floating tab bar
  editor.js           add / edit item
  scan.js             camera QR scanner for 2FA secrets
  account/            two-factor, master password, data (export/import), delete
src/components/       UI kit, item card, live TOTP code, aurora background…
src/lib/              api, vault state, cryptoCore (+ native / web adapters), items, health, breach
```
