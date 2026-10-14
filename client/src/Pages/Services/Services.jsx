import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { getLiveDashboard, saveUsageSettings } from "../../api/client";
import { Skeleton, Empty } from "../Render/RenderUi";
import { timeAgo, errorMessage } from "../Render/renderUtils";
import { formatAmount, forecastText, summarize, projectSummary, metricRows, STATUS_LABEL } from "./servicesUtils";
import "../Render/RenderDashboard.css";
import "./Services.css";

const STATE_TEXT = {
  "no-credentials": "Usage keys not found in env",
  "no-reader": "No usage API — check console",
  disabled: "Tracking off",
  error: "Couldn’t read usage"
};

function Status({ status }) {
  const s = status || "unknown";
  return <span className={"sv-status is-" + s}><i aria-hidden="true" />{STATUS_LABEL[s]}</span>;
}

function UsageBar({ m }) {
  if (m.percent == null) return <span className="sv-dim">—</span>;
  return (
    <div className={"sv-usage is-" + m.status}>
      <div className="sv-bar" role="progressbar" aria-valuenow={Math.round(m.percent)} aria-valuemin={0} aria-valuemax={100} aria-label={m.label}><i style={{ width: Math.min(100, m.percent) + "%" }} /></div>
      <b>{Math.round(m.percent)}%</b>
    </div>
  );
}

function shortForecast(m) {
  if (m.method === "reached") return "Limit reached";
  if (m.willLast === true) return m.resetsInDays != null ? "Lasts until reset · " + Math.round(m.resetsInDays) + " d" : "Not running out";
  if (m.daysLeft != null) return m.daysLeft < 1 ? "~" + Math.round(m.daysLeft * 24) + " h left" : "~" + Math.round(m.daysLeft) + " days left";
  return m.method == null && m.status !== "unknown" ? "Collecting data" : "—";
}

/* ---------------------------------------------------------------- Overview */

function Overview({ data, onOpen }) {
  const summary = summarize(data);
  const rows = data.projects.map((p) => ({ p, s: projectSummary(p) }));
  return (
    <div className="sv-stack">
      <div className="sv-stats">
        <div><span>Live projects</span><b>{data.liveCount}</b><small>of {data.totalCount} Render services</small></div>
        <div><span>Services tracked</span><b>{summary.tracked}</b><small>with live usage data</small></div>
        <div className={summary.critical ? "is-critical" : summary.warn ? "is-warn" : ""}><span>Needs attention</span><b>{summary.warn + summary.critical}</b><small>{summary.critical ? summary.critical + " almost out" : summary.warn ? summary.warn + " getting low" : "All within limits"}</small></div>
        <div><span>Soonest to run out</span><b>{summary.soonest ? new Date(summary.soonest.at).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—"}</b><small>{summary.soonest ? summary.soonest.project + " · " + summary.soonest.label : "Nothing projected"}</small></div>
      </div>

      <section className="sv-panel">
        <header className="sv-panel__head"><h2>Projects</h2><span className="sv-dim">Click a project for its full breakdown</span></header>
        <div className="sv-tablewrap">
          <table className="sv-table sv-table--click">
            <thead><tr><th>Project</th><th>Account</th><th>Services</th><th>Highest usage</th><th>Outlook</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map(({ p, s }) => (
                <tr key={p.id} tabIndex={0} onClick={() => onOpen(p.id)} onKeyDown={(e) => { if (e.key === "Enter") onOpen(p.id); }}>
                  <td><strong>{p.name}</strong><small className="sv-sub">{p.url ? p.url.replace(/^https?:\/\//, "") : p.type}</small></td>
                  <td>{p.accountName}</td>
                  <td>{s.services}</td>
                  <td>{s.worst ? <><UsageBar m={s.worst} /><small className="sv-sub">{s.worst.service} · {s.worst.label}</small></> : <span className="sv-dim">No limit data</span>}</td>
                  <td>{s.worst ? shortForecast(s.worst) : "—"}</td>
                  <td><Status status={s.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}

/* ---------------------------------------------------------------- Project detail */

function ProjectDetail({ project, onToggle }) {
  const s = projectSummary(project);
  const withData = project.services.filter((svc) => svc.state === "ok" && metricRows(svc).length);
  const without = project.services.filter((svc) => !withData.includes(svc));
  const [openVars, setOpenVars] = useState(false);
  const soonest = withData.flatMap(metricRows).filter((m) => m.exhaustsAt).sort((a, b) => Date.parse(a.exhaustsAt) - Date.parse(b.exhaustsAt))[0];

  return (
    <div className="sv-stack">
      <header className="sv-detailhead">
        <div>
          <div className="sv-titleline"><h2>{project.name}</h2><Status status={s.status} /></div>
          <p className="sv-dim">{[project.accountName, project.plan && project.plan + " plan", project.repo && project.repo.replace(/^https:\/\/github\.com\//, "")].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="sv-actions">
          {project.url && <a className="rd-btn rd-btn--quiet" href={project.url} target="_blank" rel="noopener noreferrer">Open app ↗</a>}
          {project.dashboardUrl && <a className="rd-btn rd-btn--quiet" href={project.dashboardUrl} target="_blank" rel="noopener noreferrer">Render ↗</a>}
          {project.repo && <a className="rd-btn rd-btn--quiet" href={project.repo} target="_blank" rel="noopener noreferrer">GitHub ↗</a>}
        </div>
      </header>

      {project.envReadFailed && <div className="rd-alert rd-alert--error" role="alert"><span aria-hidden="true">!</span><div>Couldn’t read this service’s environment variables from Render.</div></div>}

      <div className="sv-stats">
        <div><span>Services used</span><b>{s.services}</b><small>detected from env vars</small></div>
        <div><span>Live usage data</span><b>{withData.length}</b><small>{s.metrics} metric(s)</small></div>
        <div className={s.worst ? "is-" + s.worst.status : ""}><span>Highest usage</span><b>{s.worst ? Math.round(s.worst.percent) + "%" : "—"}</b><small>{s.worst ? s.worst.service + " · " + s.worst.label : "No limit data"}</small></div>
        <div><span>Runs out first</span><b>{soonest ? new Date(soonest.exhaustsAt).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—"}</b><small>{soonest ? soonest.label : "Nothing projected"}</small></div>
      </div>

      <section className="sv-panel">
        <header className="sv-panel__head"><h2>Usage &amp; limits</h2><span className="sv-dim">Read live from each provider</span></header>
        {withData.length === 0 ? <p className="sv-empty">No provider usage could be read for this project yet.</p> : (
          <div className="sv-tablewrap">
            <table className="sv-table">
              <thead><tr><th>Metric</th><th>Usage</th><th>Used</th><th>Limit</th><th>Left</th><th>Outlook</th><th>Status</th></tr></thead>
              {withData.map((svc) => (
                <tbody key={svc.key}>
                  <tr className="sv-group">
                    <th colSpan={7}>
                      <div className="sv-groupline">
                        <span><strong>{svc.label}</strong><em>{svc.category}</em>{svc.reports[0]?.plan && <small>{svc.reports[0].plan}</small>}</span>
                        <span className="sv-actions">
                          {svc.console && <a href={svc.console} target="_blank" rel="noopener noreferrer">Console ↗</a>}
                          <label className="rd-check"><input type="checkbox" checked onChange={() => onToggle(project.id + "|" + svc.key, true)} /> Track</label>
                        </span>
                      </div>
                    </th>
                  </tr>
                  {metricRows(svc).map((m) => (
                    <tr key={m.report + m.key} title={forecastText(m)}>
                      <td>{m.label}{m.multi && <small className="sv-sub">{m.report}</small>}</td>
                      <td>{m.kind === "balance" ? <span className="sv-dim">balance</span> : <UsageBar m={m} />}</td>
                      <td className="sv-num">{m.kind === "balance" ? "—" : formatAmount(m.used, m.unit)}</td>
                      <td className="sv-num">{m.limit != null ? formatAmount(m.limit, m.unit) + (m.limitAssumed ? "*" : "") : "—"}</td>
                      <td className="sv-num">{formatAmount(m.remaining, m.unit)}</td>
                      <td>{shortForecast(m)}{m.projectedAtReset != null && m.limit != null && <small className="sv-sub">≈ {formatAmount(m.projectedAtReset, m.unit)} at reset</small>}</td>
                      <td><Status status={m.status} /></td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
        {withData.some((svc) => metricRows(svc).some((m) => m.limitAssumed)) && <p className="rd-note">* Limit from your settings, not reported by the provider.</p>}
      </section>

      {without.length > 0 && (
        <section className="sv-panel">
          <header className="sv-panel__head"><h2>Other connected services</h2><span className="sv-dim">Used by this project, no usage figures available</span></header>
          <div className="sv-tablewrap">
            <table className="sv-table">
              <thead><tr><th>Service</th><th>Category</th><th>Limits set in env</th><th>Usage</th><th /></tr></thead>
              <tbody>{without.map((svc) => (
                <tr key={svc.key}>
                  <td><strong>{svc.label}</strong></td>
                  <td>{svc.category}</td>
                  <td>{svc.configuredLimits.length ? svc.configuredLimits.map((l) => <code key={l.name} className="sv-tag">{l.name} = {l.value}{l.period ? " / " + l.period : ""}</code>) : <span className="sv-dim">—</span>}</td>
                  <td><span className="sv-dim" title={svc.error?.message || ""}>{STATE_TEXT[svc.state] || "—"}</span></td>
                  <td className="sv-right">
                    {svc.console && <a href={svc.console} target="_blank" rel="noopener noreferrer">Console ↗</a>}
                    {svc.hasCredentials && <label className="rd-check"><input type="checkbox" checked={svc.state !== "disabled"} onChange={() => onToggle(project.id + "|" + svc.key, svc.state !== "disabled")} /> Track</label>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}

      <section className="sv-panel">
        <header className="sv-panel__head">
          <h2>Environment variables</h2>
          <button type="button" className="rd-btn rd-btn--quiet" aria-expanded={openVars} onClick={() => setOpenVars((v) => !v)}>{openVars ? "Hide" : "Show"} ({project.services.reduce((n, svc) => n + svc.vars.length, 0)})</button>
        </header>
        {openVars && (
          <div className="sv-tablewrap">
            <table className="sv-table sv-table--compact">
              <thead><tr><th>Service</th><th>Variable</th><th>Value</th></tr></thead>
              <tbody>{project.services.flatMap((svc) => svc.vars.map((v, i) => (
                <tr key={svc.key + v.name}><td>{i === 0 ? <strong>{svc.label}</strong> : ""}</td><td><code>{v.name}</code></td>
                  <td className={v.display == null ? "sv-dim" : "sv-mono"}>{!v.set ? "empty" : v.display != null ? v.display : "•••••• hidden"}</td></tr>
              )))}</tbody>
            </table>
          </div>
        )}
        {openVars && <p className="rd-note">Secrets are never sent to the browser. URLs are shown without credentials or query strings.</p>}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- Page */

export default function Services() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mongoMb, setMongoMb] = useState("512");
  const [selected, setSelected] = useState("overview");
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setLoading(true); setError("");
    try {
      const result = await getLiveDashboard({ refresh });
      setData(result);
      if (result?.settings?.mongoLimitMb) setMongoMb(String(result.settings.mongoLimitMb));
    } catch (e) { setError(errorMessage(e, "Could not load the services dashboard.")); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async (patch, message) => {
    try {
      await saveUsageSettings(patch);
      if (message) toast.success(message);
      await load(true);
    } catch (e) { toast.error(errorMessage(e, "Could not save settings.")); }
  };
  const toggle = (key, currentlyOn) => {
    const disabled = { ...(data?.settings?.disabled || {}) };
    if (currentlyOn) disabled[key] = true; else delete disabled[key];
    void save({ disabled });
  };

  const projects = useMemo(() => (data?.projects || []).map((p) => ({ p, s: projectSummary(p) })), [data]);
  const current = projects.find(({ p }) => p.id === selected)?.p;
  useEffect(() => { if (selected !== "overview" && data && !current) setSelected("overview"); }, [selected, data, current]);

  return (
    <main className="rd-page">
      <header className="rd-topbar">
        <div className="rd-shell rd-topbar__inner">
          <div className="rd-topbar__title"><div className="rd-eyebrow"><span />INFRASTRUCTURE</div><h1>Services &amp; Usage</h1></div>
          <div className="rd-topbar__tools">
            <span className="rd-sync" role="status" aria-live="polite">{loading ? "Loading…" : data?.generatedAt ? "Updated " + timeAgo(data.generatedAt) : ""}</span>
            {data?.enabled && <button type="button" className="rd-btn rd-btn--quiet" aria-expanded={showSettings} onClick={() => setShowSettings((v) => !v)}>⚙ Settings</button>}
            <button type="button" className="rd-btn rd-btn--primary" disabled={loading} onClick={() => void load(true)}>{loading ? "Refreshing…" : "↻ Refresh"}</button>
          </div>
        </div>
      </header>

      <div className="rd-shell sv-body">
        {error && <div className="rd-alert rd-alert--error" role="alert"><span aria-hidden="true">!</span><div>{error}</div><button type="button" onClick={() => void load()}>Retry</button></div>}
        {loading && !data && <Skeleton lines={6} height={56} />}

        {data && !data.enabled && (
          <section className="sv-panel sv-consent">
            <h2>Turn on usage tracking</h2>
            <p>Stashr reads each running Render service’s environment variables, detects the databases and APIs it uses, and asks those providers (MongoDB, Cloudinary, Brevo, Twilio, Deepgram) for current usage. Everything is read-only, and keys stay on the server.</p>
            <label className="sv-field">MongoDB storage limit (MB)<input className="rd-field" type="number" min="1" value={mongoMb} onChange={(e) => setMongoMb(e.target.value)} /><small className="sv-dim">Atlas free (M0) clusters have 512 MB.</small></label>
            <button type="button" className="rd-btn rd-btn--primary" onClick={() => void save({ enabled: true, mongoLimitMb: Number(mongoMb) || 512 }, "Usage tracking enabled.")}>Enable usage tracking</button>
          </section>
        )}

        {data?.enabled && showSettings && (
          <section className="sv-panel sv-settings">
            <label className="sv-field">MongoDB storage limit (MB)<input className="rd-field" type="number" min="1" value={mongoMb} onChange={(e) => setMongoMb(e.target.value)} /></label>
            <div className="sv-actions">
              <button type="button" className="rd-btn rd-btn--primary" onClick={() => void save({ mongoLimitMb: Number(mongoMb) || 512 }, "Saved.")}>Save</button>
              <button type="button" className="rd-btn rd-btn--danger-quiet" onClick={() => void save({ enabled: false }, "Usage tracking turned off.")}>Turn off tracking</button>
            </div>
            <p className="rd-note">{data.historyPoints || 0} hourly snapshot(s) stored. Storage and balance forecasts need about a day of history.</p>
          </section>
        )}

        {data?.enabled && (
          data.projects.length === 0 ? <Empty icon="▣" title="No live projects">Connect a Render account and deploy a project; it appears here automatically.</Empty> : (
            <div className="sv-layout">
              <nav className="sv-side" aria-label="Projects">
                <select className="rd-field sv-side__select" aria-label="Select project" value={selected} onChange={(e) => setSelected(e.target.value)}>
                  <option value="overview">All projects</option>
                  {projects.map(({ p }) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <ul className="sv-side__list">
                  <li><button type="button" className={selected === "overview" ? "is-active" : ""} onClick={() => setSelected("overview")}><span className="sv-side__name">All projects</span><small>{data.liveCount} live</small></button></li>
                  {projects.map(({ p, s }) => (
                    <li key={p.id}>
                      <button type="button" className={selected === p.id ? "is-active" : ""} aria-current={selected === p.id ? "page" : undefined} onClick={() => setSelected(p.id)}>
                        <span className="sv-side__name"><i className={"sv-dot is-" + s.status} aria-hidden="true" />{p.name}</span>
                        <small>{s.services} service{s.services === 1 ? "" : "s"}{s.worst ? " · " + Math.round(s.worst.percent) + "% max" : ""}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
              <div className="sv-main">
                {current ? <ProjectDetail key={current.id} project={current} onToggle={toggle} /> : <Overview data={data} onOpen={setSelected} />}
              </div>
            </div>
          )
        )}
      </div>
    </main>
  );
}
