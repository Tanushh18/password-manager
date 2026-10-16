# Stashr Platform Upgrade Plan

**Repository:** `Tanushh18/password-manager`  
**Product:** Stashr — password vault, project/service manager, Render operations and cron/monitoring portal  
**Status:** Implementation plan and acceptance contract. A checkbox is not evidence of completion; link test runs and observed results before marking an item done.

## 1. Mission and non-negotiable constraints

Build one control plane for credentials, projects, hosting services, deployments, scheduled work, observability and repository security, without forcing every provider into a false common denominator.

1. Preserve the existing zero-knowledge vault format and web/Android interoperability.
2. Never transmit or log vault plaintext, master passwords, access tokens or environment-secret values to telemetry, scan output, issue comments or AI services.
3. Do not replace a provider's real capability with a simulated success. Return explicit `supported`, `unsupported`, `permission_denied`, `rate_limited` or `unavailable` states.
4. Keep production mutations behind authorization, validation, audit records and explicit confirmation; high-impact operations may require a second approval.
5. Make migrations additive, backward compatible and reversible wherever possible. Do not automatically rotate or revoke live user credentials during a scan.
6. Use a branch and pull request for the upgrade; do not bypass failing checks or merge unverified code.
7. A green CI run proves only the checks that actually ran. Live-provider behavior, mobile builds, backup restores and recovery drills require their own evidence.
8. Prefer a modular monolith with isolated workers and adapters first; split services only when measurements justify it.

## 2. Target navigation and product boundaries

- **Operations Center:** health overview, incidents, fleet comparisons, resource peaks, alerts and recent releases.
- **Service Catalog:** projects, environments, service owners, repository, provider, URL, dependencies and runbooks.
- **Vault:** existing end-to-end encrypted password/secret records; maintain zero-knowledge boundaries.
- **Infrastructure:** provider accounts, resources, quotas, connection health and supported lifecycle operations.
- **Deployments:** commits, builds, release status, health checks, rollback capability and deployment history.
- **Cron & Workflows:** timezone-aware schedules, run history, retries, timeouts, concurrency and worker health.
- **Monitoring & Logs:** metrics, traces, structured logs, incident timeline and retention.
- **Repository Security:** manual/automatic scans, findings, severity, evidence, affected file/dependency, remediation and rescan verification.
- **Governance:** roles, sessions, audit, approvals, policy and backup/restore evidence.
- **Cost & Usage:** real billing data where APIs provide it; otherwise visibly marked estimates.

Every page needs a clear purpose, a concise explanation for each action, keyboard-accessible controls, responsive layout, empty/loading/error states and a link to its runbook.

## 3. Architecture

- **Web client:** existing React/Vite app; keep route-level code split for large operations pages.
- **Core API:** authentication, authorization, tenant/user scoping, service catalog, policy and audit.
- **Connector SDK:** provider adapters with versioned contracts and capability discovery.
- **Worker process:** long-running sync, scans, scheduled jobs, retries and provider API work; do not block request handlers.
- **Queue and idempotency:** durable job state, deduplication keys, bounded retries, timeouts, dead-letter handling and cancellation.
- **Telemetry pipeline:** OpenTelemetry-compatible metrics/logs/traces with redaction and bounded retention.
- **Storage:** existing MongoDB for application records; use time-series/metrics storage only when volume requires it. Redis/queue storage is not the sole durable record of a completed operation.
- **Secrets:** keep vault ciphertext and infrastructure integration credentials separate. Provider tokens must be encrypted at rest, least-privilege and never returned after write.
- **Optional host agent:** outbound-only authenticated telemetry and explicitly allowed commands; no unrestricted remote shell or inbound public agent port.

## 4. Common connector contract

Each adapter must expose, where meaningful:

- `validateConnection()`
- `discoverResources()`
- `getResource(resourceId)`
- `getCapabilities(resourceId)`
- `getMetrics(resourceId, window)`
- `getLogs(resourceId, query)`
- `listDeployments(resourceId)`
- `deploy(resourceId, release)`
- `restart/pause/resume/rollback(resourceId)` only when supported
- rate-limit/backoff behavior, pagination, API version handling and typed errors
- contract tests for expired credentials, insufficient scopes, timeout, pagination, empty responses and provider outage

Initial order: existing Render adapter, GitHub/Actions, Vercel, Netlify, Railway, Fly.io, Docker, Kubernetes, AWS, Azure, Google Cloud, then self-hosted Linux/Windows. This is a target list, not a claim that all connectors are already implemented.

## 5. Operations Center requirements

- Aggregate only compatible metric dimensions, units, sampling windows and timestamps; show per-service breakdown alongside totals.
- Show provider, environment, freshness, source and gaps for every metric. Never label estimates as measurements.
- Record time-series on the server/worker independently of whether a browser is open.
- Provide 1h/6h/24h/7d/30d windows where retention supports them, peak timestamps and deploy overlays.
- Health states: healthy, degraded, down, unknown/stale. Missing telemetry is unknown, not healthy.
- Alert rules: threshold, duration, cooldown, deduplication, acknowledgement, escalation and recovery message.
- Keep log redaction, query bounds, pagination, access checks and retention limits mandatory.
- Monitor the monitor: last successful poll, queue depth, worker heartbeat, API rate limit and notification delivery.

## 6. Cron and workflow engine

- Persist schedule, timezone, next-run, owner, target, secret references, timeout, concurrency policy and retry policy.
- Use a durable queue/worker model and unique execution IDs.
- Assume at-least-once delivery; require idempotent job handlers rather than promising universal exactly-once execution.
- Use leases/locks with expiry, bounded backoff, jitter, cancellation and dead-letter status.
- Capture exit status, duration, redacted output, attempt number and correlation ID.
- Support pause/resume, manual run, safe rerun, missed-run policy, schedule preview and per-job quotas.
- Prevent secret values from appearing in command lines, logs, job names or UI errors.
- Test process crashes, duplicate deliveries, timezone/DST changes, overlapping schedules, provider timeouts and worker restarts.

## 7. Repository security scanning feature

Implement a dedicated, repeatable security workflow with automatic scans on push/PR, weekly schedule and manual dispatch.

### Required scan layers

1. **Dependency vulnerabilities:** `npm ci` + full `npm audit` (production and development) for server, client and mobile lockfiles. Fail on high/critical findings; retain machine-readable reports.
2. **Static application analysis:** CodeQL JavaScript/TypeScript using extended security queries; publish SARIF.
3. **Secrets and credential leaks:** Gitleaks against the repository/history. Treat a finding as sensitive; never echo secret values into logs or comments.
4. **Filesystem/dependency/configuration scan:** Trivy for OS/library vulnerabilities, secret patterns and IaC/config misconfiguration. Fail on high/critical findings; upload a SARIF/report artifact.
5. **Pull request dependency review:** when GitHub Dependency Graph is enabled and repository variable `ENABLE_DEPENDENCY_REVIEW=true`, block newly introduced high/critical vulnerable dependencies. Full npm audits remain enabled regardless.
6. **Manual security review:** authentication/session lifecycle, authorization boundaries, IDOR, rate limits, input validation, SSRF, command injection, path traversal, unsafe deserialization, XSS, CSRF, CORS, security headers, TLS/proxy trust, logging/redaction, backup access, encryption/key management and mobile deep links/storage.
7. **Dynamic testing:** authenticated/unauthenticated API tests, abuse/rate-limit tests, invalid/expired tokens, cross-account access tests and safe staging DAST. Never run destructive DAST against production without an explicit approved scope.
8. **Supply chain:** lockfile integrity, pinned CI permissions, action version review, least-privilege GitHub token, artifact retention and provenance where supported.

### Finding lifecycle

Each finding must record scanner/source, timestamp, severity, confidence, file/line or package, affected version, evidence without secrets, remediation, owner, status and verification run. States: open, triaged, accepted with expiry/owner, fixed-awaiting-rescan, verified-fixed, false-positive with justification. Do not suppress by broad rule or hide a failed scan as success.

### Severity response targets

- Critical: block release; triage immediately; mitigate before deployment.
- High: block release; fix or document a time-bounded exception approved by owner.
- Medium: assign owner and due date; resolve according to exposure.
- Low/informational: track and batch where appropriate.
- Any leaked credential: revoke/rotate at the issuing provider immediately; deleting the line alone is not remediation.

These are policy targets, not a guarantee that any scanner detects every vulnerability.

## 8. Identity, security and audit

- Preserve current zero-knowledge encryption contract and test web/mobile format compatibility before changing crypto.
- Review account authentication separately from vault encryption; document the live-server password-capture trade-off.
- Use least privilege, secure cookies, session revocation, MFA/TOTP recovery, rate limits and CSRF protections where applicable.
- Verify ownership on every resource lookup and mutation; never rely on UI-only admin checks.
- Audit actor, target, action, timestamp, result, request/correlation ID and approval; redact secrets and personal payloads.
- Encrypt integration tokens at rest with a separately managed key; rotate keys with a documented rollback/recovery procedure.
- Backups must be encrypted, access-controlled, retained intentionally and restored in a clean test environment on a schedule.
- Define retention and deletion rules for audit events, metrics, logs and scan artifacts.

## 9. Test and release gates

Every change should pass applicable gates:

- Server: unit/integration tests; authorization and cross-account isolation; error-path tests.
- Web: unit tests, production build, route/accessibility checks and vault crypto regression suite.
- Mobile: Expo dependency alignment, doctor, Android bundle/export, crypto interoperability and APK/AAB build in EAS or equivalent.
- Dependencies: full lockfile-based audit across all three package roots.
- Security: CodeQL, Gitleaks, Trivy and PR dependency review.
- Integration: mocked provider contract tests plus opt-in live smoke tests against a non-production account.
- Operations: job retry/timeout, worker crash, stale telemetry, notification failure, backup restore and rollback drills.
- Performance: bounded API response time, pagination, rate limits, queue backlog and load tests based on defined targets.
- Release: deploy to staging, verify health, inspect errors, approve rollout, verify post-deploy health, and document rollback.

Do not call the platform production-ready solely because CI is green.

## 10. Execution plan

This is one continuous upgrade program; phases are ordering and acceptance gates, not permission to stop after the audit.

1. Baseline current behavior and capture failing checks.
2. Land the security scanner and complete upgrade/runbook documentation.
3. Fix current CI failures and add missing tests before broad refactors.
4. Improve Operations Center, server-side history, alerts and service grouping.
5. Harden access boundaries, vault integration and audit/backup controls.
6. Make cron execution durable and observable.
7. Add connector contract and implement providers incrementally.
8. Add repository scan results/triage UX and remediation workflow.
9. Run all CI and staging checks; fix regressions; publish a truthful verification report.

## 11. Definition of done

- [ ] All planned code/docs/config changes have reviewable diffs.
- [ ] Existing vault crypto interoperability tests pass unchanged or with approved, tested migration.
- [ ] All server and web tests/builds pass.
- [ ] Mobile doctor, export and native build are green or the remaining blocker is explicitly documented.
- [ ] Full dependency audits and repository scanners complete; no unapproved high/critical findings.
- [ ] Access-control, cross-account, secret-redaction and recovery tests pass.
- [ ] Cron failure/retry/recovery scenarios pass.
- [ ] Provider capabilities and unsupported actions are accurately displayed.
- [ ] Staging smoke tests, backup restore and rollback are evidenced.
- [ ] Release report lists commit, workflow URLs, test results, remaining risks and rollback procedure.

## 12. Current verification notes

At the time this plan was drafted, the latest observed CI run had server tests and web tests/build passing, while the mobile `expo-doctor` check failed because nine Expo SDK packages were behind the expected patch versions. This must be rechecked on the upgrade branch; do not assume it is still the only failure. The existing CI dependency audits omitted development dependencies, so the new security workflow audits complete lockfiles.


## 13. Implemented on `feat/stashr-full-platform-upgrade` (verify latest CI before release)

- Repository security workflow: full dependency audit across server/web/mobile, CodeQL, Gitleaks, Trivy, optional dependency review and opt-in passive ZAP staging DAST.
- Admin Security Center: reads real GitHub workflow runs and job statuses, links to exact run details, and handles API rate limits without claiming a clean scan.
- Scheduler operations: bounded run-history collection in the existing MongoDB, per-step duration/status summaries, safe numeric counters only, retention cap, and an expiring Mongo-backed lease to avoid duplicate ticks across API instances.
- Operations UI: displays recent scheduler runs and step outcomes.
- API health: separate `/livez` (process liveness) and `/readyz` (database readiness) endpoints; the existing `/health` remains compatible.
- Mobile dependency alignment: updates the eight Expo SDK patch versions reported by `expo-doctor` and refreshes the lockfile with package integrity hashes.
- Tests: safe scheduler summary, authenticated persisted status endpoint, readiness/liveness, distributed lease, Security Center and scanner workflow coverage.

These are code changes, not release certification. The latest branch CI/security runs must complete successfully. The optional ZAP job is skipped until `STAGING_BASE_URL` is configured to an authorized HTTPS staging target. Provider connectors beyond existing Render/GitHub integrations, production restore drills, and live-provider acceptance still need implementation/evidence before the overall roadmap can be marked complete.
