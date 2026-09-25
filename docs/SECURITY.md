# Aurelia security design

## Goals

* The server (and anyone who steals its database or backups) cannot read vault contents.
* A stolen session token alone is not enough to read the vault.
* Web and Android use the exact same formats, so one account works everywhere.

## Keys

| | |
| --- | --- |
| Key derivation | PBKDF2-HMAC-SHA256, **600,000** iterations, 16-byte random salt per account |
| Vault key | 256-bit output of the KDF; never leaves the device |
| Item encryption | AES-256-GCM, fresh 12-byte IV per write, 16-byte tag |
| Blob format | `v1:<base64 iv>:<base64 ciphertext‖tag>` |
| Key check | `keyCheck` = encryption of a fixed string, stored server side to verify the master password locally |

The server stores the salt, iteration count and `keyCheck` — all public by design.

Implementations: `client/src/lib/crypto.js` (browser WebCrypto), `mobile/src/lib/cryptoCore.js`
(react-native-quick-crypto / OpenSSL). `client/tests/crypto.test.mjs` proves they interoperate
(keys, blobs, tamper detection, TOTP RFC 6238 vectors, backups).

## Item contents

Each item is one encrypted JSON document: name, website, username, password, notes, 2FA secret,
folder, favourite flag and password-changed date. Only the item id and created/updated timestamps are
visible to the server.

## Authentication

* The master password is also sent over TLS at sign-in, where the server checks it against a
  **bcrypt** hash (cost 12). The server never stores the password or the derived vault key.
  *Trade-off:* a fully compromised live server could capture passwords at sign-in. A future version can
  send a separately-derived authentication hash instead; the `kdf` fields are versioned for that.
* Sessions are JWTs (30 days, random `jti`), stored server side so they can be revoked
  (`/logout`, `/account/logout-all`, master password change). Max 10 sessions per account.
* Optional TOTP two-factor login (RFC 6238, ±1 step, replay protection) with 10 one-time recovery
  codes (stored as SHA-256 hashes). The TOTP secret is sealed with the server key (AES-256-GCM),
  because the server must verify codes.
* Login, register and sensitive account routes are rate limited per IP.

## Clients

* **Web:** the key lives only in memory — a reload locks the vault; auto-lock after inactivity
  (default 15 minutes). Revealed passwords hide after 20 s.
* **Android:** without biometrics the key lives only in memory. With biometric unlock on, the key is
  stored in the Android Keystore via `expo-secure-store` with `requireAuthentication`, so it is released
  only after a fingerprint / face check and is invalidated if biometrics change. Auto-lock after the
  app is backgrounded (default 30 s). Copied secrets are wiped from the clipboard after 30 s.
  `FLAG_SECURE` blocks screenshots and hides the app in recents. The offline cache contains only
  ciphertext.

## Third parties

* **Have I Been Pwned** (breach check, on demand): only the first 5 hex characters of each password's
  SHA-1 are sent, with response padding enabled.
* **DuckDuckGo icons** (opt-in): the domain of each saved website is requested.

## Legacy data

Accounts from before end-to-end encryption stored entries encrypted with a server key. On the first
sign-in with an updated client, the vault key is created (`/vault/setup`), each legacy entry is
unsealed once by the server (`/decrypt`), re-encrypted on the device and replaced (`/vault/migrate`),
after which the server can no longer read it. Legacy server encryption now uses AES-256-GCM;
the oldest AES-256-CBC entries remain readable for migration.

## Recovery

There is no master-password recovery. That's inherent to zero-knowledge encryption. Users are warned at
sign-up and encouraged to keep an encrypted backup.
