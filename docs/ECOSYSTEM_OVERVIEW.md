# Stashr ecosystem: how the projects run and how they are connected

Last updated: 2026-10-29. Covers Stashr (this repo), Deal Radar, Tasks (We Three) and ggnHome.
No secrets are written here; variable names only.

## 1. The big picture

```
                        ┌──────────────────────────────┐
                        │  STASHR server (Render)      │
                        │  main: …-server-g305         │
                        │  old : …-server-xxdr (suspended)
                        │  MongoDB, GET /registry/<app>│
                        └──────┬───────────┬───────────┘
          server list (public) │           │ admin: Servers page
        ┌──────────────┬───────┘           │ (Render API, GitHub API)
        ▼              ▼                   ▼
   Deal Radar app   Tasks app       Render env + deploy of other apps,
   (Expo, Android)  (Expo, Android) repo variable + OTA workflow dispatch
        │              │
        ▼              ▼
   Deal Radar       Tasks backend
   servers          servers
```

Stashr is the **bridge**. The mobile apps do not contain their own backend URLs. They ask Stashr
("which servers are mine?"), keep the answer on the phone, then talk to those servers directly.
Stashr itself only serves the list; it does not sit in the data path.

## 2. Stashr (password-manager repo)

| Part | Folder | Notes |
|---|---|---|
| Web client | `client/` | React/Vite. Live: `stashr.tanush.qd.je`, `stashr.ggnhome.com` |
| API server | `server/` | Express + MongoDB, on Render. Main: `password-manager-server-g305` |
| Android app | `mobile/` | Expo/React Native. Server list: g305 first, xxdr as fallback (`src/lib/api.js`, `app.json`) |
| Browser extension | `extension/` | Uses the same API |

What it does: password vault, project/secret records, Render operations (services, env vars, deploys,
cron/ping jobs), and the **server registry** for the other apps.

### Registry
- Public read: `GET <stashr>/registry/<app>` returns `{ app, urls: [...] }`. An empty list means "switched off" and the
  app blocks itself. Apps: `stashr`, `dealradar`, `ggnhome`, and the Tasks app.
- Edited on the web **Servers** page (admin only). The first URL in the Stashr list is the **main server**.
- When the main server changes, Stashr checks its health first, writes the change to the sync history, and runs the
  propagation described below.

### Propagation (Servers page → "Apps that follow Stashr's main server")
Code: `server/utils/stashrPropagation.js`, `stashrPropagationRunner.js`, `stashrOta.js`, `stashrMainChange.js`.

When the main URL changes (or "Update selected apps now" / "Test on this app" is pressed):

| Target | What Stashr does |
|---|---|
| Stashr web client (`stashr-client`) | Writes `VITE_API_URLS` (all URLs, main first) and redeploys it |
| Web/server apps (e.g. ggnHome) | Writes `STASHR_SERVER_URL` (+ `REACT_APP_` / `VITE_` variant) to their Render service(s) and redeploys |
| Mobile apps with an OTA workflow (Deal Radar, Tasks) | Does **not** touch Render. Saves the GitHub repo variable `STASHR_SERVER_URL` and starts the OTA workflow |

Rules: automatic mode needs one successful "Test on this app" first. The card shows, per app, the server env,
server deploy and OTA steps, plus the last Stashr frontend update. It needs a saved GitHub token with `repo` and
`workflow` scope. The list of OTA apps is `OTA_WORKFLOWS` in `server/utils/stashrOta.js`.

### Releases and OTA of the Stashr app itself
`.github/workflows/android-apk.yml` builds the APK and an OTA bundle. The server serves the OTA at
`/api/ota/manifest` (`server/router/ota.js`, default URL in `mobile/app.config.js`). There is no Expo/EAS OTA for it.

## 3. Deal Radar (Tanushh18/Deal_Radar)

Deal aggregation from Telegram channels: fetch, parse, deduplicate, price history, alerts.

| Part | Where | Notes |
|---|---|---|
| Backend | `app/` (FastAPI, Python 3.11) on Render | Several servers with a role set by `NODE_ROLE`: `ingest`, `validator`, `user`, `standby` |
| Node registry | MongoDB `nodes` collection (`app/services/nodes.py`) | Each server heartbeats role + `SELF_URL`; the others find healthy user servers; `USER_NODE_URL` is the static fallback |
| Data | MongoDB (`MONGODB_URI`), Turso/libSQL (`TURSO_*`), local SQLite (`DB_PATH`), Google Sheet sync | Deal retention and TTL set by env |
| Telegram | Telethon session (`TELEGRAM_*`), bot (`TG_*`) | Only the ingest server can reach Telegram |
| Push | Firebase Cloud Messaging (`FCM_SERVICE_ACCOUNT_JSON`) | |
| Mobile app | `mobile/` (Expo, Android, `com.tanush.dealradar`) | |

### How the app finds its server
1. `mobile/src/native/registry.ts` asks Stashr: build env `EXPO_PUBLIC_STASHR_SERVER_URL`, then g305, then xxdr.
2. The answer for app `dealradar` is saved on the phone (`AsyncStorage` key `dr.registry`) and applied
   (`config.ts`). If every Stashr address fails, the saved list is kept.
3. There is **no built-in backend URL**. With no list and no Stashr, requests go to an invalid address and the app
   shows the blocked screen. An empty list from Stashr also blocks the app.
4. Stashr is polled while the app is open and when it returns to the foreground.

### Release pipelines (`.github/workflows/`)
`eas-update.yml` (OTA on push to `main` touching `mobile/**`, or manual; publishes EAS branches `preview` and
`production`, needs `EXPO_TOKEN`), `eas-build.yml`, `eas-init.yml`, `eas-diagnose.yml`, `live-banners.yml`.
The workflow passes the repo variable `STASHR_SERVER_URL` to the build as `EXPO_PUBLIC_STASHR_SERVER_URL`.

## 4. Tasks / We Three (Tanushh18/Tasks)

Family management app: tasks, finance, contacts, events, leads, AI help.

| Part | Where | Notes |
|---|---|---|
| Backend | `backend/` Node/Express + TypeScript, MongoDB (Atlas) | Two Render servers for fail-over |
| Mobile app | `mobile/` (Expo/React Native, Android) | |
| Local server | `local-server/` | Optional local helper |

### How the app finds its server
`mobile/src/api/registry.ts` works like Deal Radar's: Stashr addresses in order (build env, g305, xxdr), list saved on
the phone, polled while open, blocked screen when the list is empty (`ServerOffGate`). `client.ts` uses the list in
priority order and fails over on 502/503/504. `EXPO_PUBLIC_API_URL(S)` exists only for local development and tests.

### Release pipelines
- `build-apk.yml`: builds the APK on push to `main` (mobile changes), can send it to Firebase App Distribution.
- `publish-ota.yml`: manual self-hosted OTA. Bundles go to the `ota-<version>` GitHub release; installed apps pick
  them up within about 30 minutes of being opened. JS-only changes; native changes need a new APK.
- `firebase-distribute.yml`: manual tester distribution.
- All three build with `STASHR_SERVER_URL` → `EXPO_PUBLIC_STASHR_SERVER_URL`. See `docs/BUILD_AND_OTA.md` in that repo.

## 5. ggnHome (ggnhome629-git/ggnHome)

Not part of this session's repo scope, so only what Stashr itself knows is listed here:
- Three parts: `client` (CRA, reads `REACT_APP_` variables), `partner-portal` (Vite, `VITE_`) and `server` (plain env).
  Stashr writes `STASHR_SERVER_URL`, `REACT_APP_STASHR_SERVER_URL` and `VITE_STASHR_SERVER_URL` to its Render
  services (2 services linked in Stashr) and redeploys them (`PROJECT_NAMES` in `stashrPropagation.js`).
- It reads its server list from the Stashr registry (app `ggnhome`) and falls back to `REACT_APP_Base_API`.
- Domains seen in Stashr: `stashr.ggnhome.com` (Stashr web client) and `dealradar.ggnhome.com` (public Deal Radar
  address, also a Render custom domain). The `ggnhome.com` zone is behind Cloudflare.
Fill in the rest (database, hosting, release flow) from that repo.

## 6. What is wired to what

| From | To | How | Changes when |
|---|---|---|---|
| Deal Radar app | Stashr | `GET /registry/dealradar` | Stashr list edited |
| Tasks app | Stashr | `GET /registry/<tasks app>` | Stashr list edited |
| Stashr app | Stashr | its own server list, then registry | URL change in `app.json` / `api.js`, or registry |
| Stashr main change | Render | env var + deploy of web/server apps | Servers page save |
| Stashr main change | GitHub | repo variable `STASHR_SERVER_URL` + workflow dispatch for Deal Radar and Tasks | Servers page save |
| Deal Radar servers | MongoDB / Turso / Telegram / FCM | env vars on Render | Render env |
| Tasks servers | MongoDB Atlas | env vars on Render | Render env |

## 7. Failure cases to remember

- **A Stashr server is suspended (e.g. xxdr):** apps that already hold a saved list keep working from it, but they no
  longer see list changes (including "switch off"). A fresh install with no reachable Stashr address has no list and
  blocks. Keep at least one live address in every app build.
- **Mobile apps do not read Render env.** Render env changes never reach installed phones; only a new build or OTA does.
- **OTA reach:** an installed build receives an OTA only when its runtime version matches.
- **Propagation errors** show on the Servers page per app: missing GitHub token scope (`repo`, `workflow`), missing
  `EXPO_TOKEN` secret, a suspended Render service (variable saved, deploy skipped).
- **Do not paste env values** (tokens, DB URIs, service-account JSON) into chats or docs. Rotate any that were shared.

## 8. Checklist after changing the main Stashr server

1. Servers page: set the new URL first in the Stashr list; confirm its health check passes.
2. Check the propagation card: each app shows server env / deploy / OTA, and the Stashr frontend line is green.
3. Open the Actions tab of Deal Radar and Tasks and confirm the OTA run succeeded.
4. Set the repo variable `STASHR_SERVER_URL` in Deal_Radar and Tasks if it is missing.
5. Test a fresh install (clear app data) to confirm the app gets its list from the new address.
