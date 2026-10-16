# Stashr Operations Runbook

## First response to an incident

1. Check Operations Center health, data freshness and recent deployment markers.
2. Identify affected service/environment and owner; confirm whether metrics are current.
3. Open relevant redacted logs and correlate by request/job/deployment ID.
4. Check provider status, API rate limits, expired credentials and recent configuration changes.
5. Mitigate using a documented, permission-checked action; do not bulk restart unrelated services.
6. Verify health after mitigation, record timeline/root cause and create a follow-up.

## Queue / cron failure

- Check worker heartbeat, queue depth, lease expiry and the failed execution's attempt count.
- Verify timeout, rate limit and downstream availability.
- Confirm the job is idempotent before rerunning.
- Do not manually delete queue state to clear an alert.
- Check dead-letter items and notify the owner.

## Deployment failure

- Stop further rollout when health gates fail.
- Preserve build/deploy logs with secrets redacted.
- Use rollback only if the provider supports it and the target version is known-good.
- Verify health and error rate after rollback; record the release and operator.

## Security incident / leaked credential

1. Disable/revoke the exposed credential at its issuer immediately.
2. Check audit and provider access logs for misuse.
3. Replace it using the encrypted connection flow; verify the old credential no longer works.
4. Remove exposure from the active code and investigate git history, build logs, artifacts and backups.
5. Rerun secret and dependency scanners; document scope and remediation without copying the secret into incident notes.

## Backup and restore

- Verify backup job completion and integrity, encryption and access controls.
- Restore to an isolated clean environment using documented keys and permissions.
- Run application/crypto compatibility and data-integrity tests.
- Record recovery time and data-loss window; update RTO/RPO based on observed results.
- A backup is not considered reliable until restore is demonstrated.

## Required evidence

Incident/job/deployment ID, UTC timestamps, affected service/environment, observed impact, actions and actor, recovery validation, root cause, follow-up owner and due date. Never include passwords, tokens, raw secret values or vault plaintext.
