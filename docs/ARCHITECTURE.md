# Stashr Target Architecture

## Design choice

Start with a **modular monolith plus separately runnable workers**, not a rewrite into many microservices. Keep the current React/Vite client, Node/Express API and MongoDB model until profiling or isolation requirements justify a migration.

## Logical modules

1. Identity and policy: sessions, MFA, resource ownership, roles and approvals.
2. Vault: end-to-end encrypted vault records; server never requires vault plaintext.
3. Project/service catalog: projects, environments, owner, repository, provider and dependencies.
4. Provider connectors: capability-based adapters and typed errors.
5. Operations: probes, resource metrics, fleet grouping, alerts and incidents.
6. Deployments: release records, CI status, health gates and supported rollback.
7. Scheduler: schedules and durable run state; worker executes jobs.
8. Security scanning: scan orchestration via CI, report metadata, finding lifecycle and rescan verification.
9. Audit: append-only/tamper-evident events, redacted payloads.
10. Cost/usage: source-backed provider cost and quota data, clearly labelled estimates when unavailable.

## Data-flow rules

- Browser → authenticated API → policy check → adapter/worker → provider.
- Long-running work is queued; request handlers return a job ID and status.
- Every operation has a correlation ID, timeout, retry policy, audit event and redaction boundary.
- Provider tokens are decrypted only inside the connector execution boundary and never returned to the client after write.
- Telemetry is collected independently of open browser tabs; stale/missing data is shown as unknown.
- Aggregate only comparable metrics (same units, time window and resource scope); always retain per-service breakdown.
- Never execute arbitrary user-provided shell commands on a host. Use allowlisted, versioned actions with least-privilege credentials.
- Cross-provider mutations require explicit capability and permission checks.

## Scaling path

1. Modular monolith and one worker process.
2. Durable queue and independently scaled workers.
3. Dedicated telemetry store when MongoDB retention/query volume requires it.
4. Isolate high-risk connectors/host agents.
5. Split services only where scale, reliability or security boundaries demand it.

## Reliability

- Idempotent operations, bounded retries, jitter, timeouts and circuit breakers.
- Provider rate-limit awareness and per-account concurrency limits.
- Health/readiness checks and graceful shutdown.
- Database backup and tested restore.
- Queue replay/dead-letter handling.
- SLOs and error budgets before promising availability.
