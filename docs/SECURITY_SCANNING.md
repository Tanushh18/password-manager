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


## Known dependency-audit blockers from the upgrade branch

The mobile audit has reported high-severity advisories in `braces` and `node-forge`, plus a moderate `uuid` advisory in the Xcode/Expo toolchain. The current public package versions do not provide a straightforward compatible upgrade path for all of these: the `braces` advisory currently has no patched npm release, and the `node-forge` advisory affects the published version currently resolved by Expo. Forcing npm's suggested Expo downgrade is not acceptable because it would introduce a major SDK regression. Do not mark these findings fixed, suppress them broadly, or merge as security-clean.

Compatible overrides were added for `shell-quote@1.11.0`, `source-map-js@1.2.2`, and `decode-uri-component@0.5.0`; these remove the corresponding known vulnerable versions from the mobile lockfile. The remaining findings must stay release-blocking until a compatible upstream fix is available, a tested vendor patch is reviewed, or the repository owner explicitly approves a narrow, time-bounded exception with compensating controls. Re-run `npm audit` and Trivy after every lockfile change and attach the exact report.
