import React, { useCallback, useEffect, useState } from "react";
import "./Security.css";

import MascotBanner from "../../Components/Robot/MascotBanner";
import { securityMood } from "../../lib/pageMoods";
const repoUrl = "https://github.com/Tanushh18/password-manager";
const workflowUrl = repoUrl + "/actions/workflows/security-scan.yml";
const securityUrl = repoUrl + "/security";
const runsApi = "https://api.github.com/repos/Tanushh18/password-manager/actions/workflows/security-scan.yml/runs?per_page=6";
const checks = [
  { title: "Dependency vulnerabilities", detail: "Full npm audit for server, web and Android dependencies, including development dependencies." },
  { title: "Static code analysis", detail: "CodeQL extended queries for JavaScript and TypeScript." },
  { title: "Secret leakage", detail: "Gitleaks checks repository history and current files for exposed credentials." },
  { title: "Configuration and filesystem", detail: "Trivy checks dependency/OS vulnerabilities, secrets and configuration misconfigurations." },
  { title: "Staging DAST", detail: "Optional OWASP ZAP passive baseline scan runs only when STAGING_BASE_URL points to an explicitly authorized HTTPS staging target." },
  { title: "Pull request dependency review", detail: "Optional GitHub Dependency Review blocks newly introduced high-severity vulnerable dependencies when enabled." },
];

const dateTime = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
};
const statusLabel = (run) => {
  if (run.status && run.status !== "completed") return run.status === "queued" ? "Queued" : "Running";
  if (run.conclusion === "success") return "Passed";
  if (run.conclusion === "failure") return "Failed";
  if (run.conclusion === "cancelled") return "Cancelled";
  if (run.conclusion === "skipped") return "Skipped";
  return "Incomplete";
};
const statusClass = (run) => {
  if (run.status !== "completed") return "running";
  if (run.conclusion === "success") return "success";
  if (run.conclusion === "failure") return "failed";
  return "partial";
};

export default function Security() {
  const [scanState, setScanState] = useState({ loading: true, error: "", runs: [], jobs: [], updatedAt: null });
  const loadScans = useCallback(async () => {
    setScanState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const response = await fetch(runsApi, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
      if (!response.ok) {
        if (response.status === 403) throw new Error("GitHub API rate limit reached. Open the workflow directly to inspect the latest run.");
        throw new Error("GitHub returned HTTP " + response.status + ". Open the workflow for full details.");
      }
      const data = await response.json();
      const runs = Array.isArray(data.workflow_runs) ? data.workflow_runs.slice(0, 6) : [];
      let jobs = [];
      if (runs[0]?.id) {
        const jobResponse = await fetch("https://api.github.com/repos/Tanushh18/password-manager/actions/runs/" + runs[0].id + "/jobs?per_page=20", {
          headers: { Accept: "application/vnd.github+json" }, cache: "no-store"
        });
        if (jobResponse.ok) {
          const jobData = await jobResponse.json();
          jobs = (Array.isArray(jobData.jobs) ? jobData.jobs : []).map((job) => ({
            id: job.id, name: job.name, status: job.status, conclusion: job.conclusion,
            html_url: job.html_url, failedSteps: (job.steps || []).filter((step) => step.conclusion === "failure").map((step) => step.name)
          }));
        }
      }
      setScanState({ loading: false, error: "", runs, jobs, updatedAt: new Date().toISOString() });
    } catch (error) {
      setScanState((current) => ({ ...current, loading: false, error: error?.message || "Could not load GitHub scan status." }));
    }
  }, []);

  useEffect(() => { void loadScans(); }, [loadScans]);

  const latest = scanState.runs[0];
  const summary = !latest ? "No run found" : statusLabel(latest);
  const passedJobs = scanState.jobs.filter((job) => job.conclusion === "success").length;
  const failedJobs = scanState.jobs.filter((job) => job.conclusion === "failure").length;
  const activeJobs = scanState.jobs.filter((job) => job.status !== "completed").length;

  return (
    <main className="security-page container">
      <MascotBanner kind="shield" {...securityMood({ loading: scanState.loading, hasRun: Boolean(latest), failed: failedJobs, passed: passedJobs, active: activeJobs })} />
      <header className="security-hero">
        <span className="security-kicker">STASHR · SECURITY CENTER</span>
        <h1>Repository security</h1>
        <p>Run repeatable vulnerability checks, inspect the actual GitHub Actions result, fix findings and verify remediation with a fresh scan.</p>
        <div className="security-actions">
          <a className="btn btn--primary" href={workflowUrl} target="_blank" rel="noopener noreferrer">Open scan workflow ↗</a>
          <a className="btn btn--ghost" href={securityUrl} target="_blank" rel="noopener noreferrer">View GitHub Security ↗</a>
          <button type="button" className="btn btn--ghost" onClick={() => void loadScans()} disabled={scanState.loading}>{scanState.loading ? "Refreshing…" : "↻ Refresh status"}</button>
        </div>
        <p className="security-note">A completed successful run means the configured jobs passed; it does not prove that no vulnerabilities exist. Missing results and scanner failures are shown as incomplete, never as clean.</p>
      </header>

      <section className="security-section security-live">
        <div className="security-section__heading">
          <div><span className="security-kicker">LIVE FROM GITHUB ACTIONS</span><h2>Latest scan status</h2></div>
          {scanState.updatedAt && <span className="security-count">Updated {dateTime(scanState.updatedAt)}</span>}
        </div>
        {scanState.error && <div className="security-error" role="alert">{scanState.error}</div>}
        <div className="security-live-card">
          <div className="security-live-card__main">
            <span className={"security-live-status security-live-status--" + (latest ? statusClass(latest) : "partial")}>{scanState.loading && !latest ? "Loading…" : summary}</span>
            <h3>{latest?.display_title || latest?.name || "No security scan run found"}</h3>
            <p>{latest ? dateTime(latest.created_at) + " · " + (latest.event || "unknown event") + " · " + (latest.head_branch || "unknown branch") + " · " + String(latest.head_sha || "").slice(0, 7) : "Run the workflow manually to create the first scan."}</p>
            {latest?.html_url && <a href={latest.html_url} target="_blank" rel="noopener noreferrer">Open exact workflow run ↗</a>}
          </div>
          <div className="security-live-card__stats">
            <div><b>{passedJobs}</b><span>Jobs passed</span></div>
            <div><b>{failedJobs}</b><span>Jobs failed</span></div>
            <div><b>{activeJobs}</b><span>Jobs running</span></div>
          </div>
        </div>
        {scanState.jobs.length > 0 && (
          <div className="security-jobs">
            {scanState.jobs.map((job) => (
              <a className="security-job" href={job.html_url || latest?.html_url || workflowUrl} target="_blank" rel="noopener noreferrer" key={job.id}>
                <span className={"security-job__dot security-job__dot--" + statusClass(job)} />
                <span className="security-job__body"><strong>{job.name}</strong>{job.failedSteps.length > 0 && <small>Failed step: {job.failedSteps.join(", ")}</small>}</span>
                <span className="security-job__status">{job.status === "completed" ? (job.conclusion || "incomplete") : job.status}</span>
                <span aria-hidden="true">↗</span>
              </a>
            ))}
          </div>
        )}
        {scanState.runs.length > 0 && (
          <div className="security-runs">
            <h3>Recent runs</h3>
            {scanState.runs.map((run) => (
              <a className="security-run" href={run.html_url} target="_blank" rel="noopener noreferrer" key={run.id}>
                <span className={"security-live-status security-live-status--" + statusClass(run)}>{statusLabel(run)}</span>
                <span className="security-run__detail"><strong>{run.head_branch || "unknown branch"}</strong><small>{dateTime(run.created_at)} · {run.event || "event unknown"}</small></span>
                <span>{String(run.head_sha || "").slice(0, 7)}</span>
                <span aria-hidden="true">↗</span>
              </a>
            ))}
          </div>
        )}
      </section>

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
              <span className="security-check__status">Configured</span>
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
