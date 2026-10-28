# Stashr App Development, OTA & Android Release Guide

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
│   ├── app.config.js           Dynamic Expo Updates/OTA configuration
│   ├── eas.json                EAS build profiles, channels and environments
│   ├── package.json            Mobile dependencies and commands
│   ├── src/app/                Expo Router screens and navigation
│   ├── src/components/         Reusable UI, cards, icons, effects and status views
│   ├── src/lib/                API client, vault, crypto, sync, cache and theme
│   └── modules/stashr-autofill/ Native Android autofill integration
├── extension/                  Chrome/Chromium password autofill extension
├── docs/                       Project and security documentation
├── .github/workflows/          CI, APK, EAS build, OTA and distribution workflows
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

**Do not casually change the Expo owner, slug or Android package ID.** The owner/slug identify the EAS project, and the Android package identifies the installed app. Changing these can disconnect OTA updates or produce an app users install alongside the old one.

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

## 4. OTA update status and how it works

### What was already in the repository

- `expo-updates` is installed in `mobile/package.json`.
- `mobile/app.json` already defines `runtimeVersion.policy = "appVersion"`.
- Settings already contains **App → Check for updates** and uses `expo-updates`.
- `mobile/app.config.js` used to disable OTA when no EAS project ID was available.
- The EAS build workflow already ran `eas init`, but there was no dedicated GitHub Actions workflow to publish an OTA update.
- The GitHub-runner Gradle APK workflow did not link the EAS project before prebuild, so that APK could be generated with OTA disabled.

### What the release configuration now does

- `mobile/app.config.js` enables Expo Updates only when an EAS project ID is available. It produces an update URL in the form `https://u.expo.dev/<EAS_PROJECT_ID>` and exposes the current OTA release label in `extra.stashrRelease`.
- The app checks for an OTA update on launch (`checkAutomatically: "ON_LOAD"`) and uses the configured channel header.
- `mobile/eas.json` explicitly pairs the `preview` and `production` build profiles with their matching EAS channels/environments.
- `.github/workflows/android-ota.yml` is the separate manual **Publish Android OTA Update (EAS)** workflow. It accepts channel, OTA release version, message, and a production confirmation field.
- `.github/workflows/android-apk.yml` is the separate APK workflow. It accepts a `preview` or `production` channel, OTA release label, and optional Firebase distribution fields. It requires `EXPO_TOKEN` and validates the EAS URL, channel, runtime and version label before building, so it will not silently create an OTA-disabled APK. A one-time `[build-apk]` push trigger starts this initial build; later builds can be triggered manually.
- In-app Settings displays app version, Android build number, OTA release label, channel, runtime version, update ID/time, and the result of the last manual update check.

### First-time requirement

The committed `mobile/app.json` does not contain a hard-coded `extra.eas.projectId`. The workflows link the app using `eas init --non-interactive --force` with the Expo account represented by the repository's `EXPO_TOKEN` secret. That token must have access to the intended EAS project under owner `tanushhhhh18` and slug `aurelia-vault`.

**Install a new OTA-enabled APK once after this configuration is deployed.** The prepared base app version is `2.3.1`, Android version code `7`, OTA label `2.3.1-build.7`. An older APK that was built with OTA disabled cannot gain OTA support merely because a bundle was published later.

### Publish an OTA update from GitHub Actions

1. Push/review the JavaScript and asset changes on `main`.
2. Open the repository's **Actions** tab.
3. Select **Publish Android OTA Update (EAS)** and click **Run workflow** from `main`.
4. Choose `preview` first for testing, or `production` for the production channel.
5. Enter a meaningful release message and run the workflow.
6. Review the job result and EAS update record. Install a preview APK that was built for the same channel/runtime to test preview updates.
7. Open Stashr and use **Settings → App → Check for updates**. With OTA enabled, Stashr fetches the update and offers to restart. The normal launch check can also download a compatible update for the next launch.

The workflow requires the repository Actions secret `EXPO_TOKEN`. It uses the EAS environment matching the selected channel (`preview` or `production`). Choose a new label such as `2.3.1-ota.1` each time. Production publishing also requires the `confirmProduction` checkbox.

### Safe OTA boundaries

OTA is for JavaScript/React Native UI and compatible bundled assets. **Build a new APK/AAB** when a change requires native code or native configuration, including:

- Adding/removing a native dependency or Expo config plugin.
- Changing Android permissions, package ID, manifest or other native settings.
- Changing the Expo SDK/React Native native runtime.
- Making a change that is incompatible with the currently installed native binary.

The runtime version policy is `appVersion`. OTA updates only apply when the installed app's runtime version matches the update's runtime version. Before releasing an incompatible native change, bump `mobile/app.json → expo.version` as part of the native release and build/distribute a new APK/AAB. Do not publish an incompatible bundle to the production channel.

## 5. Android APK/AAB build workflows

There are two APK-build paths. They are not the same signing/build mechanism.

### A. Android APK (GitHub runner)

Workflow: `.github/workflows/android-apk.yml`

- Trigger: **Actions → Android APK (GitHub runner) → Run workflow**.
- Runs `npm ci`, generates the Android native project with Expo prebuild, and runs Gradle `assembleRelease` on GitHub's Ubuntu runner.
- Input `channel`: `preview` or `production`. The selected channel is embedded into the native app configuration.
- Output artifact: `stashr-android-apk`, file `mobile/stashr-release.apk`.
- `EXPO_TOKEN` is required. The workflow fails early rather than silently producing an APK with OTA disabled.
- This workflow uses the default/debug signing key from the generated Expo project. It is for internal/testing distribution, **not a Play Store production signing key**.
- Firebase distribution is disabled by default. Turn on the `distribute` input only when the Firebase secrets and tester group/email are configured.

### B. Android build (EAS)

Workflow: `.github/workflows/android-build.yml`

- Trigger: **Actions → Android build (EAS) → Run workflow**.
- Requires the `EXPO_TOKEN` repository secret.
- Profile `preview` creates an installable internal-testing APK and uploads artifact `android-preview-apk`.
- Profile `production` creates an Android App Bundle (`.aab`) for Play Store release.
- Can distribute a preview APK to Firebase App Distribution if Firebase secrets are configured.
- The `preview` and `production` profiles are configured to use matching OTA channels.

### C. Re-send an existing APK to Firebase

Workflow: `.github/workflows/firebase-distribute.yml`

Use this if the APK build succeeded but Firebase distribution failed. Enter the run ID from the relevant **Android build (EAS)** workflow and the intended tester group/email addresses.

### D. CI checks

Workflow: `.github/workflows/ci.yml`

Runs server tests, web checks/build, Expo Doctor and an Android JS bundle export for pull requests and manual workflow dispatch. A successful JS export is useful, but is not the same as successfully compiling/installing an Android APK.

## 6. Required GitHub Actions secrets

Open **GitHub → Settings → Secrets and variables → Actions**.

| Secret | Required for | Notes |
| --- | --- | --- |
| `EXPO_TOKEN` | Required for the OTA workflow and OTA-enabled GitHub-runner APK | Expo access token for the account that owns/links this EAS project. Do not write it in the repository. |
| `FIREBASE_APP_ID` | Firebase distribution only | Firebase Android app ID. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase distribution only | Entire service-account JSON value. The older secret name `FIREBASE_SERVICE_ACCOUNT` is also accepted by the workflows. |

Do not commit Expo access tokens, Firebase service-account JSON, keystores, signing credentials, database strings or app secrets to Git.

## 7. Local development and build commands

Use Node.js 22 for the same major version used by the current GitHub workflows.

```bash
cd mobile
npm ci
npx expo-doctor
npx expo export --platform android --output-dir /tmp/android-bundle
```

Local Android build (requires Android SDK and JDK 17):

```bash
cd mobile
npx expo prebuild --platform android
cd android
./gradlew assembleRelease
```

EAS builds (requires `EXPO_TOKEN` and a linked EAS project):

```bash
cd mobile
npx eas-cli@latest init --non-interactive --force
npm run build:apk
npm run build:aab
```

Publish an OTA update directly from a trusted local checkout if needed:

```bash
cd mobile
npx eas-cli@latest init --non-interactive --force
npx eas-cli@latest update --platform android --channel preview --environment preview --message "Describe the change"
# Use --channel production --environment production for the production channel.
```

The GitHub Actions workflow is preferred for team releases because it records the channel and message in the workflow run.

## 8. Troubleshooting

### Login works on the website but not in the app

1. Check the active server displayed in Settings and confirm `/health` is responding.
2. Verify the public server registry at `/registry/stashr` returns the intended URLs.
3. Confirm the app sends login to `POST /login` on the API origin, not to the website and not to an obsolete origin with a stale session.
4. Check the server's Render logs for the request status. A sleeping free instance can take time to wake; distinguish a gateway/timeout from invalid credentials.
5. If a different server signed in the session, keep using that server for the session; tokens are verified against the database/session state of the target server.

### Settings says OTA is disabled

- The installed APK was generated without an EAS project ID, or the app's update configuration was disabled at build time.
- Ensure `EXPO_TOKEN` is configured, run the GitHub runner APK workflow again, and check that **Link EAS project** and **Confirm OTA configuration** succeeded.
- Install that newly generated OTA-enabled APK before publishing an OTA update.

### OTA workflow succeeds but the phone sees no update

- Confirm the installed APK channel matches the chosen channel (`preview` versus `production`).
- Confirm the app version/runtime is compatible. Current policy uses `mobile/app.json → expo.version`.
- Ensure the workflow published to the intended EAS project and that the Expo token can access it.
- Open Settings → App → Check for updates, then restart if prompted. OTA applies only to supported JS/assets changes.
- A newly added native module, permission, Expo plugin or SDK change requires a new APK; OTA cannot install native code.

### Build or distribution fails

- EAS workflow: verify `EXPO_TOKEN` is a valid Expo access token for the intended project.
- GitHub-runner APK: inspect the **Generate the Android project** and **Build the release APK** steps first.
- Firebase step: set `FIREBASE_APP_ID` and `FIREBASE_SERVICE_ACCOUNT_JSON`, or disable distribution in the workflow input.
- When comparing build types, remember the GitHub-runner APK signing key is different from an EAS-generated APK. Uninstalling may be necessary when switching between those signing identities.

## 9. Release checklist

- [ ] Changes reviewed and pushed to `main`.
- [ ] Select the correct target: preview tester APK, production-channel APK, or Play Store AAB.
- [ ] Confirm `EXPO_TOKEN` exists for OTA/EAS builds.
- [ ] Use preview OTA first; test on a preview APK built with the same runtime.
- [ ] Use production OTA only for JS/assets compatible with the production native runtime.
- [ ] Build and distribute a new APK/AAB for native code, plugin, permission or runtime changes.
- [ ] Verify the workflow run, download the artifact if building an APK, install it and test login/update behavior.
- [ ] Never put secrets, vault contents or plaintext exports into source control.

## 10. Official reference links

- Expo EAS Update setup: https://docs.expo.dev/eas-update/getting-started/
- EAS Update overview and publishing: https://docs.expo.dev/eas-update/introduction/
- Runtime version compatibility: https://docs.expo.dev/eas-update/runtime-versions/
- EAS Update debugging: https://docs.expo.dev/eas-update/debug/
