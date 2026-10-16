# Stashr Quality Gates

## Pull request gates

- Server: `npm ci`, all tests and full dependency audit.
- Web: `npm ci`, tests, production build and full dependency audit.
- Mobile: `npm ci`, Expo doctor, Android export/bundle and full dependency audit.
- Security workflow: CodeQL, Gitleaks, Trivy and dependency review.
- New code: focused unit tests, authorization tests, negative/error-path tests and documented behavior.
- Schema/crypto changes: web ↔ Android interoperability tests and backward-compatibility fixtures.
- Connector changes: adapter contract tests and safe mocked provider responses.

## Release gates

- No unapproved critical/high vulnerability.
- No unresolved secrets finding; exposed credentials are revoked, not just deleted.
- Cross-account access tests pass.
- Backup restore and rollback are tested for changes that affect persistence or deployment.
- Staging smoke test and post-deploy health check pass.
- Observability is fresh and alert delivery has been tested.
- Release notes include changes, risks, migration, rollback and workflow URLs.

## Failure handling

A missing scanner result, skipped job or upstream scanner outage is **incomplete**, not passed. Document the exact failing check and remediation. Never weaken or skip a gate solely to obtain a green run.
