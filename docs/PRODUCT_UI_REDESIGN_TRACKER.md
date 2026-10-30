# Product UI redesign tracker

Branch: `claude/vigilant-hopper-tmupry` · Release: 2.2.0 · Last updated: 2026-10-30

The look stays the one Stashr world: jungle, robots, river and airport. This pass adds a shared
design-system layer, a new app shell and more detail in that world. It is **not** a finished
redesign of every screen. The status column says what was actually done and checked.

**Status key**
- **Redesigned**: new layout/primitives, checked in a browser at 1440px and 390px (light; vault and overview also dark).
- **Updated**: shared shell plus targeted fixes (dialogs, labels, headers). Layout mostly unchanged.
- **Shell only**: picks up the new sidebar / bottom bar; the page itself was not changed.
- **Not started**: inspected, no changes.
- **Excluded**: Photos.

"Checked" means seen in a real browser against a local API server with an in-memory MongoDB and
seeded data. Live Render/GitHub integrations were not connected, so their populated states were not seen.

## Web app pages

| Page | Route | Source | Desktop | Mobile | Status | Notes |
|---|---|---|---|---|---|---|
| Overview (new) | `/dashboard` | `Pages/Dashboard/Dashboard.jsx` | ✓ | ✓ | Redesigned | Horizon header, split-flap departures board, Transit City scene, vault health, recent, favourites, projects, quick actions. Real data only. Signed-in visitors to `/` land here. |
| Passwords / vault | `/passwords` | `Pages/Passwords/Passwords.jsx` | ✓ | ✓ | Redesigned | Compact horizon header with departure-board status; search toolbar; categories-only sidebar; in-app dialogs; deep links `?new=1 ?import=1 ?filter= ?section=`. Item cards/editor unchanged. |
| Item editor / import | modals on `/passwords` | `Components/Item/*` | – | – | Not started | Still `react-responsive-modal`. |
| Generator | `/generator` | `Pages/Generator/Generator.jsx` | ✓ | ✓ | Updated | Result shown first on phones; duplicate `#main` id removed. |
| Security center | `/security-center` | `Pages/SecurityCenter/*` | ✓ | – | Shell only | |
| Projects list | `/projects` | `Pages/Projects/Projects.jsx` | ✓ | – | Redesigned | Shared header holds all actions; search-only toolbar; new empty states; merge uses dialog. |
| Project detail | `/projects/:id` | `Pages/Projects/ProjectDetail.jsx` | – | – | Updated | Child components use in-app dialogs (deployments, branches, Render env sync, env copy). Layout unchanged; not viewed. |
| Project form | `/projects/new`, `/projects/:id/edit` | `ProjectForm.jsx`, `Components/Project/ProjectEditor.jsx` | – | – | Shell only | |
| Create & deploy | `/projects/deploy` | `ProjectDeploy.jsx` | – | – | Shell only | |
| Settings | `/settings` | `Pages/Settings/Settings.jsx` | ✓ | ✓ | Redesigned | Shared header with status badges; duplicate "Sign out others" removed; signage codes removed; Telegram disconnect uses dialog. |
| Control Center | `/render` | `Pages/Render/*` | ✓ | – | Shell only | Robot theme kept. Its own `useConfirm` dialog (RenderUi) still separate from the shared one. |
| Usage | `/services` | `Pages/Services/Services.jsx` | – | – | Shell only | |
| Service map | `/services/map` | `Pages/Services/ServiceMap.jsx` | – | – | Shell only | |
| Cron & alerts | `/cron` | `Pages/Cron/Cron.jsx` | ✓ | – | Updated | Duplicate React key fixed. |
| Server URLs (admin) | `/servers` | `Pages/Servers/*` | – | – | Updated | Save-anyway and propagation test use dialogs. Not viewed (admin only). |
| Security scans (admin) | `/security` | `Pages/Security/Security.jsx` | – | – | Shell only | |
| Admin panel | `/admin` | `Pages/Admin/Admin.jsx` | – | – | Updated | Delete user uses a typed-email dialog. Not viewed. |
| Sign in / Sign up / Forgot | `/signin` `/signup` `/forgot-password` | `Pages/Login`, `SignUp`, `Forgot`, `Components/AuthShell` | ✓ | – | Updated | Field errors now linked with `aria-invalid`/`aria-describedby`; visitor nav in sentence case. |
| Marketing home | `/` (signed out) | `Pages/Home/Home.jsx` | – | – | Not started | |
| Apps / Privacy / Logout | `/apps` `/privacy` `/logout` | `Pages/Apps`, `Privacy`, `Logout` | – | – | Not started | |
| Photos (all) | `/photos*`, `/share/photos/:token` | `Pages/PhotoCloud/*` | ✓ | – | **Excluded** | See exclusion record. |

## Shell and shared components

| Component | Source | Status |
|---|---|---|
| Sidebar (tablet/desktop) | `Components/AppShell/Sidebar.jsx`, `styles/system.css` | New. Groups: Vault, Workspace, Infrastructure, Admin. Collapsible rail (forced on tablets). Search, alerts, theme, account, lock, sign out. Small jungle/river/robot scene. |
| Mobile top bar | `Components/Navbar/Navbar.jsx` (`MobileTopBar`) | New. Brand, search, alerts. |
| Bottom bar + More sheet | `Components/BottomNav/BottomNav.jsx` | Rebuilt from `lib/navigation.js`; "More" opens every destination. |
| Navigation model | `lib/navigation.js` | New, unit tested. |
| Command palette | `Components/CommandPalette/*`, `lib/palette.js` | Opens from buttons too; actions (add, import, new project, generate); combobox ARIA; focus restore. |
| Dialogs | `Components/UI/Dialogs.jsx` | New. Promise `confirm`/`prompt`, focus trap, Escape, bottom sheet on phones. Replaced all 24 `window.confirm/prompt` calls outside Photos. |
| Page primitives | `Components/UI/ui.jsx` | New: PageHeader, Panel, EmptyState, Badge, Skeleton, Stat. |
| Departures board | `Components/DepartureBoard/*`, `lib/dashboard.js` | New split-flap board; data helper unit tested. |
| Transit City | `Components/TransitCity/*`, `lib/transit.js` | New: buildings per item (height = strength), item trains verified by a robot inspector, project buses, newest item landing, jungle/river/waterfall, LED ticker. Unit tested; never reads password values. |
| Vault horizon | `Components/Vault/VaultBackdrop.jsx` | Upgraded: moon/stars or sun, birds, plane, control tower, runway beacons, mist, river shimmer, robot. |
| Jungle scene | `Components/Jungle/*` | Added river, lily pads, frog, jumping fish; left vine hidden beside the sidebar (it sat on page headings). |
| Alert bell | `Components/AlertBell/*` | SVG icon, upward menu in the sidebar, "see all" link. |
| Field | `Components/Field/Field.jsx` | Error/hint linked to the input. |

## Button / action changes

| Where | Action | Decision |
|---|---|---|
| Global nav | "My vault" CTA, "Hello, name" greeting | REMOVED for signed-in users (sidebar and account block cover them). |
| Vault sidebar | Generator, Security audit, Settings links | REMOVED (duplicated the main navigation). |
| Vault header | Settings link | REMOVED (sidebar). Lock kept. |
| Vault | "Add password" | RENAMED "Add item" (it adds cards, notes and identities too). |
| Projects | New project, Create & deploy, Import, GitHub | MOVED into the page header; toolbar is search only. |
| Settings | "Sign out others" row | MERGED into the sessions panel's own action (now confirmed). |
| Control Center / Usage / Map / Cron tab bar | | Hidden beside the sidebar (same destinations listed there); kept on phones. |
| All destructive / outward actions | browser `confirm()` | REPLACED with in-app dialogs listing what changes; danger styling for irreversible ones. |

## Android app (`mobile/`)

Screens found (Expo Router, `mobile/src/app`): tabs `index` (vault), `generator`, `health`, `photos`, `settings`; `auth/index`, `auth/login`, `auth/signup`; `account/data`, `account/delete`, `account/password`, `account/twofactor`; `editor`, `lock`, `scan`, `projects`, `project`, `project-editor`, `deploy-new`, `github`, `servers`, `server`, `server-urls`, `move-server`, `sync-env`, `monitoring`; Photos screens `albums`, `people`, `person`, `photo-backup`, `photo-folders`, `photo-viewer`, `shared` (excluded).

**Status: not started.** No Android code was changed in this pass. An APK build was not possible here
(releases are built by the "Stashr Android Release" workflow), so any Android change needs that
workflow and a device check.

## Browser extension (`extension/`)

| Screen | Status |
|---|---|
| Popup: sign in | Redesigned (labels, light/dark, brand header). Rendered with stubbed Chrome APIs. |
| Popup: accounts, save prompt, Google accounts, QR | Redesigned styling; new account search; SVG icon buttons with labels; empty state. Not run inside a real extension here. |
| Background / capture scripts | Not changed. |

## Photos exclusion record

- No file under `client/src/Pages/PhotoCloud/` changed; nor did the shared pieces Photos imports (`Components/Icons`, `Components/AuthImage`, `lib/media`, `api/client`).
- `App.jsx` adds `body.route-photos` on Photos routes; the global style tweaks in `styles/system.css` skip it.
- Photos keeps its nav position (Workspace group, first item) and its feature flag. Its route wrappers are unchanged.
- What does change around Photos: the app shell (sidebar offset, top padding next to the sidebar) and the jungle scene (river added; left vine hidden beside the sidebar). The page content itself was checked at 1440px and looks the same.

## Tests and builds run

| Check | Result |
|---|---|
| `client`: `npm run lint` | pass |
| `client`: `npm test` | 149 pass (new: navigation, dashboard, transit, palette actions) |
| `client`: `npm run build` | pass |
| `server`: `npm test` | 612 pass (only the version number changed) |
| Browser check (Playwright) | Overview, Passwords, Projects, Settings, Generator, Security center, Control Center, Cron, Sign in, Photos; desktop 1440 and phone 390; no console errors or horizontal overflow on those routes (outside production-server CORS noise) |
| Android build | not run (see above) |
| Extension | popup rendered with stubbed Chrome APIs, no script errors |

## Known issues and remaining work

1. Item editor, import modal, project editor and other `react-responsive-modal` dialogs are not yet on `DialogFrame`.
2. Control Center keeps its own `useConfirm` dialog (`Pages/Render/RenderUi.jsx`); fold it into `Components/UI/Dialogs.jsx`.
3. Project detail, project form, create & deploy, usage, service map, admin pages, marketing home, apps, privacy and logout were not visually reviewed.
4. Android app: no changes.
5. Main JS bundle is ~900 kB (pre-existing). Projects, Settings and Servers could be lazy-loaded like the operations pages.
6. No automated browser tests are committed; the screenshot script used here lived outside the repo.

## Rollout and rollback

- Ship the web client as usual (`client/` build). The server change is only the version number.
- Rollback: redeploy the previous client build, or revert this branch's commits. No data migrations, API changes or stored-format changes were made. Preferences written by this version use existing keys (`aurelia_prefs`), plus `stashr_sidebar_collapsed` for the sidebar.
