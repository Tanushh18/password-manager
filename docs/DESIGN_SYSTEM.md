# Stashr design system

One world: jungle, river and waterfall, robots, airport, railway, buses and a growing city.
The decoration carries the brand; the controls stay calm and consistent so the world never
gets in the way of a task.

## Files

| File | What it holds |
|---|---|
| `client/src/styles/theme.css` | Colour palette (dark default, `data-theme="light"`), legacy classes (`.btn`, `.card`, `.input`, `.pill`, `.field`, `.notice`, `.page`, `.shell`), world palette (`--forest-*`, `--emerald`, `--river`, `--runway`, `--sun`). |
| `client/src/styles/system.css` | Final layer: semantic tokens, type and spacing scales, app shell (sidebar, mobile bar), `.ui-*` primitives, dialogs, accessibility helpers. |
| `client/src/Components/UI/ui.jsx` | `PageHeader`, `Panel`, `EmptyState`, `Badge`, `Skeleton`, `Stat`. |
| `client/src/Components/UI/Dialogs.jsx` | `DialogProvider`, `useDialogs()` → `confirm()` / `prompt()`, `DialogFrame`. |
| `client/src/lib/navigation.js` | Navigation groups shared by the sidebar, bottom bar and More sheet. |

## Tokens

**Colour (semantic):** `--primary`, `--accent`, `--bg`, `--surface`, `--surface-raised`, `--surface-sunken`, `--surface-hover`, `--line`, `--line-strong`, `--heading`, `--text`, `--text-muted`, `--text-faint`, `--ok`, `--warn`, `--danger`, `--info`, `--focus`, `--disabled`, `--scrim`. Each has dark and light values; `*-rgb` variants exist for tints. Never hard-code a colour in a page; scenery may use the world palette.

**Type:** `--fs-xs` 12 · `--fs-sm` 13 · `--fs-base` 15 · `--fs-md` 16 · `--fs-lg` 18 · `--fs-xl` 22 · `--fs-2xl` 28 (page titles). Display font: Plus Jakarta Sans; body: Inter; secrets and boards: JetBrains Mono. `--lh-tight` 1.2, `--lh-body` 1.55.

**Spacing:** 4px grid, `--space-0`…`--space-8` (2, 4, 8, 12, 16, 24, 32, 48, 64).

**Shape and motion:** radii `--r-sm` 8 → `--r-2xl` 20, `--r-pill`. Durations `--t-fast` 0.12s, `--t` 0.18s, `--t-slow` 0.25s, `--t-enter` 0.22s; easing `--ease-out`. All looping scenery stops under `prefers-reduced-motion`.

**Shell:** `--sidebar-w` 248px, `--sidebar-w-collapsed` 68px, `--content-max` 1200px. Breakpoints: phone < 760px (top bar + bottom bar), tablet 760–1099px (icon rail), desktop ≥ 1100px (full sidebar, collapsible).

## Components and rules

- **Page header**: every app page starts with `PageHeader` (title, one-line context, actions on the right). One primary action per page.
- **Buttons**: `.btn--primary` (the main task), `.btn--ghost` (secondary), `.btn--quiet` (tertiary), `.btn--danger` (destructive, always behind a dialog). Icon-only buttons need `aria-label` and a `title`.
- **Dialogs**: use `useDialogs()` instead of `window.confirm/prompt`. Give a specific title, say what changes (`details` for lists), label the confirm button with the verb. Typed confirmation (`match`) for irreversible account-level actions.
- **Empty states**: `EmptyState` with what the view is for and the next action.
- **Badges**: `Badge tone="ok|warn|danger|info|accent|neutral"`; colour is never the only signal, there is always text.
- **Themed panels**: `.vx-head` + `VaultBackdrop` (horizon), `DepartureBoard` (split-flap status), `TransitCity` (vault as a city). They show real state only, link to the page that fixes it, and never display secret values.
- **Focus**: visible focus ring (`--focus`) on every control; dialogs trap focus and restore it.

## Photos

Photos is outside this system. `body.route-photos` is set on its routes and the global tweaks in `system.css` skip it.
