import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { getLiveDashboard, saveUsageSettings } from "../../api/client";
import { Skeleton, Empty } from "../Render/RenderUi";
import { timeAgo, errorMessage } from "../Render/renderUtils";
import { usePolling } from "../Render/renderHooks";
import { Link } from "react-router-dom";
import { useVault } from "../../state/vault";
import { serviceProjectIndex } from "../../lib/serviceProjects";
import { formatAmount, forecastText, summarize, projectSummary, metricRows, accountRows, STATUS_LABEL } from "./servicesUtils";
import Robot from "../../Components/Robot/Robot";
import HoursBudgetCard from "./HoursBudgetCard";
import EnvScanCard from "./EnvScanCard";
import { usageMood } from "../../lib/robots";
import "../Render/RenderDashboard.css";
import "../Render/RobotArmy.css";
import "./Services.css";

/* Plan limits you tell Stashr about: most providers do not report the limit of your plan. */
const LIMIT_FIELDS = [
  ["mongodb", "MongoDB storage (MB)", "Atlas free (M0) clusters have 512 MB."],
  ["postgres", "PostgreSQL storage (MB)", "Neon free ≈ 512 MB, Supabase free ≈ 500 MB. Leave empty if unknown."],
  ["mysql", "MySQL storage (MB)", "Leave empty if unknown."],
  ["redis", "Redis memory (MB)", "Upstash free = 256 MB. Used only if the server reports no limit."],
  ["turso", "Turso storage (MB)", "Leave empty if unknown."],
  ["elasticsearch", "Elasticsearch storage (MB)", "Leave empty if unknown."],
  ["aws", "S3 / R2 storage (MB)", "R2 free = 10 GB (10240 MB). Leave empty if unknown."]
];
const limitsFrom = (settings) => Object.fromEntries(LIMIT_FIELDS.map(([key]) => [key, String(key === "mongodb" ? (settings?.limitsMb?.mongodb ?? settings?.mongoLimitMb ?? 512) : (settings?.limitsMb?.[key] ?? ""))]));
const limitsPatch = (limits) => ({ limitsMb: Object.fromEntries(LIMIT_FIELDS.map(([key]) => [key, limits[key] === "" || limits[key] == null ? "" : Number(limits[key]) || ""])) });

const STATE_TEXT = {
  "no-credentials": "Keys needed to read usage aren’t set on this service",
  "in-code": "Used in the code, but no credentials are set",
  "no-reader": "No usage API",
  disabled: "Tracking off",
  error: "Couldn’t read usage"
};

const FOUND_BY = { name: "variable name", value: "variable value", code: "app code" };
/** How a service was recognised: its variable names, what the values look like, or what the app's code does. */
const foundBy = (svc) => {
  const how = (svc.detectedBy || []).map((k) => FOUND_BY[k]).filter(Boolean);
  if (!how.length) return "";
  return "Found by " + how.join(" + ") + (svc.packages?.length ? " (" + svc.packages.slice(0, 3).join(", ") + ")" : "");
};

const detailText = (m) => m.label.replace(/ this month$/i, "") + " " + formatAmount(m.used, m.unit);

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

/** The Stashr project a dashboard entry (one app, maybe several servers) belongs to. */
const projectFor = (index, entry) => [entry.id, ...(entry.deployments || []).map((d) => d.id)].map((id) => index.get(id)).find(Boolean) || null;

/* ---------------------------------------------------------------- Service bots */

/** One robot per app: its mood follows the provider limit it is closest to running out of. */
function ServiceBots({ rows, onOpen }) {
  if (!rows.length) return null;
  const bots = rows.map(({ p, s }) => ({
    p, s, stats: usageMood({ name: p.name, percent: s.worst?.percent ?? null, status: s.status, errors: s.issues, tracked: (p.services || []).filter((x) => x.state === "ok").length })
  }));
  const order = { fire: 0, dead: 1, sweaty: 2, chill: 3, confused: 4 };
  bots.sort((a, b) => (order[a.stats.mood] ?? 9) - (order[b.stats.mood] ?? 9) || a.p.name.localeCompare(b.p.name));
  return (
    <div className="ra">
      <div className="ra-grid">
        {bots.map(({ p, s, stats }) => (
          <article key={p.id} className={"ra-card is-" + stats.tone}>
            <div className="ra-card__bot"><Robot mood={stats.mood} load={stats.load} size={70} /></div>
            <div className="ra-card__body">
              <button type="button" className="ra-card__name" onClick={() => onOpen(p.id)}>{p.name}</button>
              <span className="ra-card__mood">{stats.face} {stats.title} · {s.services} service{s.services === 1 ? "" : "s"}</span>
              <p className="ra-card__line">{stats.line}</p>
              <div className="ra-bar" title={s.worst ? s.worst.service + " · " + s.worst.label : "No limit data"}>
                <span>Limit</span>
                <div className={"ra-bar__track is-" + (s.worst == null ? "idle" : s.worst.percent >= 90 ? "hot" : s.worst.percent >= 70 ? "warm" : "ok")}><i style={{ transform: "scaleX(" + Math.min(100, s.worst?.percent ?? 0) / 100 + ")" }} /></div>
                <b>{s.worst ? Math.round(s.worst.percent) + "%" : "—"}</b>
              </div>
              <div className="ra-card__meta"><span>{s.worst ? s.worst.service + " · " + s.worst.label : "Koi limit data nahi"}</span><span>{shortForecast(s.worst || {})}</span></div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Overview */

function Overview({ data, onOpen, projectOf }) {
  const summary = summarize(data);
  const rows = data.projects.map((p) => ({ p, s: projectSummary(p) }));
  return (
    <div className="sv-stack">
      <HoursBudgetCard />
      <EnvScanCard />
      <div className="sv-stats">
        <div><span>Live projects</span><b>{data.projectCount ?? data.projects.length}</b><small>{data.liveCount} of {data.totalCount} Render services live · syncs every minute</small></div>
        <div><span>Services tracked</span><b>{summary.tracked}</b><small>with live usage data</small></div>
        <div className={summary.critical ? "is-critical" : summary.warn ? "is-warn" : ""}><span>Needs attention</span><b>{summary.warn + summary.critical}</b><small>{summary.critical ? summary.critical + " almost out" : summary.warn ? summary.warn + " getting low" : "All within limits"}</small></div>
        <div><span>Soonest to run out</span><b>{summary.soonest ? new Date(summary.soonest.at).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—"}</b><small>{summary.soonest ? summary.soonest.project + " · " + summary.soonest.label : "Nothing projected"}</small></div>
      </div>

      <ServiceBots rows={rows} onOpen={onOpen} />

      <section className="sv-panel">
        <header className="sv-panel__head"><h2>Projects</h2><span className="sv-dim">Click a project for its full breakdown</span></header>
        <div className="sv-tablewrap">
          <table className="sv-table sv-table--click">
            <thead><tr><th>App</th><th>Stashr project</th><th>Account</th><th>Services</th><th>Highest usage</th><th>Outlook</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map(({ p, s }) => (
                <tr key={p.id} tabIndex={0} onClick={() => onOpen(p.id)} onKeyDown={(e) => { if (e.key === "Enter") onOpen(p.id); }}>
                  <td><strong>{p.name}</strong><small className="sv-sub">{(p.deployments || []).length > 1 ? p.deployments.length + " deployments" : p.url ? p.url.replace(/^https?:\/\//, "") : p.type}</small></td>
                  <td onClick={(e) => e.stopPropagation()}>{(() => { const hit = projectFor(projectOf, p); return hit ? <Link to={"/projects/" + hit.id}>{hit.name}</Link> : <span className="sv-dim">—</span>; })()}</td>
                  <td>{(p.deployments || []).length > 1 ? [...new Set(p.deployments.map((d) => d.accountName))].join(", ") : p.accountName}</td>
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

const varGroups = (project) => [
  ...project.services.map((svc) => ({ label: svc.label, vars: svc.vars })),
  { label: "Other / unrecognised", vars: project.otherVars || [] },
  { label: "App config", vars: project.internalVars || [] }
].filter((g) => g.vars.length);

function ProjectDetail({ project, onToggle, projectOf }) {
  const s = projectSummary(project);
  const withData = project.services.filter((svc) => svc.state === "ok" && metricRows(svc).length);
  const without = project.services.filter((svc) => !withData.includes(svc));
  const [openVars, setOpenVars] = useState(false);
  const soonest = withData.flatMap(metricRows).filter((m) => m.exhaustsAt).sort((a, b) => Date.parse(a.exhaustsAt) - Date.parse(b.exhaustsAt))[0];

  return (
    <div className="sv-stack">
      <header className="sv-detailhead">
        {(() => {
          const bot = usageMood({ name: project.name, percent: s.worst?.percent ?? null, status: s.status, errors: s.issues, tracked: withData.length });
          return <div className={"sv-detailbot is-" + bot.tone} title={bot.line}><Robot mood={bot.mood} load={bot.load} size={64} /><span>{bot.line}</span></div>;
        })()}
        <div>
          <div className="sv-titleline"><h2>{project.name}</h2><Status status={s.status} /></div>
          <p className="sv-dim">{[project.accountName, project.plan && project.plan + " plan", project.repo && project.repo.replace(/^https:\/\/github\.com\//, "")].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="sv-actions">
          {project.url && <a className="rd-btn rd-btn--quiet" href={project.url} target="_blank" rel="noopener noreferrer">Open app ↗</a>}
          {project.dashboardUrl && <a className="rd-btn rd-btn--quiet" href={project.dashboardUrl} target="_blank" rel="noopener noreferrer">Render ↗</a>}
          {project.repo && <a className="rd-btn rd-btn--quiet" href={project.repo} target="_blank" rel="noopener noreferrer">GitHub ↗</a>}
          {(() => { const hit = projectFor(projectOf, project); return hit ? <Link className="rd-btn rd-btn--quiet" to={"/projects/" + hit.id}>Stashr project: {hit.name}</Link> : null; })()}
        </div>
      </header>

      {(project.deployments || []).length > 1 && (
        <section className="sv-panel">
          <header className="sv-panel__head"><h2>Deployments</h2><span className="sv-dim">Render services built from this repository</span></header>
          <div className="sv-tablewrap">
            <table className="sv-table sv-table--compact">
              <thead><tr><th>Service</th><th>Account</th><th>Plan</th><th>URL</th><th /></tr></thead>
              <tbody>{project.deployments.map((d) => (
                <tr key={d.id}>
                  <td><strong>{d.name}</strong></td>
                  <td>{d.accountName}</td>
                  <td>{d.plan}</td>
                  <td>{d.url ? <a href={d.url} target="_blank" rel="noopener noreferrer">{d.url.replace(/^https?:\/\//, "")} ↗</a> : <span className="sv-dim">—</span>}</td>
                  <td className="sv-right">{d.dashboardUrl && <a href={d.dashboardUrl} target="_blank" rel="noopener noreferrer">Render ↗</a>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}

      {project.envReadFailed && <div className="rd-alert rd-alert--error" role="alert"><span aria-hidden="true">!</span><div>Couldn’t read this service’s environment variables from Render.</div></div>}

      <div className="sv-stats">
        <div><span>Services used</span><b>{s.services}</b><small>found by variable names, values and code</small></div>
        <div><span>Live usage data</span><b>{withData.length}</b><small>{s.metrics} metric(s)</small></div>
        <div className={s.worst ? "is-" + s.worst.status : ""}><span>Highest usage</span><b>{s.worst ? Math.round(s.worst.percent) + "%" : "—"}</b><small>{s.worst ? s.worst.service + " · " + s.worst.label : "No limit data"}</small></div>
        <div><span>Runs out first</span><b>{soonest ? new Date(soonest.exhaustsAt).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—"}</b><small>{soonest ? soonest.label : "Nothing projected"}</small></div>
      </div>

      <section className="sv-panel">
        <header className="sv-panel__head"><h2>Usage &amp; limits</h2><span className="sv-dim">Read live from each provider</span></header>
        {withData.length === 0 ? <p className="sv-empty">No provider usage could be read for this project yet.</p> : (
          <div className="sv-tablewrap">
            <table className="sv-table">
              <thead><tr><th>Account / metric</th><th>Usage</th><th>Used</th><th>Limit</th><th>Left</th><th>Outlook</th><th>Status</th></tr></thead>
              {withData.map((svc) => (
                <tbody key={svc.key}>
                  <tr className="sv-group">
                    <th colSpan={7}>
                      <div className="sv-groupline">
                        <span><strong>{svc.label}</strong><em>{svc.category}{svc.host ? " · " + svc.host : ""}</em>{svc.reports.length > 1 && <small>{svc.reports.length} accounts</small>}</span>
                        <span className="sv-actions">
                          {svc.console && <a href={svc.console} target="_blank" rel="noopener noreferrer">Console ↗</a>}
                          <label className="rd-check"><input type="checkbox" checked onChange={() => onToggle(project.id + "|" + svc.key, true)} /> Track</label>
                        </span>
                      </div>
                    </th>
                  </tr>
                  {accountRows(svc).map((acct) => (acct.headline.length ? acct.headline : [null]).map((m, i) => (
                    <tr key={acct.label + (m ? m.key : "none")} title={m ? forecastText(m) : ""}>
                      <td>
                        {i === 0 && <strong className="sv-acct">{acct.label}{acct.plan && <small> · {acct.plan}</small>}</strong>}
                        {m && <span className="sv-metricname">{m.label}</span>}
                        {i === 0 && acct.details.length > 0 && <small className="sv-sub">{acct.details.map(detailText).join(" · ")}</small>}
                      </td>
                      {m ? <>
                        <td>{m.kind === "balance" ? <span className="sv-dim">balance</span> : <UsageBar m={m} />}</td>
                        <td className="sv-num">{m.kind === "balance" ? "—" : formatAmount(m.used, m.unit)}</td>
                        <td className="sv-num">{m.limit != null ? formatAmount(m.limit, m.unit) + (m.limitAssumed ? "*" : "") : "—"}</td>
                        <td className="sv-num">{formatAmount(m.remaining, m.unit)}</td>
                        <td>{shortForecast(m)}{m.projectedAtReset != null && m.limit != null && <small className="sv-sub">≈ {formatAmount(m.projectedAtReset, m.unit)} at reset</small>}</td>
                        <td><Status status={m.status} /></td>
                      </> : <td colSpan={6} className="sv-dim">No limit reported by the provider</td>}
                    </tr>
                  )))}
                </tbody>
              ))}
            </table>
          </div>
        )}
        {withData.some((svc) => svc.key === "cloudinary") && <p className="rd-note">Cloudinary’s free plan is one pool of 25 credits a month per account; storage, bandwidth and transformations all draw from it.</p>}
        {withData.some((svc) => metricRows(svc).some((m) => m.limitAssumed)) && <p className="rd-note">* Limit from your settings, not reported by the provider.</p>}
      </section>

      {without.length > 0 && (
        <section className="sv-panel">
          <header className="sv-panel__head"><h2>Other connected services</h2><span className="sv-dim">Used by this project; usage can’t be read automatically</span></header>
          <div className="sv-tablewrap">
            <table className="sv-table">
              <thead><tr><th>Service</th><th>Category</th><th>Limits set in env</th><th>Usage / where to check</th><th /></tr></thead>
              <tbody>{without.map((svc) => (
                <tr key={svc.key}>
                  <td><strong>{svc.label}</strong>{svc.host ? <small className="sv-sub">{svc.host}</small> : null}{foundBy(svc) ? <small className="sv-sub">{foundBy(svc)}</small> : null}</td>
                  <td>{svc.category}</td>
                  <td>{svc.configuredLimits.length ? svc.configuredLimits.map((l) => <code key={l.name} className="sv-tag">{l.name} = {l.value}{l.period ? " / " + l.period : ""}</code>) : <span className="sv-dim">—</span>}</td>
                  <td>
                    <span className={svc.state === "error" ? "sv-err" : "sv-dim"}>{STATE_TEXT[svc.state] || "—"}{svc.state === "error" && svc.error?.detail ? ": " + svc.error.detail : ""}</span>
                    {svc.diagnosis
                      ? <small className="sv-sub">{svc.diagnosis}</small>
                      : svc.state === "no-reader" && svc.usageHint
                        ? <small className="sv-sub">{svc.usageHint}</small>
                        : null}
                  </td>
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

      {project.code && (
        <section className="sv-panel">
          <header className="sv-panel__head"><h2>Code scan</h2><span className="sv-dim">{project.code.state === "scanned" ? "Read " + project.code.files + " files from the repository" + (project.code.truncated ? " (large repo: partial)" : "") : project.code.state === "pending" ? "Scanning the repository in the background…" : "The repository could not be read — check the GitHub connection"}</span></header>
          {project.code.missingEnv?.length > 0
            ? <p className="rd-note">The code reads these variables, but this Render service does not define them: <span className="sv-mono">{project.code.missingEnv.join(", ")}</span></p>
            : project.code.state === "scanned" ? <p className="rd-note">Every variable the code reads is defined on this service.</p> : null}
        </section>
      )}

      {(project.otherVars || []).length > 0 && (
        <div className="rd-alert"><span aria-hidden="true">i</span><div>{project.otherVars.length} variable(s) don’t match a known provider: <span className="sv-mono">{project.otherVars.map((v) => v.name).join(", ")}</span>. They’re listed under “Other / unrecognised” below.</div></div>
      )}

      <section className="sv-panel">
        <header className="sv-panel__head">
          <h2>Environment variables</h2>
          <button type="button" className="rd-btn rd-btn--quiet" aria-expanded={openVars} onClick={() => setOpenVars((v) => !v)}>{openVars ? "Hide" : "Show"} all ({varGroups(project).reduce((n, g) => n + g.vars.length, 0)})</button>
        </header>
        {openVars && (
          <div className="sv-tablewrap">
            <table className="sv-table sv-table--compact">
              <thead><tr><th>Group</th><th>Variable</th><th>Value</th></tr></thead>
              <tbody>{varGroups(project).flatMap((g) => g.vars.map((v, i) => (
                <tr key={g.label + v.name}><td>{i === 0 ? <strong>{g.label}</strong> : ""}</td><td><code>{v.name}</code></td>
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
  const { projects: vaultProjects } = useVault();
  const projectOf = useMemo(() => serviceProjectIndex(vaultProjects), [vaultProjects]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [limits, setLimits] = useState(() => limitsFrom(null));
  const [selected, setSelected] = useState("overview");
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async (refresh = false, quiet = false, rescan = false) => {
    if (!quiet) { setLoading(true); setError(""); }
    try {
      const result = await getLiveDashboard({ refresh, rescan });
      setData(result);
      if (result?.settings) setLimits(limitsFrom(result.settings));
      if (quiet) setError("");
    } catch (e) { if (!quiet) setError(errorMessage(e, "Could not load the services dashboard.")); }
    finally { if (!quiet) setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // Live sync: new, deleted and suspended Render services show up on their own (providers are cached server-side).
  usePolling(() => load(false, true), 60000, true);

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
          <div className="rd-topbar__title"><div className="rd-eyebrow"><span />INFRASTRUCTURE</div><h1>🤖 Services &amp; Usage</h1></div>
          <div className="rd-topbar__tools">
            <span className="rd-sync" role="status" aria-live="polite">{loading ? "Loading…" : data?.generatedAt ? "Updated " + timeAgo(data.generatedAt) : ""}</span>
            {data?.enabled && <Link className="rd-btn rd-btn--quiet" to="/services/map" title="Tell Stashr which variable belongs to which service">🧭 Map services</Link>}
            {data?.enabled && <button type="button" className="rd-btn rd-btn--quiet" aria-expanded={showSettings} onClick={() => setShowSettings((v) => !v)}>⚙ Settings</button>}
            {data?.enabled && <button type="button" className="rd-btn rd-btn--quiet" disabled={loading} title="Read each app's repository again for the services its code uses (normally cached for 6 hours)" onClick={() => void load(true, false, true)}>⟳ Rescan code</button>}
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
            <p>Stashr reads each running Render service’s environment variables, detects the databases and APIs it uses, and asks those providers for current usage: databases (MongoDB, PostgreSQL, MySQL, Redis / Upstash, Turso, Pinecone, Elasticsearch), storage (Cloudinary, S3 / Cloudflare R2) and APIs (Brevo, SendGrid, Twilio, Vonage, Deepgram, ElevenLabs). Services without a usage API are still listed, with where to look. Everything is read-only, and keys stay on the server. Plan limits that providers do not report are the ones you set below.</p>
            <div className="sv-limits">
              {LIMIT_FIELDS.map(([key, label, hint]) => (
                <label key={key} className="sv-field">{label}<input className="rd-field" type="number" min="1" value={limits[key]} onChange={(e) => setLimits((old) => ({ ...old, [key]: e.target.value }))} /><small className="sv-dim">{hint}</small></label>
              ))}
            </div>
            <button type="button" className="rd-btn rd-btn--primary" onClick={() => void save({ enabled: true, ...limitsPatch(limits) }, "Usage tracking enabled.")}>Enable usage tracking</button>
          </section>
        )}

        {data?.enabled && showSettings && (
          <section className="sv-panel sv-settings">
            <div className="sv-limits">
              {LIMIT_FIELDS.map(([key, label, hint]) => (
                <label key={key} className="sv-field">{label}<input className="rd-field" type="number" min="1" value={limits[key]} onChange={(e) => setLimits((old) => ({ ...old, [key]: e.target.value }))} /><small className="sv-dim">{hint}</small></label>
              ))}
            </div>
            <div className="sv-actions">
              <button type="button" className="rd-btn rd-btn--primary" onClick={() => void save(limitsPatch(limits), "Saved.")}>Save</button>
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
                {current ? <ProjectDetail key={current.id} project={current} onToggle={toggle} projectOf={projectOf} /> : <Overview data={data} onOpen={setSelected} projectOf={projectOf} />}
              </div>
            </div>
          )
        )}
      </div>
    </main>
  );
}
