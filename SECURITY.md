# Security Policy

## Reporting a vulnerability

Please do not disclose passwords, access tokens, vault contents, or exploit details in a public issue. Use GitHub's private vulnerability reporting / Security Advisories for this repository when available. If private reporting is unavailable, contact the repository maintainer privately through a verified channel.

Include the affected component/version, impact, reproduction steps that do not expose real secrets, and any mitigation already applied. Do not test against other people's accounts or production systems without explicit authorization.

## Response

Critical and high-severity issues are prioritized. If a credential is exposed, revoke it at the issuing provider immediately; removing it from a commit is not sufficient. Fixes should include a regression test and a successful security rescan.

## Automated checks

The repository's Security Scan workflow runs dependency audits, CodeQL, Gitleaks, Trivy and pull-request dependency review. Scanner results are signals, not a guarantee that the product is vulnerability-free. Report suspected false positives with evidence rather than disabling a scan globally.
