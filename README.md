# Aurelia — Aurora Password Vault

A zero-knowledge password manager with a website **and a native Android app** that share one API
and one database. Everything in your vault is encrypted **on your device** with a key derived from your
master password — the server only ever stores ciphertext.

[![CI](https://github.com/Tanushh18/password-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/Tanushh18/password-manager/actions/workflows/ci.yml)

## Features

| | Web | Android |
| --- | :---: | :---: |
| End-to-end encryption (PBKDF2-SHA256 600k → AES-256-GCM) | ✓ | ✓ (native) |
| Logins with website, username, password, notes, folders, favourites | ✓ | ✓ |
| Stored 2FA secrets with live codes | ✓ | ✓ + camera QR scan |
| Vault health: weak, reused, old, **breached** (Have I Been Pwned, k-anonymity) | ✓ | ✓ |
| Password + passphrase generator with strength meter | ✓ | ✓ |
| Two-factor login (TOTP) with recovery codes | ✓ | ✓ |
| Change master password (full re-key), sign out other devices, delete account | ✓ | ✓ |
| Encrypted backup + CSV export; import from Aurelia, Chrome, Bitwarden, 1Password, LastPass | ✓ (+ Excel) | ✓ |
| Auto-lock after inactivity | ✓ | ✓ |
| Biometric unlock (key in Android Keystore) | – | ✓ |
| Offline read-only vault | PWA shell | ✓ |
| Screenshot blocking | – | ✓ |
| Dark / light theme, opt-in website icons | ✓ | ✓ |

Existing accounts from before end-to-end encryption are upgraded automatically: on the first sign-in with
an updated client, the vault key is created and every old entry is re-encrypted on the device.

See [`docs/SECURITY.md`](docs/SECURITY.md) for the full security design.

## Repository layout

```
server/   Express 5 + Mongoose 9 API            npm test  → API tests (in-memory MongoDB)
client/   Vite + React 19 website (PWA)          npm test  → crypto interop, importers, health
mobile/   Expo SDK 57 Android app (Expo Router)  see mobile/README.md
```

## Running locally

```sh
# API
cd server && npm install
cp config.env.example config.env   # or create it, see below
npm run dev:start                  # http://localhost:8000

# Website
cd client && npm install
VITE_API_URLS=http://localhost:8000 npm run dev   # http://localhost:3000

# Android app
cd mobile && npm install
EXPO_PUBLIC_API_URLS=http://<your-computer-ip>:8000 npx expo run:android
```

`server/config.env`:

```sh
MONGO_URL=<MongoDB connection string>          # DATABASE / MONGODB_URI also accepted
SECRET_KEY=<long random string for signing sessions>
CRYPTO_SECRET_KEY=<long random string>         # seals 2FA secrets + legacy entries
CLIENT_ORIGINS=<optional extra CORS origins, comma separated>
SELF_URL=<optional public URL, enables keep-alive self ping>
```

Use the **same** `SECRET_KEY` and `CRYPTO_SECRET_KEY` on every server that shares a database.

## Deploying

* **API** — `render.yaml` is a Render Blueprint (`npm start` runs `server.js`, health check `/health`).
* **Website** — static site: build command `npm install && npm run build`, publish directory `client/build`,
  and add a rewrite of `/*` to `/index.html`. Set `VITE_API_URLS` if your API lives elsewhere.
* **Android** — run the *Android build (EAS)* GitHub Action after adding an `EXPO_TOKEN` secret,
  or build locally (see `mobile/README.md`). `REACT_APP_ANDROID_URL` / `VITE_ANDROID_URL` sets the
  website's download link.

## Keeping the server awake

`GET /health` is public and dependency free so an uptime pinger (cron-job.org, UptimeRobot…) can keep a
free instance warm. `/healthz`, `/api/health`, `HEAD /health`, `/ping` and `/` also answer 200. With
`SELF_URL` (or Render's `RENDER_EXTERNAL_URL`) set, the server pings itself every 14 minutes
(`KEEP_ALIVE=false` disables it, `KEEP_ALIVE_MINUTES` changes the interval).

## API

"session" = the `jwtoken` httpOnly cookie (website) or `Authorization: Bearer <token>` (app; the token is
returned by `/login` when the body has `"client": "mobile"`).

| Method | Route | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | – | Health check |
| `POST` | `/register` | – | Create an account (`kdf` + `keyCheck` set up end-to-end encryption) |
| `POST` | `/login` | – | Sign in; `code` for two-factor; returns the vault's KDF settings |
| `GET` | `/logout` | session | Revoke this session |
| `GET` | `/authenticate` | session | Profile, vault settings and encrypted items |
| `POST` | `/vault/setup` | session | One-time key setup for pre-E2E accounts |
| `POST` | `/vault/items` | session | Add an encrypted item |
| `POST` | `/vault/items/bulk` | session | Import up to 1000 encrypted items |
| `PUT` | `/vault/items/:id` | session | Replace an item (also converts a legacy entry) |
| `DELETE` | `/vault/items/:id` | session | Delete an item |
| `POST` | `/vault/migrate` | session | Convert legacy entries to encrypted blobs |
| `POST` | `/account/profile` | session | Rename |
| `POST` | `/account/password` | session + password (+2FA) | Change master password, atomic re-key |
| `POST` | `/account/logout-all` | session | Sign out every other device |
| `POST` | `/account/delete` | session + password (+2FA) | Delete account and vault |
| `POST` | `/2fa/setup` · `/2fa/enable` · `/2fa/disable` · `/2fa/recovery-codes` | session | Two-factor login |
| `POST` | `/decrypt`, `/addnewpassword`, `/updatepassword`, `/deletepassword`; `GET /insights` | session | Legacy routes for old clients |

# How to contribute?
This project is completely open source. Everyone's contribution is welcome here.
The following are guidelines for contributing to this project.

### 🚩 New Issue : 
For any bug or a new feature please open an issue [here](https://github.com/rockingrohit9639/password-manager-mern/issues/new)

### 🚩 Forking repository :
Firstly you have to make your own copy of the project. For that, you have to fork the repository. You can find the fork button on the top-right side of the browser window. (Refer to the image below )
Kindly wait till it gets forked.
After that copy will look like <your-user-name>/password-manager-mern forked from rockingrohit/password-manager-mern.

### 🚩 Clone repository :
Now you have your own copy of the project. Here you have to start your work.
Go to the desired location on your computer where you want to set up the project.
Right-click there and click on git bash. A terminal window will pop up
Type the command git clone <your-fork-url>.git and hit enter.
Wait for few seconds till the project gets copied
  
### Set up the project as described in "Running locally" above.

### 🚩 Pushing your changes :
After doing the changes, and when tests are successfully passing you can push your changes to remote.
Go to your terminal and type git status and hit enter, this will show your changes from the files.
Then type in git add . and hit enter, this will add all the files to the staging area.
Commit the changes by git commit -m "<message-describing-your-change>" and hit enter.
Now push your branch to your fork by git push origin <your-branch-name> or git push and hit enter.

### 📌 Creating a pull request : 
By this time you can see a message on your GitHub fork as your fork is ahead of rockingrohit9639: master by <number> of commits and you can also see a button Compare and pull request.
Click on Compare and pull request button
Fill the form completely by describing your change, cause of change, issue getting fixed etc.
After filling the form completely click on Create Pull request
  
Then your work is done. Thank you for your submissions. I will review your code and merge it.
