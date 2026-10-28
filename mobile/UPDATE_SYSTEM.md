# Stashr Android updates: APK and OTA from our server

Stashr ships through GitHub Actions and serves everything from the Stashr API server. Expo's servers are not used at runtime, and no `EXPO_TOKEN` is required.

| Change | How it reaches the phone |
| --- | --- |
| Native code, Android permissions, Gradle or config-plugin changes, or a version bump in `mobile/app.json` | A new signed APK, installed through Android's package installer after the user confirms. |
| JavaScript, screens, styles or assets, with the same version | An OTA bundle, downloaded and applied on launch. |

## Build and publish (GitHub Actions)

Workflow: `.github/workflows/android-apk.yml` (**Stashr Android Release**). It runs on pushes to `main` that touch `mobile/**`, and by hand with **Run workflow**.

1. Stamps the Android `versionCode` from the run number.
2. `npx expo prebuild` and `./gradlew assembleRelease`, signed with the persistent upload keystore.
3. Verifies the APK with `apksigner` and writes `stashr-update.json`.
4. `npx expo export --platform android` and `node scripts/build-ota-bundle.js <version> dist ota`.
   This produces `ota/ota-manifest.json` plus one file per bundle or asset, named by its SHA-256.
5. Publishes one GitHub Release with the APK, `stashr-update.json`, `ota-manifest.json` and the OTA files.

## Runtime flow

### APK
1. Settings → Check for updates calls `GET /api/mobile-updates/android/latest?currentVersionCode=<installed-code>`.
2. The server reads the latest stable GitHub Release and validates the APK manifest.
3. The app downloads `GET /api/mobile-updates/android/download`, which streams the APK through the Stashr server, then opens Android's installer.
4. The user confirms. Android does not allow silent self-installation for an ordinary app.

### OTA (Expo Updates protocol, version 1)
1. On launch, the app requests `GET /api/ota/manifest` (`updates.url` in `mobile/app.config.js`) with `expo-protocol-version: 1`, `expo-platform: android` and `expo-runtime-version: <version>`.
2. The server returns `204` when no bundle matches that runtime version. Otherwise it returns a `multipart/mixed` response with the manifest and asset URLs on the Stashr server.
3. The app downloads `GET /api/ota/asset/<hash>.<ext>`. Each file is verified against its SHA-256 before use.
4. The runtime version is `mobile/app.json` → `version` (`appVersion` policy). A bundle only reaches APKs with the same version, so a native change always needs a version bump and a new APK.

## Required GitHub Actions secrets

Create one long-lived Android signing key and keep it safe. Run this once on a trusted machine with Java's `keytool` installed, and store the passwords in a password manager:

```bash
keytool -genkeypair -v -keystore stashr-upload.jks -alias stashr -keyalg RSA -keysize 2048 -validity 10000
```

- `ANDROID_KEYSTORE_BASE64`: base64 of the `.jks` file, on one line (`base64 -w 0 stashr-upload.jks`).
- `ANDROID_KEYSTORE_PASSWORD`: keystore password.
- `ANDROID_KEY_ALIAS`: the alias used when creating the key (`stashr` above).
- `ANDROID_KEY_PASSWORD`: key password.

Keep the keystore and passwords private and backed up. Every release must be signed by the same key, or Android will reject it as an update. Never paste the base64 value into chat, issues or commits.

## Server configuration

- `STASHR_UPDATE_REPOSITORY` (default `Tanushh18/password-manager`): repository whose latest release is served.
- `STASHR_UPDATE_GITHUB_TOKEN` (optional): GitHub token for API rate limits.
- App OTA URL: `updates.url` in `mobile/app.config.js`, overridable with `STASHR_OTA_URL` at build time.

## Checks

- `GET /api/ota/manifest` without the `expo-runtime-version` header returns `400`. With the right version it returns `200` (multipart) or `204`.
- Server tests: `cd server && npm test` (includes `tests/ota.test.js` and `tests/mobileUpdates.test.js`).
