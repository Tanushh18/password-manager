# Stashr Integration Compatibility Matrix

Status vocabulary: **Implemented** = code exists; **Verified** = passing contract/live test evidence exists; **Planned** = not implemented or not verified. Do not promote a provider to Verified without evidence.

| Provider / layer | Inventory | Metrics | Logs | Deploy | Restart/pause/rollback | Current status |
|---|---|---|---|---|---|---|
| Render | Existing integration | Provider-dependent usage + health probes | Provider-supported | Existing features; verify each route | Capability-specific | Implemented; re-verify |
| GitHub repositories | Existing project integration | Workflow/check data, not host metrics | Actions logs when authorized | Workflow/release context | Workflow-specific | Partial; re-verify |
| Vercel | Planned | Provider API dependent | Provider API dependent | Planned | Provider API dependent | Planned |
| Netlify | Planned | Provider API dependent | Provider API dependent | Planned | Provider API dependent | Planned |
| Railway | Planned | Provider API dependent | Provider API dependent | Planned | Provider API dependent | Planned |
| Fly.io | Planned | Provider API dependent | Provider API dependent | Planned | Provider API dependent | Planned |
| Docker / Compose | Planned | Agent/exporter required | Container logs | Image/Compose workflow | Runtime permissions required | Planned |
| Kubernetes | Planned | Metrics pipeline required | Cluster log pipeline | Deployment API | RBAC dependent | Planned |
| AWS | Planned | CloudWatch/API-dependent | CloudWatch/API-dependent | Service-specific | IAM/service-specific | Planned |
| Azure | Planned | Azure Monitor/API-dependent | Azure Monitor/API-dependent | Service-specific | RBAC/service-specific | Planned |
| Google Cloud | Planned | Cloud Monitoring/API-dependent | Cloud Logging/API-dependent | Service-specific | IAM/service-specific | Planned |
| Self-hosted Linux | Planned | Outbound agent/exporter | Journal/syslog agent | SSH/agent workflow | Explicit allowlist required | Planned |
| Self-hosted Windows | Planned | Windows exporter/agent | Event log agent | Agent/WinRM design | Explicit allowlist required | Planned |
| OpenTelemetry | Planned standard | Yes, after collector setup | Yes, after collector setup | Not applicable | Not applicable | Planned |
| Repository security | New workflow | Scanner metrics/results | Artifact logs | CI integration | Blocks release via checks | In implementation |

## Adapter contract tests (required for every provider)

- Valid, invalid, expired and insufficient-scope credentials.
- Empty resource list, pagination, pagination caps and duplicate IDs.
- Provider API timeout, 429 rate limit, 5xx, malformed response and partial outage.
- Missing metric, stale metric, differing units and timezone handling.
- Unsupported operation must not send a mutation request.
- Mutation authorization, confirmation, idempotency and audit entry.
- Secret redaction in errors, logs and stored connection metadata.
- API version changes and schema drift.
- Live smoke tests must use a non-production account and be opt-in.

## Runtime compatibility

Language/framework support should use standard health endpoints, container/OCI metadata, provider APIs and OpenTelemetry rather than claiming that every framework has a native connector. Initial targets: Node.js/TypeScript, Python, Java, Go, PHP, Ruby, .NET and Rust; React/Next.js, Express/NestJS, Django/FastAPI, Spring Boot, Laravel/Rails, ASP.NET; PostgreSQL, MySQL, MongoDB and Redis. Every capability remains provider- and permission-dependent.
