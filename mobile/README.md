# Aurelia for Android

The Aurelia password vault as a native Android app (Expo SDK 57 + Expo Router).
It talks to **the same Express API and MongoDB** as the website, so an account
created on either works on both.

## Features

- **Aurora UI** — animated aurora background, glass cards, gradient buttons,
  springy haptic interactions, dark / light / system themes
- **Vault** — search, filter (weak / reused / old), sort, pull to refresh,
  reveal (auto-hides after 20s), one-tap copy (clipboard wiped after 30s),
  add / edit / delete
- **Live vault health** — animated score ring driven by the server's `/insights`
  endpoint (strength, reuse and age — plaintext never leaves the server)
- **Generator** — random passwords (8–48 chars, toggles) or memorable passphrases,
  live strength meter, "save to vault"
- **Biometric lock** — fingerprint / face unlock, re-locks after 30s in the background
- **Live server status** — pings `/health`, fails over between the two API servers
- Session token stored in the Android Keystore via `expo-secure-store`

## Run it locally

```sh
cd mobile
npm install
npx expo start          # then press "a" for an Android emulator / device
```

Biometrics and secure storage need a development build (`npx expo run:android`)
or an EAS build; Expo Go works for everything else.

Point the app at another API (for local development):

```sh
EXPO_PUBLIC_API_URLS=http://192.168.1.20:8000 npx expo start
```

The default servers live in `app.json → expo.extra.apiServers`.

## Build an APK with EAS

```sh
npm install -g eas-cli
export EXPO_TOKEN=<your token from expo.dev/settings/access-tokens>
cd mobile
eas init --non-interactive --force     # first time: creates the EAS project
npm run build:apk                      # installable .apk (profile "preview")
npm run build:aab                      # Play Store bundle (profile "production")
```

Or run the **Android build (EAS)** GitHub Action after adding `EXPO_TOKEN` as a
repository secret. The build link appears on expo.dev under your account.

## Structure

```
src/app/            routes (Expo Router)
  _layout.js        providers, fonts, auth guards (signed out / locked / ready)
  auth/             welcome, login, signup
  lock.js           biometric lock screen
  (tabs)/           vault, health, generator, settings + floating tab bar
  editor.js         add / edit modal
src/components/     Aurora background, UI kit, cards, ring, toast, icons
src/lib/            api client, session/vault state, theme tokens, strength
```
