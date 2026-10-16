import React from "react";
import "./Security.css";

const workflowUrl = "https://github.com/Tanushh18/password-manager/actions/workflows/security-scan.yml";
const securityUrl = "https://github.com/Tanushh18/password-manager/security";

const checks = [
  { title: "Dependency vulnerabilities", detail: "Full npm audit for server, web and Android dependencies, including development dependencies." },
  { title: "Static code analysis", detail: "CodeQL extended queries for JavaScript and TypeScript." },
  { title: "Secret leakage", detail: "Gitleaks checks repository history and current files for exposed credentials." },
  { title: "Configuration and filesystem", detail: "Trivy checks dependency/OS vulnerabilities, secrets and configuration misconfigurations." },
  { title: "Pull request dependency review", detail: "Blocks newly introduced high-severity vulnerable dependencies on pull requests." },
];

export default function Security() {
  return (
    <main className="security-page container">
      <header className="security-hero">
        <span className="security-kicker">STASHR · SECURITY CENTER</span>
        <h1>Repository security</h1>
        <p>Scan the codebase, dependencies, configuration and repository history. Review evidence, fix the root cause, then rescan to verify the fix.</p>
        <div className="security-actions">
          <a className="btn btn--primary" href={workflowUrl} target="_blank" rel="noopener noreferrer">Open scan workflow ↗</a>
          <a className="btn btn--ghost" href={securityUrl} target="_blank" rel="noopener noreferrer">View GitHub Security ↗</a>
        </div>
        <p className="security-note">To start a scan: open the workflow, choose <strong>Run workflow</strong>, keep the full scan enabled, and review every job. The scan also runs on pushes, pull requests and weekly. This page does not claim a scan is clean unless GitHub reports the results.</p>
      </header>

      <section className="security-section">
        <div className="security-section__heading">
          <div><span className="security-kicker">COVERAGE</span><h2>What gets checked</h2></div>
          <span className="security-count">{checks.length} scan layers</span>
        </div>
        <div className="security-checks">
          {checks.map((check, i) => (
            <article className="security-check card" key={check.title}>
              <span className="security-check__number">{String(i + 1).padStart(2, "0")}</span>
              <div><h3>{check.title}</h3><p>{check.detail}</p></div>
              <span className="security-check__status">Automated</span>
            </article>
          ))}
        </div>
      </section>

      <section className="security-section security-severity">
        <span className="security-kicker">RESPONSE POLICY</span>
        <h2>How findings are handled</h2>
        <ul>
          <li><strong>Critical / High:</strong> release-blocking by default. Triage immediately and fix or use a time-limited, owner-approved exception.</li>
          <li><strong>Medium:</strong> assign an owner and due date based on exposure and exploitability.</li>
          <li><strong>Low / Informational:</strong> track and batch where appropriate.</li>
          <li><strong>Leaked credential:</strong> revoke or rotate it at the issuer immediately. Removing it from the current file alone is not remediation.</li>
          <li><strong>Scanner failure:</strong> mark the scan incomplete; never interpret missing results as clean.</li>
        </ul>
      </section>

      <section className="security-section security-warning">
        <h2>Important limitations</h2>
        <p>Automated scanners cannot prove the absence of vulnerabilities or fully verify business-logic authorization, live provider settings, runtime exposure, backup restoration or incident recovery. Review scanner findings and run the documented manual checks in <code>docs/SECURITY_SCANNING.md</code>.</p>
      </section>
    </main>
  );
}
