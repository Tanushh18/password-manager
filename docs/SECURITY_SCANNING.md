# Repository Security Scanning Runbook

## Run a scan

1. Open **Actions → Security Scan** in the GitHub repository.
2. Select **Run workflow** on the default branch. The workflow runs its full configured scan automatically.
3. Wait for dependency audit, CodeQL, Gitleaks, Trivy and (on PRs) dependency review to finish.
4. Open each failed job and read the finding summary. Download the JSON/SARIF artifacts from the workflow run.
5. Review the Code scanning / Security tab for uploaded SARIF findings, where repository settings support it.
6. Fix the root cause, commit the change and rerun the workflow. A fix is not complete until a clean rescan or documented remaining finding is available.

The workflow also runs on push/pull requests and weekly. It is a static/dependency/configuration scan, not proof that a system is free of vulnerabilities.

## Coverage

- `npm audit` over locked server, web and mobile dependencies, including development dependencies.
- CodeQL extended JavaScript/TypeScript static analysis.
- Gitleaks secret detection.
- Trivy library/OS vulnerability, secret and configuration misconfiguration scan.
- Optional pull-request Dependency Review blocks newly introduced high-severity dependencies when GitHub Dependency Graph is enabled and repository Actions variable `ENABLE_DEPENDENCY_REVIEW=true`. Until then, full `npm audit` runs on all three package roots.
- Optional OWASP ZAP passive baseline DAST runs only when repository variable `STAGING_BASE_URL` is configured. It validates HTTPS and must point to an explicitly authorized staging environment; do not point it at production. The workflow fails on findings according to the baseline action policy.

## Response and handling

- Never paste a discovered token/password into an issue, PR comment, log or report.
- If a live credential is exposed, revoke it at the issuer immediately, issue a replacement, update the encrypted connection, and inspect access logs. Removing a string from the current file is not enough; investigate git history and downstream copies.
- For a vulnerable dependency, record the package, direct/transitive status, affected range, fixed version, runtime reachability and upgrade test. Prefer a supported fixed release; avoid blind force upgrades.
- For a configuration issue, identify the deployment target and actual exposure before applying a fix.
- If a finding is a false positive, record evidence and a narrow, expiring exception. Do not disable a scanner globally to get a green badge.
- If a scanner itself fails, report **scan failed / incomplete**, not **clean**.

## Severity policy

- Critical/high: release-blocking by default; triage immediately and fix or use a time-limited, owner-approved exception.
- Medium: assign an owner and due date based on exposure and exploitability.
- Low/informational: track, batch and re-evaluate.
- Secret exposure: immediate credential revocation/rotation regardless of scanner severity.

## Additional manual checks

Automated scanners do not reliably prove authorization correctness, business-logic safety or runtime configuration. Review authentication and session revocation, per-resource ownership/IDOR, CSRF/CORS, XSS, SSRF, command injection, path traversal, rate limits, proxy trust, TLS, cryptographic key handling, encrypted backup access, Android deep links/secure storage, logging/redaction, and production error responses.

Dynamic scans must run only against an explicitly approved staging target with a defined scope. Do not run destructive payloads against production.

## CI prerequisites and limitations

- GitHub Actions must be enabled.
- Code scanning/SARIF upload may depend on repository security settings and permissions.
- Gitleaks or scanner upstream action changes can affect the workflow; keep actions reviewed and pinned according to repository supply-chain policy.
- Public vulnerability feeds and registry outages can make a scan unavailable. Re-run after the upstream service recovers.
- Reports are retained for 30 days in workflow artifacts; use the GitHub Security tab and your retention policy for longer-term tracking.


## Active time-limited dependency exceptions (approved 2026-10-16)

The repository owner approved only the two exact high-severity package/advisory pairs recorded in [`security/exceptions.json`](../security/exceptions.json). Both expire on **2026-10-30**. The gate fails closed after expiry, on a missing report, or on any unapproved high/critical advisory.

- **`braces` — CVE-2026-93687 / GHSA-vfj7-8cjw-p6xm:** the currently resolved `3.0.3` release is affected and the advisory currently lists no patched release.
- **`node-forge` — CVE-2026-85393 / GHSA-86w9-cpqp-85rv:** the currently resolved `1.4.0` release is affected and the advisory currently lists no patched release.
- The npm audit gate walks dependency chains and accepts high/critical package summaries only when every high/critical root advisory is attributable to one of those active, exact exceptions. Unknown, unresolved or additional advisory roots fail the job.
- Trivy still generates and uploads SARIF. The policy gate permits only a matching package name plus CVE/GHSA identifier; all other high/critical findings fail the job. The scanner itself is not disabled and the findings remain visible.
- **`uuid` remains a moderate finding, not an exception and not marked fixed.** The current release gate blocks high/critical findings; the moderate finding remains in the audit report for follow-up.

### Compensating controls and owner actions

- Keep both findings visible in SARIF and workflow artifacts; do not add broad scanner ignores.
- Do not feed attacker-controlled patterns into brace expansion.
- Keep update-signing configuration enabled, use only trusted signing keys, and review whether the vulnerable `node-forge` verification path is reachable in the shipped runtime before production release.
- Recheck upstream advisories and compatible package releases during the exception window. Remove each exception as soon as a tested remediation is available.
- The exception is a temporary risk acceptance, **not proof that either dependency is safe or patched**. The expiry is enforced by the workflow; renewals require a new explicit owner decision and updated evidence.

Re-run the full workflow after every dependency or policy change. A successful policy gate means only that findings are either absent or covered by this narrow, active approval; it does not certify the application as production-ready.
