# Stashr App Development & Android Release Guide

> Maintained in the `password-manager` repository. This guide describes the current app code and GitHub Actions workflows; it does not imply that a cloud build or OTA publish has been run successfully.

## 1. Repository and application overview

Repository: https://github.com/Tanushh18/password-manager  
Release branch: `main`

Stashr is a monorepo. The website, API, Android app, browser extension and automation/documentation live together but are separate runtime targets.

```text
password-manager/
├── client/                     React + Vite web app
│   └── src/api/client.js       Web API client, server registry and failover
├── server/                     Express API and data layer
│   ├── server.js               Loads environment and starts the API
│   ├── app.js                  Express, CORS, health endpoints and routing
│   ├── router/                 Login, vault, project, registry and extension routes
│   ├── models/                 MongoDB models and encryption
│   └── utils/                  Server registry, security and background jobs
├── mobile/                     Expo + React Native Android/iOS app
│   ├── app.json                App identity, native plugins and bootstrap API server
│   ├── app.config.js           Dynamic Expo config, incl. the self-hosted OTA URL
│   ├── scripts/build-ota-bundle.js  Turns an Expo export into OTA files for the server
│   ├── package.json            Mobile dependencies and commands
│   ├── src/app/                Expo Router screens and navigation
│   ├── src/components/         Reusable UI, cards, icons, effects and status views
│   ├── src/lib/                API client, vault, crypto, sync, cache and theme
│   └── modules/stashr-autofill/ Native Android autofill integration
├── extension/                  Chrome/Chromium password autofill extension
├── docs/                       Project and security documentation
├── .github/workflows/          CI, APK + OTA release, security and maintenance workflows
├── render.yaml                 Render website/API blueprint
└── README.md                   Repository setup and architecture
```

### Important mobile routes and modules

- `mobile/src/app/_layout.js`: root navigation/providers and signed-out, locked and unlocked app states.
- `mobile/src/app/auth/`: welcome, login, two-factor login and signup.
- `mobile/src/app/(tabs)/`: main vault, password health, generator, photos and settings.
- `mobile/src/app/account/`: two-factor settings, password change, export/import and account deletion.
- `mobile/src/app/editor.js`, `project-editor.js`, `projects.js`, `project.js`: vault item and project flows.
- `mobile/src/components/`: shared UI, item cards, Aurora background, icons, TOTP display, status and toast components.
- `mobile/src/lib/api.js`: mobile HTTP client, session token handling, server registry and failover.
- `mobile/src/lib/vault.js`, `cryptoCore.js`, `crypto.js`: vault state and cryptographic operations.
- `mobile/src/app/(tabs)/settings.js`: app server status, OTA update check, appearance, security and account actions.

## 2. Android app identity

Current values in `mobile/app.json`:

| Setting | Value |
| --- | --- |
| Display name | `Stashr` |
| Expo slug | `aurelia-vault` |
| Expo owner | `tanushhhhh18` |
| Android application ID | `com.tanush.stashr.com` |
| App version | `2.3.1` |
| Android version code | `7` |
| Runtime version policy | `appVersion` |
| Native framework | Expo SDK 57 / React Native 0.86 |

**Do not casually change the Android package ID.** It identifies the installed app; changing it produces a second app next to the old one and breaks updates. The Expo owner and slug are only metadata now, because OTA updates are served by the Stashr server and not by Expo.

## 3. Stashr API server URL

### Primary API origin

```text
https://password-manager-server-xxdr.onrender.com
```

This is the **API origin**, not the website URL. Do not append `/api` to it for the existing mobile login and vault routes.

Useful endpoints:

| Purpose | URL |
| --- | --- |
| API health | `https://password-manager-server-xxdr.onrender.com/health` |
| Public Stashr server registry | `https://password-manager-server-xxdr.onrender.com/registry/stashr` |
| Login | `POST https://password-manager-server-xxdr.onrender.com/login` |
| Confirm signed-in session | `GET https://password-manager-server-xxdr.onrender.com/authenticate` |
| Password/vault and app routes | `https://password-manager-server-xxdr.onrender.com/<route>` |

The app's bootstrap URL is configured under `mobile/app.json → expo.extra.apiServers`. `mobile/src/lib/api.js` supports the build-time override `EXPO_PUBLIC_API_URLS`, refreshes the list from `/registry/stashr`, caches it in SecureStore and tries configured servers when one is asleep or unavailable. The web app uses the same bootstrap origin in `client/src/api/client.js`.

For local development, set `EXPO_PUBLIC_API_URLS` to a server reachable from the device, for example `http://192.168.1.20:8000` on the same LAN. Do not use a computer's `localhost` address from a physical phone.

## 4. Release flow: APK and OTA from GitHub Actions

Every push to `main` that touches `mobile/**` or the release workflow runs **Stashr Android Release** (`.github/workflows/android-apk.yml`). It can also be started by hand from **Actions → Stashr Android Release → Run workflow**, with release notes.

The run does, in order:

1. Stamps a new `versionCode` from the run number and reads the version from `mobile/app.json`.
2. Runs `expo prebuild` and `./gradlew assembleRelease`, signing the APK with the persistent key from the repository secrets.
3. Verifies the APK with `apksigner`, and writes `stashr-update.json` (APK metadata).
4. Runs `npx expo export --platform android` and `node scripts/build-ota-bundle.js <version>`. This produces `mobile/ota/`: one content-addressed file per bundle/asset plus `ota-manifest.json`.
5. Publishes one GitHub Release containing the APK, `stashr-update.json`, `ota-manifest.json` and every OTA file.

The Stashr API server reads the latest release and serves both channels. Phones never talk to Expo's servers.

| Channel | Endpoint on the Stashr server | Used for |
| --- | --- | --- |
| APK update | `GET /api/mobile-updates/android/latest` and `/android/download` | Native changes: new native modules, Android permissions, version bumps. Android asks the user to confirm installation. |
| OTA update | `GET /api/ota/manifest` and `/api/ota/asset/:name` | JavaScript and asset changes. Downloaded and applied by the app on launch. |

### When is OTA used?

- The app's `runtimeVersion` uses the `appVersion` policy, so it equals `mobile/app.json` → `version` (for example `2.3.1`).
- An OTA bundle only reaches phones whose installed APK has the **same** runtime version. The server answers `204` (no update) for any other runtime.
- So: a JS-only change in the same version is delivered by OTA. Any native change needs a version bump, and that new version is delivered as an APK.
- Settings → Check for updates shows the APK status. OTA is applied automatically on launch (`checkAutomatically: ON_LOAD`).

### Server configuration

- `STASHR_UPDATE_REPOSITORY` (default `Tanushh18/password-manager`): the repository whose latest release is served.
- `STASHR_UPDATE_GITHUB_TOKEN` (optional): a GitHub token, used only if API rate limits become a problem.
- The app's OTA URL is set in `mobile/app.config.js` (`updates.url`, default `https://password-manager-server-xxdr.onrender.com/api/ota/manifest`). Override it for a local build with `STASHR_OTA_URL`.

## 5. Workflows

| Workflow | Purpose |
| --- | --- |
| `android-apk.yml` (Stashr Android Release) | Builds the signed APK, the OTA bundle and publishes the GitHub Release. |
| `ci.yml` (CI) | Server tests, web checks and the Android JavaScript export. |
| `security-scan.yml` | Security scanning. |
| `monitor-tick.yml` | Scheduled monitoring tick. |
| `refresh-mobile-lock.yml` | Refreshes the mobile lockfile. |
| Dependabot | Dependency update pull requests. |

Removed: the EAS build workflow, the Firebase redistribution workflow, and the `expo-doctor` CI step. None of them are needed for the APK or OTA flow.

## 6. Required GitHub Actions secrets

Open **GitHub → Settings → Secrets and variables → Actions**. The release workflow needs these four:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64 of the upload keystore (`.jks`), on one line. |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password. |
| `ANDROID_KEY_ALIAS` | Key alias used when the keystore was created (for example `stashr`). |
| `ANDROID_KEY_PASSWORD` | Key password. |

`EXPO_TOKEN` is **not** needed. The OTA bundle is exported and published by GitHub Actions, and the server serves it.

Rules for the keystore:

- Use the **same** keystore for every release. A different key makes Android reject updates over the installed app.
- Keep an offline backup of the `.jks` file and its passwords. GitHub secrets can be overwritten but never read back.
- Do not paste the base64 value into chat, issues or commits.

## 7. Local development and manual build commands

```bash
cd mobile
npm ci
npx expo start                                  # development server
npx tsc --noEmit                                # typecheck
npx expo export --platform android --output-dir dist
node scripts/build-ota-bundle.js 2.3.1 dist ota # OTA files for a local check
```

Local APK build (requires Android SDK and JDK 17):

```bash
cd mobile
npx expo prebuild --platform android --no-install --clean
cd android
./gradlew assembleRelease
```

For local development, set `EXPO_PUBLIC_API_URLS` to a server reachable from the device (see section 3).

## 8. Troubleshooting

### The workflow fails at "Verify persistent Android signing key"
One of the four Android secrets is missing or wrong. Re-check the names in section 6.

### Gradle fails with `OutOfMemoryError: Metaspace` in lint
The workflow already raises the Gradle JVM limits by writing `gradle.properties` in the build step. If this comes back, raise the values there, not in the local `android/` folder, which is regenerated on every run.

### Android says the package conflicts or the update will not install
The phone has an APK signed with a different key. Uninstall the old build once and install the new APK. Afterwards, every release must use the same keystore.

### The phone does not see an OTA update
- Check that the installed APK has the same version as the OTA bundle (`runtimeVersion` = `mobile/app.json` version). A different version gets no OTA update.
- Check the server: `GET /api/ota/manifest` with headers `expo-protocol-version: 1`, `expo-platform: android` and `expo-runtime-version: <version>`. Status `200` means an update exists, and `204` means none is available for that runtime.

### The APK update is not offered
`GET /api/mobile-updates/android/latest` must show the newest `versionCode`. If the latest GitHub release is a draft or prerelease, it is ignored by design.

## 9. Release checklist

- [ ] Changes are reviewed and merged to `main`.
- [ ] The four Android secrets exist and the keystore backup is safe.
- [ ] Decide the channel: JS-only change (OTA, same version) or native/permission change (bump `mobile/app.json` version, APK).
- [ ] The **Stashr Android Release** run is green, and the GitHub Release contains the APK, `stashr-update.json`, `ota-manifest.json` and the OTA files.
- [ ] Install or update the APK on a test phone and confirm Settings → Check for updates shows the new build.
- [ ] Confirm the OTA endpoint returns `200` for the installed runtime version.
- [ ] Never put secrets, vault contents or plaintext exports into source control.

## 10. Official reference links

- Expo Updates configuration: https://docs.expo.dev/versions/latest/sdk/updates/
- Expo Updates protocol (used by the Stashr server): https://docs.expo.dev/technical-specs/expo-updates-1.md
- Runtime version compatibility: https://docs.expo.dev/eas-update/runtime-versions/
