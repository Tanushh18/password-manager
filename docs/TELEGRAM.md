# Stashr Telegram

## Scope
The personal Telegram bot is linked to one private chat. Webhook secret and one-time link code remain mandatory. Password retrieval remains opt-in and PIN-protected.

## Commands and data sources
The command registry lives in `server/utils/telegramCatalog.js`; read handlers live in `server/utils/telegramRead.js`. It covers System, Servers, Projects, Connections, Vault and security, Home, Photos, Money, Apps and Reports. Existing commands such as `/status`, `/servers`, `/incidents`, `/projects`, `/project`, `/pass`, `/report`, `/week` and Home shortcuts remain supported. Deployment summaries use `deployOps.listTargets`; logs use `deployOps.findTarget/logsOf` and redact common credentials and email addresses before display.

Read commands use existing sources: Render monitoring and encrypted history, project entries, account/session metadata, AuditEvent, HomeDevice/HomeEvent/HomeSettings, PhotoImportBatch, ExpenseTx metadata, Registry, ShineSite and scheduler run history. Sensitive vault values, provider tokens, environment values, recovery codes and session JWTs are not sent to Telegram.

## Confirmations
Home control commands and recognized natural-language home actions are staged for two minutes and require an explicit Confirm button. Confirmation tokens are random, single-use and consumed before execution. Incident resolution and Render restart buttons also require fresh, expiring confirmation. The private-chat and webhook-secret checks apply to callbacks.

## Notifications
Categories: system, servers, projects, github, apps, vault, security, home, photos, money, hosting and account. All categories are enabled by default. Existing `updates` mode still controls automatic messages: ask disables them, alerts sends alerts, timer additionally sends scheduled digests.

`TelegramNotification` stores a redacted 30-day delivery history with deduplication and bounded retry. Failed deliveries remain pending and are retried by the scheduler. Backend modules can call `telegramBot.notifyEvent(user, { category, title, text, dedupeKey, html })`. Authenticated event ingestion is available at `POST /telegram/events`; delivery history is available at `GET /telegram/notifications`.

## Known source limitations
- Expense amounts and merchant details are encrypted in the database; Telegram reports counts only. Google-Sheet-only storage is not queried.
- The browser extension has no heartbeat/version record, so its online status cannot be inferred.
- Publishing an APK/OTA release does not prove a device installed it.
- Provider metrics and operations remain limited to connected-provider capabilities and permissions.
- The event API and `notifyEvent` provide the integration point; a source must emit an event before Telegram can notify about it. Existing Home notifications and Render monitoring alerts remain wired through their current paths.

## Security
Never send raw tokens, environment-variable values, vault plaintext, recovery codes or session JWTs. Admin-only capabilities must continue to enforce server-side admin authorization; a private Telegram chat alone is not an admin role.
