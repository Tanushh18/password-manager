# Stashr Android server-managed updates

Stashr no longer publishes Expo/EAS OTA updates. Every change under `mobile/**` builds a complete Android APK in GitHub Actions and publishes it with a versioned update manifest.

## Runtime flow

1. Settings → Check for updates calls `GET /api/mobile-updates/android/latest?currentVersionCode=<installed-code>` on the configured Stashr API server.
2. The server reads the latest stable GitHub Release for `Tanushh18/password-manager` and validates the manifest/package name.
3. Stashr downloads the APK through `GET /api/mobile-updates/android/download`, which streams the release asset through the Stashr API server, then opens Android's package installer.
4. Android requires the user to allow installs from Stashr if needed and confirm the installation. Android does not permit silent self-installation for an ordinary app.
5. Native modules, Android permissions, Gradle/config-plugin changes and JavaScript/UI changes all use this same full-APK pipeline; no manual OTA publish is needed.

## Required GitHub Actions secrets

Create one long-lived Android signing key and add these repository secrets:

- `ANDROID_KEYSTORE_BASE64`: base64-encoded JKS/PKCS12 keystore bytes.
- `ANDROID_KEYSTORE_PASSWORD`: keystore password.
- `ANDROID_KEY_ALIAS`: key alias.
- `ANDROID_KEY_PASSWORD`: key password.

Keep the keystore and passwords private, back them up securely, and never rotate this key casually. Every update must be signed by the same key or Android will reject it as an update. Do not use a temporary CI-generated debug key.

Example PowerShell conversion (run locally on the keystore file):
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes(".\stashr-upload.jks")) | Set-Clipboard
```
Paste the copied value into the `ANDROID_KEYSTORE_BASE64` secret. Do not commit the keystore or the base64 value to the repository.

## Server configuration

The API uses GitHub's Releases API for the public repository by default. Optional server environment variables:

- `STASHR_UPDATE_REPOSITORY`: repository in `owner/name` format; defaults to `Tanushh18/password-manager`.
- `STASHR_UPDATE_GITHUB_TOKEN`: fine-grained token with read-only Contents/Metadata access, only needed if the release repository is private.

The API process needs outbound HTTPS access to api.github.com and GitHub release asset URLs. The APK is stored as a release asset, not on Render's ephemeral filesystem.

## One-time migration

Install the first APK built by this workflow over the existing app only if its signing certificate matches the currently installed app. If Android reports a signature conflict, uninstall the old app and install the new APK once (back up anything stored only locally first). The package ID stays `com.tanush.stashr.com`; server-backed account data is not removed by reinstalling, but local-only data can be.

## Release behavior

- Pushes to `main` that change `mobile/**` automatically build and publish a release.
- The Android `versionCode` is assigned monotonically from the GitHub Actions run number.
- `mobile/app.json` controls the user-facing app version. Bump `expo.version` for a visible version change; the pipeline stamps the unique Android versionCode at build time.
- GitHub Actions build artifacts are diagnostic copies; the server update endpoint resolves the latest stable GitHub Release.
- The legacy EAS OTA workflow is removed. No `EXPO_TOKEN` is required for this release pipeline.
